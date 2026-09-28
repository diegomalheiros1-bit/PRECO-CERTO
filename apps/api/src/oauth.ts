import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const redirectUri = 'https://diegomalheiros1-bit.github.io/PRECO-CERTO/oauth-callback/';
const tokenUrl = 'https://api.mercadolibre.com/oauth/token';
const authorizationUrl = 'https://auth.mercadolivre.com.br/authorization';
const lifetimeMs = 5 * 60_000;

export type TokenRequest = (body: URLSearchParams) => Promise<unknown>;
export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  allowedSellerIds: Set<string>;
  databasePath: string;
  exchange?: TokenRequest;
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
    databasePath: env.DATABASE_PATH ?? './data/preco-certo.sqlite'
  };
}

function tokenPayload(value: unknown): TokenPayload {
  if (!value || typeof value !== 'object') throw new Error('Resposta de token inválida.');
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.refresh_token !== 'string' || !data.refresh_token ||
      !['number', 'string'].includes(typeof data.user_id) ||
      !/^\d+$/.test(String(data.user_id)) ||
      typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error('Resposta de token inválida.');
  }
  return data as TokenPayload;
}

async function defaultExchange(body: URLSearchParams): Promise<unknown> {
  const response = await fetch(tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('Falha na troca do código OAuth.');
  return response.json();
}

export class MercadoLivreOAuth {
  private pending = new Map<string, Pending>();
  private db: Database.Database;
  private exchange: TokenRequest;
  private now: () => number;

  constructor(private config: OAuthConfig) {
    if (config.encryptionKey.length !== 32 || !config.allowedSellerIds.size) throw new Error('Configuração OAuth inválida.');
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new Database(config.databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS ml_oauth_test_tokens (
      seller_id TEXT PRIMARY KEY, encrypted_payload TEXT NOT NULL, expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.exchange = config.exchange ?? defaultExchange;
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
      throw new Error('Autorização expirada ou inválida.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: this.config.clientId,
      client_secret: this.config.clientSecret, code, redirect_uri: redirectUri,
      code_verifier: pending.verifier
    });
    const tokens = tokenPayload(await this.exchange(body));
    const sellerId = String(tokens.user_id);
    if (!this.config.allowedSellerIds.has(sellerId)) throw new Error('Vendedor fora da lista de teste.');
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

  close() { this.db.close(); }
}
