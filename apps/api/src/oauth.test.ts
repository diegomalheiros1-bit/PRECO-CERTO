import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { HistoryRepository } from './history.js';
import { MercadoLivreOAuth, OAuthFlowError, oauthConfigFromEnv, type ReadRequest, type TokenRequest } from './oauth.js';

const apps: FastifyInstance[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map(app => app.close()));
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

function setup(exchange?: TokenRequest, now?: () => number, read?: ReadRequest, readEnabled = false) {
  const dir = mkdtempSync(join(tmpdir(), 'preco-certo-oauth-'));
  dirs.push(dir);
  const databasePath = join(dir, 'test.sqlite');
  const oauth = new MercadoLivreOAuth({
    clientId: 'test-client', clientSecret: 'test-secret', encryptionKey: randomBytes(32),
    allowedSellerIds: new Set(['123']), databasePath, exchange, now, read, readEnabled
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
  it('consulta somente o vendedor permitido e não expõe tokens', async () => {
    const calls: string[] = [];
    const { app } = setup(async () => ({ access_token: 'ACCESS_SENTINEL', refresh_token: 'REFRESH_SENTINEL', user_id: 123, expires_in: 3600 }), undefined,
      async (url, token) => {
        expect(token).toBe('ACCESS_SENTINEL'); calls.push(url);
        return url.endsWith('/users/me') ? { id: 123, nickname: 'TESTUSER123' } : { results: ['MLB123'], paging: { total: 1 } };
      }, true);
    const flow = await start(app);
    await app.inject({ url: `/oauth/mercadolivre/callback?code=x&state=${flow.url.searchParams.get('state')}`, headers: { cookie: flow.cookie } });
    const request = (sellerId: string, origin = 'http://127.0.0.1:5173') => app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/test-read',
      headers: { origin, 'x-preco-certo-test-read': '1' }, payload: { sellerId } });
    expect((await request('999')).statusCode).toBe(403);
    expect((await request('123', 'https://evil.example')).statusCode).toBe(403);
    const result = await request('123');
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ sellerId: '123', nickname: 'TESTUSER123', total: 1, itemIds: ['MLB123'] });
    expect(result.body).not.toContain('SENTINEL');
    expect(calls).toEqual(['https://api.mercadolibre.com/users/me', 'https://api.mercadolibre.com/users/123/items/search?limit=20']);
  });

  it('mantém leitura desligada e rejeita vendedor divergente', async () => {
    let now = 1000;
    const exchange = async () => ({ access_token: 'x', refresh_token: 'y', user_id: 123, expires_in: 1 });
    const { app } = setup(exchange, () => now, async () => { throw new Error('não deve ler'); });
    const flow = await start(app);
    await app.inject({ url: `/oauth/mercadolivre/callback?code=x&state=${flow.url.searchParams.get('state')}`, headers: { cookie: flow.cookie } });
    const request = () => app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/test-read',
      headers: { origin: 'http://127.0.0.1:5173', 'x-preco-certo-test-read': '1' }, payload: { sellerId: '123' } });
    expect((await request()).statusCode).toBe(403);
    now += 2000;
    const enabled = setup(exchange, () => now, async () => ({ id: 999 }), true);
    const second = await start(enabled.app);
    await enabled.app.inject({ url: `/oauth/mercadolivre/callback?code=x&state=${second.url.searchParams.get('state')}`, headers: { cookie: second.cookie } });
    expect((await enabled.app.inject({ method: 'POST', url: '/api/oauth/mercadolivre/test-read', headers: { origin: 'http://127.0.0.1:5173', 'x-preco-certo-test-read': '1' }, payload: { sellerId: '123' } })).statusCode).toBe(403);
  });
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
    const withoutCookie = await app.inject({ url: callback });
    expect(withoutCookie.statusCode).toBe(400);
    expect(withoutCookie.body).toContain('mesmo navegador e perfil');
    expect((await app.inject({ url: callback, headers: { cookie: 'ml_oauth_browser=wrong' } })).statusCode).toBe(400);
    expect((await app.inject({ url: callback, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    const second = await start(app);
    now += 5 * 60_000;
    const expired = await app.inject({ url: `/oauth/mercadolivre/callback?code=x&state=${second.url.searchParams.get('state')}`, headers: { cookie: second.cookie } });
    expect(expired.statusCode).toBe(400);
    expect(expired.body).toContain('expirada');
    expect(calls).toBe(0);
  });

  it('não persiste vendedor fora da allowlist e não aceita parâmetros duplicados', async () => {
    let calls = 0;
    const { app } = setup(async () => { calls++; return { access_token: 'x', refresh_token: 'y', user_id: 999, expires_in: 3600 }; });
    const flow = await start(app);
    const state = flow.url.searchParams.get('state')!;
    expect((await app.inject({ url: `/oauth/mercadolivre/callback?code=a&code=b&state=${state}`, headers: { cookie: flow.cookie } })).statusCode).toBe(400);
    const rejectedSeller = await app.inject({ url: `/oauth/mercadolivre/callback?code=a&state=${state}`, headers: { cookie: flow.cookie } });
    expect(rejectedSeller.statusCode).toBe(400);
    expect(rejectedSeller.headers['content-type']).toContain('charset=utf-8');
    expect(rejectedSeller.body).toContain('não está na lista');
    expect(calls).toBe(1);
    expect((await app.inject('/api/oauth/mercadolivre/status')).json().testAccounts).toEqual([]);
  });

  it('mostra apenas o motivo seguro de uma troca recusada', async () => {
    const { app } = setup(async () => { throw new OAuthFlowError('exchange', 'Mercado Livre recusou a troca do código (invalid_grant). Inicie uma nova autorização.'); });
    const flow = await start(app);
    const response = await app.inject({ url: `/oauth/mercadolivre/callback?code=one-time-code&state=${flow.url.searchParams.get('state')}`, headers: { cookie: flow.cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('invalid_grant');
    expect(response.body).not.toContain('one-time-code');
  });

  it('não aceita um user_id numérico que perdeu precisão no JSON', async () => {
    const { app } = setup(async () => ({ access_token: 'x', refresh_token: 'y', user_id: Number.MAX_SAFE_INTEGER + 1, expires_in: 3600 }));
    const flow = await start(app);
    const response = await app.inject({ url: `/oauth/mercadolivre/callback?code=code&state=${flow.url.searchParams.get('state')}`, headers: { cookie: flow.cookie } });
    expect(response.statusCode).toBe(400);
    expect((await app.inject('/api/oauth/mercadolivre/status')).json().testAccounts).toEqual([]);
  });

  it('exibe somente o código de erro permitido da API externa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'sensitive upstream detail' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { app } = setup();
    const flow = await start(app);
    const response = await app.inject({ url: `/oauth/mercadolivre/callback?code=one-time-code&state=${flow.url.searchParams.get('state')}`, headers: { cookie: flow.cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('invalid_client');
    expect(response.body).not.toContain('sensitive upstream detail');
    expect(response.body).not.toContain('one-time-code');
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/oauth/token', expect.objectContaining({ method: 'POST' }));
  });
});
