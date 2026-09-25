import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MockMarketplaceGateway, percentChange, validateTargets, type MarketplaceGateway, type PriceTarget, type SearchCriteria, type OperationRecord } from '@preco-certo/domain';
import { HistoryRepository } from './history.js';

const criteriaSchema = z.object({ query:z.string().optional(), skus:z.array(z.string()).optional(), names:z.array(z.string()).optional() });
const listingSchema = z.object({ id:z.string(), variationId:z.string().optional(), userProductId:z.string().optional(), accountId:z.string(), sellerId:z.string(), title:z.string(), sku:z.string(), size:z.string(), color:z.string(), structure:z.enum(['traditional','user_product']), groupId:z.string().optional(), currency:z.literal('BRL'), price:z.number(), state:z.enum(['active','paused','pending_migration']), promotionActive:z.boolean(), automaticPricing:z.boolean() });
const executeSchema = z.object({ criteria:criteriaSchema, targets:z.array(z.object({ snapshot:listingSchema, newPrice:z.number() })), approved:z.literal(true) });

export function buildApp(options: { gateway?: MarketplaceGateway; history?: HistoryRepository; appUser?: string } = {}) {
  const app = Fastify({ logger: { redact:['req.headers.authorization','req.headers.cookie','*.access_token','*.refresh_token','*.client_secret'] } });
  const gateway = options.gateway ?? new MockMarketplaceGateway();
  const history = options.history ?? new HistoryRepository(process.env.DATABASE_PATH ?? './data/preco-certo.sqlite');
  const appUser = options.appUser ?? process.env.APP_USER ?? 'operador-local';
  app.register(cors, { origin:['http://127.0.0.1:5173','http://localhost:5173'] });
  app.get('/health', async () => ({ ok:true, mode:'demo', realWrites:false }));
  app.get('/api/accounts', async () => gateway.listAccounts());
  app.post('/api/search', async (req, reply) => { const parsed=criteriaSchema.safeParse(req.body); if(!parsed.success) return reply.code(400).send({message:'Critério inválido'}); return gateway.search(parsed.data); });
  app.get('/api/history', async () => history.list());
  app.post('/api/operations/execute', async (req, reply) => {
    const parsed=executeSchema.safeParse(req.body); if(!parsed.success) return reply.code(400).send({message:'Requisição inválida', details:parsed.error.issues});
    const { targets, criteria } = parsed.data as { targets:PriceTarget[]; criteria:SearchCriteria; approved:true };
    const current = await gateway.revalidate(targets);
    const issues = validateTargets(targets, current);
    const now = new Date().toISOString();
    if (issues.length) {
      const results = targets.map(t => { const issue=issues.find(i=>i.itemId===t.snapshot.id)||issues[0]; return { itemId:t.snapshot.id, status:'blocked' as const, message:issue.message, snapshot:t.snapshot, intendedPrice:t.newPrice, percent:percentChange(t.snapshot.price,t.newPrice) }; });
      const record: OperationRecord={id:randomUUID(),createdAt:now,user:appUser,criteria,status:'blocked',note:'simulado; nenhum envio ao Mercado Livre',results}; history.save(record);
      return reply.code(409).send({ operation:record, issues });
    }
    const executed=await gateway.updatePrices(targets);
    const results=targets.map((t,i)=>({...executed[i],snapshot:t.snapshot,intendedPrice:t.newPrice,percent:percentChange(t.snapshot.price,t.newPrice)}));
    const status=results.some(r=>r.status==='failed')?'partial_failure':'simulated';
    const record:OperationRecord={id:randomUUID(),createdAt:now,user:appUser,criteria,status,note:'simulado; nenhum envio ao Mercado Livre',results}; history.save(record); return {operation:record};
  });
  app.addHook('onClose', async()=>history.close());
  return app;
}

