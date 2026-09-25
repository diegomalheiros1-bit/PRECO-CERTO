import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { HistoryRepository } from './history.js';
import {
  accounts, listings, MockMarketplaceGateway, targetKey,
  type Account, type ExecutionResult, type Listing, type MarketplaceGateway,
  type PriceTarget, type SearchCriteria
} from '@preco-certo/domain';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const targets = (...indexes: number[]): PriceTarget[] => indexes.map(index => ({ snapshot: structuredClone(listings[index]), newPrice: 550 }));

class ControlledGateway implements MarketplaceGateway {
  current = structuredClone(listings);
  updateCalls = 0;
  returned: ExecutionResult[] | null = null;
  async listAccounts(): Promise<Account[]> { return structuredClone(accounts); }
  async search(criteria: SearchCriteria) { return new MockMarketplaceGateway(structuredClone(listings)).search(criteria); }
  async revalidate(selected: PriceTarget[]) { return new MockMarketplaceGateway(structuredClone(this.current)).revalidate(selected); }
  async updatePrices(selected: PriceTarget[]): Promise<ExecutionResult[]> {
    this.updateCalls++;
    return this.returned ?? selected.map(target => ({ targetKey: targetKey(target.snapshot), status: 'simulated', message: 'simulado; nenhum envio ao Mercado Livre', appliedPrice: null }));
  }
}

function setup() {
  const gateway = new ControlledGateway();
  const app = buildApp({ gateway, history: new HistoryRepository(':memory:'), appUser: 'operador-teste', logger: false });
  apps.push(app);
  return { app, gateway };
}

async function execute(app: FastifyInstance, selected: PriceTarget[]) {
  const search = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'Norisk' } });
  expect(search.statusCode).toBe(200);
  expect(search.json().listings).toHaveLength(7);
  return app.inject({ method: 'POST', url: '/api/operations/execute', payload: { criteria: { query: 'Norisk' }, targets: selected, approved: true } });
}

async function assertBlocked(app: FastifyInstance, gateway: ControlledGateway, selected: PriceTarget[], reason: string) {
  const response = await execute(app, selected);
  expect(response.statusCode).toBe(409);
  expect(response.json().issues.map((issue: any) => issue.reason)).toContain(reason);
  expect(gateway.updateCalls).toBe(0);
  const history = (await app.inject({ method: 'GET', url: '/api/history' })).json();
  expect(history[0].status).toBe('blocked');
  expect(history[0].issues.map((issue: any) => issue.reason)).toContain(reason);
  expect(history[0].results.every((entry: any) => entry.appliedPrice === null)).toBe(true);
  return response.json();
}

describe('POST /api/operations/execute', () => {
  it('bloqueia uma de três variações e registra o motivo sem envio', async () => {
    const { app, gateway } = setup();
    const result = await assertBlocked(app, gateway, targets(3), 'incomplete_variation_group');
    expect(result.operation.results[0].message).toContain('Composição');
  });
  it('permite as três variações corretas e distingue pretendido de aplicado', async () => {
    const { app, gateway } = setup();
    const response = await execute(app, targets(3, 4, 5));
    expect(response.statusCode).toBe(200);
    expect(gateway.updateCalls).toBe(1);
    expect(response.json().operation.status).toBe('simulated');
    expect(response.json().operation.results.map((entry: any) => entry.targetKey)).toEqual(targets(3, 4, 5).map(t => targetKey(t.snapshot)));
    expect(response.json().operation.results.every((entry: any) => entry.intendedPrice === 550 && entry.appliedPrice === null)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/history' })).json()[0].note).toContain('nenhum envio');
  });
  it('bloqueia ID repetido e outro ausente', async () => {
    const { app, gateway } = setup();
    const result = await assertBlocked(app, gateway, targets(3, 3, 5), 'duplicate_target');
    expect(result.issues.map((issue: any) => issue.reason)).toContain('incomplete_variation_group');
    expect(result.issues.find((issue: any) => issue.reason === 'duplicate_target').targetKey).toBeNull();
  });
  it('bloqueia quarta variação adicionada após a busca', async () => {
    const { app, gateway } = setup();
    gateway.current.push({ ...listings[5], variationId: 'VAR-204', sku: 'RT-CL-VM-60', size: '60' });
    await assertBlocked(app, gateway, targets(3, 4, 5), 'incomplete_variation_group');
  });
  it('bloqueia variação removida ou ID trocado, mesmo com igual quantidade', async () => {
    const { app, gateway } = setup();
    gateway.current[5].variationId = 'VAR-999';
    await assertBlocked(app, gateway, targets(3, 4, 5), 'incomplete_variation_group');
  });
  it('bloqueia preço atual alterado de uma variação', async () => {
    const { app, gateway } = setup();
    gateway.current[4].price = 599;
    const result = await assertBlocked(app, gateway, targets(3, 4, 5), 'stale_data');
    expect(result.operation.results.find((entry: any) => entry.targetKey === targetKey(listings[4])).message).toContain('Dados mudaram');
  });
  it.each([
    ['promotionActive', 'active_promotion'], ['automaticPricing', 'automatic_pricing']
  ] as const)('bloqueia %s que passou a ativo após a busca', async (field, reason) => {
    const { app, gateway } = setup();
    gateway.current[0][field] = true;
    await assertBlocked(app, gateway, targets(0), reason);
  });
  it('bloqueia migração pendente surgida após a busca', async () => {
    const { app, gateway } = setup();
    gateway.current[0].state = 'pending_migration';
    await assertBlocked(app, gateway, targets(0), 'pending_migration');
  });
  it('bloqueia estrutura alterada após a busca', async () => {
    const { app, gateway } = setup();
    gateway.current[0] = { ...gateway.current[0], structure: 'traditional', variationId: 'VAR-101', userProductId: undefined };
    await assertBlocked(app, gateway, targets(0), 'stale_data');
  });
  it.each(['sku', 'sellerId', 'accountId'] as const)('bloqueia %s alterado após a busca', async field => {
    const { app, gateway } = setup();
    gateway.current[0][field] = 'outro';
    await assertBlocked(app, gateway, targets(0), 'stale_data');
  });
  it('associa problemas distintos a duas variações com mesmo ID de anúncio', async () => {
    const { app, gateway } = setup();
    gateway.current[3].promotionActive = true;
    gateway.current[4].automaticPricing = true;
    const result = await assertBlocked(app, gateway, targets(3, 4, 5), 'active_promotion');
    const first = result.operation.results.find((entry: any) => entry.targetKey === targetKey(listings[3]));
    const second = result.operation.results.find((entry: any) => entry.targetKey === targetKey(listings[4]));
    const third = result.operation.results.find((entry: any) => entry.targetKey === targetKey(listings[5]));
    expect(first.message).toContain('Promoção ativa');
    expect(first.message).not.toContain('Preço automático ativo');
    expect(second.message).toContain('Preço automático ativo');
    expect(second.message).not.toContain('Promoção ativa');
    expect(third.message).toContain('outro alvo');
    const history = (await app.inject({ method: 'GET', url: '/api/history' })).json()[0];
    expect(history.results.map((entry: any) => entry.message)).toEqual(result.operation.results.map((entry: any) => entry.message));
  });
  it('bloqueia preço inválido e preços divergentes no servidor', async () => {
    const { app, gateway } = setup();
    await assertBlocked(app, gateway, [{ ...targets(0)[0], newPrice: 0 }], 'invalid_price');
    const selected = targets(0, 3, 4, 5); selected[0].newPrice = 551;
    await assertBlocked(app, gateway, selected, 'divergent_prices');
  });
  it('não anuncia sucesso global quando uma resposta falha', async () => {
    const { app, gateway } = setup();
    gateway.returned = targets(3, 4, 5).map((target, index) => ({ targetKey: targetKey(target.snapshot), status: index === 1 ? 'failed' : 'simulated', message: index === 1 ? 'Falha individual' : 'Simulado', appliedPrice: null }));
    const response = await execute(app, targets(3, 4, 5));
    expect(response.statusCode).toBe(200);
    expect(response.json().operation.status).toBe('partial_failure');
    expect(response.json().operation.results[1].message).toBe('Falha individual');
  });
  it('relaciona respostas do gateway pela chave e não pela ordem ou ID do anúncio', async () => {
    const { app, gateway } = setup();
    gateway.returned = targets(3, 4, 5).reverse().map(target => ({ targetKey: targetKey(target.snapshot), status: 'simulated', message: target.snapshot.sku, appliedPrice: null }));
    const response = await execute(app, targets(3, 4, 5));
    expect(response.json().operation.results.map((entry: any) => entry.message)).toEqual(listings.slice(3, 6).map(item => item.sku));
  });
  it('não expõe segredo no health check', async () => {
    const { app } = setup();
    process.env.ML_CLIENT_SECRET = 'super-secreto';
    const body = (await app.inject({ method: 'GET', url: '/health' })).body;
    expect(body).not.toContain('super-secreto');
    expect(body).not.toContain('token');
    delete process.env.ML_CLIENT_SECRET;
  });
});
