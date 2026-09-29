import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePrice, percentChange } from '@preco-certo/domain';
import { api } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('regras compartilhadas pela interface',()=>{
  it('formata a intenção sem corrigir entrada inválida',()=>{expect(parsePrice('10abc')).toBeNull();expect(parsePrice('10,50')).toBe(10.5)});
  it('calcula aumento e redução',()=>{expect(percentChange(100,110)).toBe(10);expect(percentChange(100,90)).toBe(-10)});
});

describe('chamada OAuth da interface', () => {
  it('envia um corpo JSON para iniciar a autorização', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authorizationUrl: 'https://example.test/' }) });
    vi.stubGlobal('fetch', fetchMock);
    await api.startOAuth();
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/mercadolivre/start', expect.objectContaining({
      method: 'POST', body: '{}', credentials: 'same-origin',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'x-preco-certo-oauth': '1' })
    }));
  });
});
