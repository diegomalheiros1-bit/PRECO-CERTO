import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const redirectUri = 'https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/';
const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
const authorizationUrl = 'https://auth.mercadolivre.com.br/authorization';
const lifetimeMs = 5 * 60_000;

export type TokenRequest = (body: URLSearchParams) => Promise<unknown>;
export type ReadRequest = (url: string, accessToken: string) => Promise<unknown>;
export class OAuthReadError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export class OAuthFlowError extends Error {
  constructor(public readonly kind: 'expired' | 'exchange' | 'seller', message: string) { super(message); }
}
export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  allowedSellerIds: Set<string>;
  databasePath: string;
  exchange?: TokenRequest;
  read?: ReadRequest;
  readEnabled?: boolean;
  now?: () => number;
};

type Pending = { verifier: string; browserNonce: string; expiresAt: number };
type TokenPayload = { access_token: string; refresh_token: string; user_id: number | string; expires_in: number };

export function oauthConfigFromEnv(env = process.env): OAuthConfig | null {
  if (env.ML_OAUTH_ENABLED !== 'true') return null;
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET || env.ML_REDIRECT_URI !== redirectUri) {
    throw new Error('OAuth exige ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI exato.');
  }
  const keyText = env.ML_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(keyText)) throw new Error('ML_ENCRYPTION_KEY deve conter 32 bytes em hexadecimal.');
  const allowedSellerIds = new Set((env.ML_TEST_USER_ALLOWLIST ?? '').split(',').map(id => id.trim()).filter(Boolean));
  if (!allowedSellerIds.size || [...allowedSellerIds].some(id => !/^\d+$/.test(id))) {
    throw new Error('ML_TEST_USER_ALLOWLIST deve conter somente IDs numéricos de vendedores de teste.');
  }
  if (env.ML_WRITE_ENABLED === 'true') throw new Error('OAuth de teste não permite ML_WRITE_ENABLED=true.');
  return {
    clientId: env.ML_CLIENT_ID, clientSecret: env.ML_CLIENT_SECRET,
    encryptionKey: Buffer.from(keyText, 'hex'), allowedSellerIds,
    databasePath: env.DATABASE_PATH ?? './data/preco-certo.sqlite',
    readEnabled: env.ML_READ_ENABLED === 'true'
  };
}

function tokenPayload(value: unknown): TokenPayload {
  if (!value || typeof value !== 'object') throw new Error('Resposta de token inválida.');
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.refresh_token !== 'string' || !data.refresh_token ||
      !(typeof data.user_id === 'string' || (typeof data.user_id === 'number' && Number.isSafeInteger(data.user_id))) ||
      !/^\d+$/.test(String(data.user_id)) ||
      typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error('Resposta de token inválida.');
  }
  return data as TokenPayload;
}

async function defaultExchange(body: URLSearchParams): Promise<unknown> {
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body, signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const reported = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error: unknown }).error : null;
      const safeCodes = new Set(['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client', 'invalid_operator_user_id']);
      const code = typeof reported === 'string' && safeCodes.has(reported) ? reported : `HTTP ${response.status}`;
      throw new OAuthFlowError('exchange', `Mercado Livre recusou a troca do código (${code}). Inicie uma nova autorização.`);
    }
    return response.json();
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error;
    throw new OAuthFlowError('exchange', 'Não foi possível contatar o Mercado Livre para trocar o código. Inicie uma nova autorização.');
  }
}

async function defaultRead(url: string, accessToken: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new OAuthReadError(502, `Mercado Livre recusou a leitura (HTTP ${response.status}). Reautorize se o token expirou.`);
    return await response.json();
  } catch (error) {
    if (error instanceof OAuthReadError) throw error;
    throw new OAuthReadError(502, 'Não foi possível consultar o Mercado Livre. Tente novamente.');
  }
}

export class MercadoLivreOAuth {
  private pending = new Map<string, Pending>();
  private db: Database.Database;
  private exchange: TokenRequest;
  private now: () => number;
  private read: ReadRequest;

  constructor(private config: OAuthConfig) {
    if (config.encryptionKey.length !== 32 || !config.allowedSellerIds.size) throw new Error('Configuração OAuth inválida.');
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new Database(config.databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ml_oauth_test_tokens (
      seller_id TEXT PRIMARY KEY, encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.exchange = config.exchange ?? defaultExchange;
    this.read = config.read ?? defaultRead;
    this.now = config.now ?? Date.now;
  }

  start() {
    const now = this.now();
    for (const [key, value] of this.pending) if (value.expiresAt <= now) this.pending.delete(key);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const browserNonce = randomBytes(32).toString('base64url');
    this.pending.set(state, { verifier, browserNonce, expiresAt: now + lifetimeMs });
    const url = new URL(authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), browserNonce };
  }

  async callback(code: string, state: string, browserNonce: string): Promise<string> {
    const pending = this.pending.get(state);
    this.pending.delete(state); // O código e o state nunca podem ser reutilizados.
    if (!pending || pending.expiresAt <= this.now() || pending.browserNonce !== browserNonce) {
      throw new OAuthFlowError('expired', 'Tentativa OAuth expirada ou reiniciada. Inicie novamente no mesmo navegador e conclua em até cinco minutos.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: this.config.clientId,
      client_secret: this.config.clientSecret, code, redirect_uri: redirectUri,
      code_verifier: pending.verifier
    });
    const tokens = tokenPayload(await this.exchange(body));
    const sellerId = String(tokens.user_id);
    if (!this.config.allowedSellerIds.has(sellerId)) throw new OAuthFlowError('seller', 'A conta autorizada não está na lista de vendedores de teste permitidos. Confira o login e inicie novamente.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
    const encryptedPayload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
    this.db.prepare(`INSERT INTO ml_oauth_test_tokens (seller_id, encrypted_payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(seller_id) DO UPDATE SET
      encrypted_payload=excluded.encrypted_payload, expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
      .run(sellerId, encryptedPayload, this.now() + tokens.expires_in * 1000, new Date(this.now()).toISOString());
    return sellerId;
  }

  listTestAccounts(): Array<{ sellerId: string; expiresAt: string }> {
    const rows = this.db.prepare('SELECT seller_id, expires_at FROM ml_oauth_test_tokens ORDER BY seller_id').all() as Array<{ seller_id: string; expires_at: number }>;
    return rows.map(row => ({ sellerId: row.seller_id, expiresAt: new Date(row.expires_at).toISOString() }));
  }

  get readEnabled() { return this.config.readEnabled === true; }

  async testRead(sellerId: string): Promise<{ sellerId: string; nickname: string; total: number; itemIds: string[] }> {
    if (!this.readEnabled) throw new OAuthReadError(403, 'Leitura de teste desabilitada no backend.');
    if (!this.config.allowedSellerIds.has(sellerId)) throw new OAuthReadError(403, 'Vendedor de teste não permitido.');
    const row = this.db.prepare('SELECT encrypted_payload, expires_at FROM ml_oauth_test_tokens WHERE seller_id = ?')
      .get(sellerId) as { encrypted_payload: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= this.now()) throw new OAuthReadError(409, 'Token ausente ou expirado. Autorize novamente o vendedor de teste.');
    let accessToken: string;
    try {
      const encrypted = Buffer.from(row.encrypted_payload, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.config.encryptionKey, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const tokens = tokenPayload(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8')));
      if (String(tokens.user_id) !== sellerId) throw new Error('seller mismatch');
      accessToken = tokens.access_token;
    } catch {
      throw new OAuthReadError(409, 'Token local inválido. Autorize novamente o vendedor de teste.');
    }
    const me = await this.read('https://api.mercadolibre.com/users/me', accessToken);
    if (!me || typeof me !== 'object' || String((me as Record<string, unknown>).id) !== sellerId) {
      throw new OAuthReadError(403, 'O token não pertence ao vendedor de teste selecionado.');
    }
    const nickname = (me as Record<string, unknown>).nickname;
    const search = await this.read(`https://api.mercadolibre.com/users/${sellerId}/items/search?limit=20`, accessToken);
    if (!search || typeof search !== 'object') throw new OAuthReadError(502, 'Resposta de anúncios inválida.');
    const data = search as Record<string, unknown>;
    const total = data.paging && typeof data.paging === 'object' ? (data.paging as Record<string, unknown>).total : undefined;
    if (!Array.isArray(data.results) || !data.results.every(id => typeof id === 'string') ||
        data.results.length > 20 || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
      throw new OAuthReadError(502, 'Resposta de anúncios inválida.');
    }
    return { sellerId, nickname: typeof nickname === 'string' ? nickname : '', total, itemIds: data.results };
  }

  close() { this.db.close(); }
}
