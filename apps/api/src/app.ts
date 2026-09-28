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
import { MercadoLivreOAuth, oauthConfigFromEnv } from './oauth.js';

const criteriaSchema = z.object({ query: z.string().optional(), skus: z.array(z.string()).optional(), names: z.array(z.string()).optional(), terms: z.array(z.string()).optional() });
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

export function buildApp(options: { gateway?: MarketplaceGateway; history?: HistoryRepository; oauth?: MercadoLivreOAuth | null; appUser?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger === false ? false : { redact: ['req.headers.authorization', 'req.headers.cookie', '*.access_token', '*.refresh_token', '*.client_secret'] } });
  const gateway = options.gateway ?? new MockMarketplaceGateway();
  const history = options.history ?? new HistoryRepository(process.env.DATABASE_PATH ?? './data/preco-certo.sqlite');
  const appUser = options.appUser ?? process.env.APP_USER ?? 'operador-local';
  const oauth = options.oauth === undefined ? (() => { const config = oauthConfigFromEnv(); return config ? new MercadoLivreOAuth(config) : null; })() : options.oauth;
  app.register(cors, { origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });
  app.get('/health', async () => ({ ok: true, mode: 'demo', realWrites: false }));
  app.get('/api/oauth/mercadolivre/status', async () => ({ enabled: Boolean(oauth), mode: 'test-only', realWrites: false, testAccounts: oauth?.listTestAccounts() ?? [] }));
  app.post('/api/oauth/mercadolivre/start', { logLevel: 'silent' }, async (req, reply) => {
    if (!oauth) return reply.code(404).send({ message: 'OAuth de teste desabilitado.' });
    if (req.headers.origin !== 'http://127.0.0.1:5173' || req.headers['x-preco-certo-oauth'] !== '1') {
      return reply.code(403).send({ message: 'Origem não autorizada.' });
    }
    const started = oauth.start();
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', `ml_oauth_browser=${started.browserNonce}; HttpOnly; SameSite=Lax; Path=/oauth/mercadolivre/callback; Max-Age=300`);
    return { authorizationUrl: started.url };
  });
  app.get('/oauth/mercadolivre/callback', { logLevel: 'silent' }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    reply.header('Set-Cookie', 'ml_oauth_browser=; HttpOnly; SameSite=Lax; Path=/oauth/mercadolivre/callback; Max-Age=0');
    if (!oauth) return reply.code(404).type('text/plain').send('OAuth de teste desabilitado.');
    const params = new URL(req.url, 'http://127.0.0.1:3333').searchParams;
    const code = params.getAll('code');
    const state = params.getAll('state');
    const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('ml_oauth_browser='))?.slice('ml_oauth_browser='.length) ?? '';
    if (code.length !== 1 || state.length !== 1 || !code[0] || !state[0] || code[0].length > 2048 || state[0].length > 128 || !cookie) {
      return reply.code(400).type('text/plain').send('Retorno OAuth inválido. Inicie novamente.');
    }
    try {
      await oauth.callback(code[0], state[0], cookie);
      return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Autorização de teste concluída</title><body><h1>Autorização de teste concluída</h1><p>Os preços continuam em modo DEMO.</p><a href="http://127.0.0.1:5173/">Voltar ao Preço Certo</a></body></html>');
    } catch {
      return reply.code(400).type('text/plain').send('Não foi possível concluir a autorização de teste. Inicie novamente.');
    }
  });
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
  app.addHook('onClose', async () => { history.close(); oauth?.close(); });
  return app;
}
