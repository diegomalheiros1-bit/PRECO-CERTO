import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MockMarketplaceGateway, percentChange, targetKey, validateTargets,
  type ExecutionResult, type MarketplaceGateway, type OperationRecord,
  type PriceTarget, type SearchCriteria, type ValidationIssue
} from '@preco-certo/domain';
import { HistoryRepository } from './history.js';

const criteriaSchema = z.object({ query: z.string().optional(), skus: z.array(z.string()).optional(), names: z.array(z.string()).optional() });
const listingSchema = z.object({
  id: z.string(), variationId: z.string().optional(), userProductId: z.string().optional(),
  accountId: z.string(), sellerId: z.string(), title: z.string(), sku: z.string(),
  size: z.string(), color: z.string(), structure: z.enum(['traditional', 'user_product']),
  groupId: z.string().optional(), currency: z.literal('BRL'), price: z.number(),
  state: z.enum(['active', 'paused', 'pending_migration']), promotionActive: z.boolean(), automaticPricing: z.boolean()
});
const executeSchema = z.object({
  criteria: criteriaSchema,
  targets: z.array(z.object({ snapshot: listingSchema, newPrice: z.number() })),
  approved: z.literal(true)
});

function describeBlock(target: PriceTarget, issues: ValidationIssue[]): string {
  const matching = issues.filter(issue => issue.targetKey === targetKey(target.snapshot));
  if (matching.length) return [...new Set(matching.map(issue => issue.message))].join(' ');
  return 'Operação bloqueada por outro alvo ou por erro global; nenhum envio.';
}

function reconcileResults(targets: PriceTarget[], returned: ExecutionResult[]): ExecutionResult[] {
  const requested = new Set(targets.map(t => targetKey(t.snapshot)));
  const counts = new Map<string, number>();
  for (const result of returned) counts.set(result.targetKey, (counts.get(result.targetKey) ?? 0) + 1);
  const unexpected = returned.some(result => !requested.has(result.targetKey));
  return targets.map(target => {
    const key = targetKey(target.snapshot);
    if (unexpected || counts.get(key) !== 1) return { targetKey: key, status: 'failed', message: 'Resposta do gateway ausente, duplicada ou com alvo inesperado.', appliedPrice: null };
    const result = returned.find(item => item.targetKey === key)!;
    if (result.status !== 'simulated' && result.status !== 'failed') return { targetKey: key, status: 'failed', message: 'Estado inesperado na resposta do gateway.', appliedPrice: null };
    return result;
  });
}

export function buildApp(options: { gateway?: MarketplaceGateway; history?: HistoryRepository; appUser?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger === false ? false : { redact: ['req.headers.authorization', 'req.headers.cookie', '*.access_token', '*.refresh_token', '*.client_secret'] } });
  const gateway = options.gateway ?? new MockMarketplaceGateway();
  const history = options.history ?? new HistoryRepository(process.env.DATABASE_PATH ?? './data/preco-certo.sqlite');
  const appUser = options.appUser ?? process.env.APP_USER ?? 'operador-local';
  app.register(cors, { origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  app.get('/health', async () => ({ ok: true, mode: 'demo', realWrites: false }));
  app.get('/api/accounts', async () => gateway.listAccounts());
  app.post('/api/search', async (req, reply) => {
    const parsed = criteriaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Critério inválido' });
    return gateway.search(parsed.data);
  });
  app.get('/api/history', async () => history.list());
  app.post('/api/operations/execute', async (req, reply) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Requisição inválida', details: parsed.error.issues });
    const { targets, criteria } = parsed.data as { targets: PriceTarget[]; criteria: SearchCriteria; approved: true };
    const state = await gateway.revalidate(targets);
    const issues = validateTargets(targets, state);
    const createdAt = new Date().toISOString();
    if (issues.length) {
      const results = targets.map(target => ({
        targetKey: targetKey(target.snapshot), status: 'blocked' as const,
        message: describeBlock(target, issues), appliedPrice: null,
        snapshot: target.snapshot, intendedPrice: target.newPrice,
        percent: percentChange(target.snapshot.price, target.newPrice)
      }));
      const record: OperationRecord = {
        id: randomUUID(), createdAt, user: appUser, criteria, status: 'blocked',
        note: 'simulado; nenhum envio ao Mercado Livre', issues, results
      };
      history.save(record);
      return reply.code(409).send({ message: 'Operação bloqueada; revise os motivos e pesquise novamente.', operation: record, issues });
    }

    const executed = reconcileResults(targets, await gateway.updatePrices(targets));
    const results = targets.map(target => ({
      ...executed.find(item => item.targetKey === targetKey(target.snapshot))!,
      snapshot: target.snapshot, intendedPrice: target.newPrice,
      percent: percentChange(target.snapshot.price, target.newPrice)
    }));
    const status = results.some(result => result.status === 'failed') ? 'partial_failure' : 'simulated';
    const record: OperationRecord = {
      id: randomUUID(), createdAt, user: appUser, criteria, status,
      note: 'simulado; nenhum envio ao Mercado Livre', issues: [], results
    };
    history.save(record);
    return { operation: record };
  });
  app.addHook('onClose', async () => history.close());
  return app;
}
