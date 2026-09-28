import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { HistoryRepository } from './history.js';
import { MercadoLivreOAuth, oauthConfigFromEnv, type TokenRequest } from './oauth.js';

const apps: FastifyInstance[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

function setup(exchange: TokenRequest, now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'preco-certo-oauth-'));
  dirs.push(dir);
  const databasePath = join(dir, 'test.sqlite');
  const oauth = new MercadoLivreOAuth({
    clientId: 'test-client', clientSecret: 'test-secret', encryptionKey: randomBytes(32),
    allowedSellerIds: new Set(['123']), databasePath, exchange, now
  });
  const app = buildApp({ oauth, history: new HistoryRepository(':memory:'), logger: false });
  apps.push(app);
  return { app, databasePath };
}

async function start(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/start', headers: { origin: 'http://127.0.0.1:5173', 'x-preco-certo-oauth': '1' } });
  expect(response.statusCode).toBe(200);
  return { url: new URL(response.json().authorizationUrl), cookie: response.headers['set-cookie']!.toString().split(';')[0] };
}

describe('OAuth Mercado Livre de teste', () => {
  it('permanece desligado por padrão e exige configuração completa ao habilitar', async () => {
    expect(oauthConfigFromEnv({ ML_OAUTH_ENABLED: 'false' })).toBeNull();
    expect(() => oauthConfigFromEnv({ ML_OAUTH_ENABLED: 'true' })).toThrow();
    const app = buildApp({ oauth: null, history: new HistoryRepository(':memory:'), logger: false });
    apps.push(app);
    expect((await app.inject('/api/oauth/mercadolivre/status')).json()).toMatchObject({ enabled: false, realWrites: false, testAccounts: [] });
    expect((await app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/start' })).statusCode).toBe(404);
  });

  it('gera state e PKCE S256, troca o código uma vez e cifra os tokens', async () => {
    let exchangeCalls = 0;
    let submitted: URLSearchParams | undefined;
    const { app, databasePath } = setup(async body => {
      exchangeCalls++; submitted = body;
      return { access_token: 'ACCESS_TOKEN_SENTINEL', refresh_token: 'REFRESH_TOKEN_SENTINEL', user_id: 123, expires_in: 3600 };
    });
    const flow = await start(app);
    expect(flow.url.origin).toBe('https://auth.mercadolivre.com.br');
    expect(flow.url.searchParams.get('redirect_uri')).toBe('https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/');
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = flow.url.searchParams.get('state')!;
    const callback = `/oauth/mercadolivre/callback?code=test-code&state=${state}`;
    const response = await app.inject({ url: callback, headers: { cookie: flow.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('ACCESS_TOKEN_SENTINEL');
    expect(submitted?.get('client_secret')).toBe('test-secret');
    expect(submitted?.get('grant_type')).toBe('authorization_code');
    expect(submitted?.get('code')).toBe('test-code');
    expect(submitted?.get('redirect_uri')).toBe(flow.url.searchParams.get('redirect_uri'));
    expect(createHash('sha256').update(submitted!.get('code_verifier')!).digest('base64url')).toBe(flow.url.searchParams.get('code_challenge'));
    expect((await app.inject({ url: callback, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    expect(exchangeCalls).toBe(1);
    expect((await app.inject('/api/oauth/mercadolivre/status')).json().testAccounts).toMatchObject([{ sellerId: '123' }]);
    const dbBytes = readFileSync(databasePath).toString('utf8');
    expect(dbBytes).not.toContain('ACCESS_TOKEN_SENTINEL');
    expect(dbBytes).not.toContain('REFRESH_TOKEN_SENTINEL');
  });

  it('rejeita origem, cookie incorreto, state duplicado e vencimento sem trocar código', async () => {
    let calls = 0;
    let now = 1000;
    const { app } = setup(async () => { calls++; return {}; }, () => now);
    expect((await app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/start', headers: { origin: 'https://evil.example', 'x-preco-certo-oauth': '1' } })).statusCode).toBe(403);
    const flow = await start(app);
    const callback = `/oauth/mercadolivre/callback?code=x&state=${flow.url.searchParams.get('state')}`;
    expect((await app.inject({ url: callback, headers: { cookie: 'ml_oauth_browser=wrong' } })).statusCode).toBe(400);
    expect((await app.inject({ url: callback, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    const second = await start(app);
    now += 5 * 60_000;
    expect((await app.inject({ url: `/oauth/mercadolivre/callback?code=x&state=${second.url.searchParams.get('state')}`, headers: { cookie: second.cookie } })).statusCode).toBe(400);
    expect(calls).toBe(0);
  });

  it('não persiste vendedor fora da allowlist e não aceita parâmetros duplicados', async () => {
    let calls = 0;
    const { app } = setup(async () => { calls++; return { access_token: 'x', refresh_token: 'y', user_id: 999, expires_in: 3600 }; });
    const flow = await start(app);
    const state = flow.url.searchParams.get('state')!;
    expect((await app.inject({ url: `/oauth/mercadolivre/callback?code=a&code=b&state=${state}`, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/oauth/mercadolivre/callback?code=a&state=${state}`, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    expect(calls).toBe(1);
    expect((await app.inject('/api/oauth/mercadolivre/status')).json().testAccounts).toEqual([]);
  });
});
