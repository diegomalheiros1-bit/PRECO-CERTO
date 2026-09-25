import { describe, expect, it } from 'vitest';
import { listings } from './fixtures.js';
import { MockMarketplaceGateway } from './mock.js';
import { parsePrice, searchListings, selectionAvailability, targetKey, validateTargets } from './pricing.js';
import type { Listing, PriceTarget, RevalidationState, SearchResult } from './types.js';

const target = (index: number, newPrice = 550): PriceTarget => ({ snapshot: structuredClone(listings[index]), newPrice });
const state = (items: Listing[] = listings): RevalidationState => ({
  currentTargets: structuredClone(items),
  traditionalGroups: [{ accountId: 'acc-norte', sellerId: 'TEST-1001', itemId: 'MLB-DEMO-200', variations: structuredClone(items.filter(x => x.id === 'MLB-DEMO-200' && x.accountId === 'acc-norte')) }]
});

describe('pesquisa e identidade', () => {
  it('encontra nome em três contas, tamanhos e cores sem criar seleção', () => {
    const found = searchListings(listings, { query: 'capacete norisk' });
    expect(found).toHaveLength(7);
    expect(new Set(found.map(x => x.accountId)).size).toBe(3);
  });
  it('faz SKU exato e expande o grupo tradicional para seleção segura', async () => {
    const found = await new MockMarketplaceGateway().search({ skus: ['RT-CL-PT-56'] });
    expect(found.listings.map(x => x.sku)).toEqual(['RT-CL-PT-56', 'RT-CL-PT-58', 'RT-CL-VM-58']);
    expect(found.traditionalGroups[0].variations).toHaveLength(3);
  });
  it('distingue conta, vendedor, estrutura e variação na chave', () => {
    expect(targetKey(listings[3])).not.toBe(targetKey(listings[4]));
    expect(targetKey(listings[3])).not.toBe(targetKey({ ...listings[3], accountId: 'outra' }));
    expect(targetKey(listings[3])).not.toBe(targetKey({ ...listings[3], sellerId: 'outro' }));
  });
});

describe('validação pura', () => {
  it.each(['', '0', '-1', '12.345', '12abc', 0, -2, 1.234, Number.NaN, Infinity])('rejeita preço %p', value => expect(parsePrice(value)).toBeNull());
  it.each(['12', '12,3', '12.34', 12.34, 0.29])('aceita preço %p', value => expect(parsePrice(value)).toBe(Number(String(value).replace(',', '.'))));
  it('identifica preços divergentes por combinação exata', () => {
    const issues = validateTargets([target(0, 500), target(3, 501), target(4, 501), target(5, 501)], state());
    expect(issues.filter(x => x.reason === 'divergent_prices')).toHaveLength(4);
    expect(new Set(issues.filter(x => x.reason === 'divergent_prices').map(x => x.targetKey)).size).toBe(4);
  });
  it('bloqueia uma variação de três, sem inferir completude da lista de alvos', () => {
    expect(validateTargets([target(3)], state()).some(x => x.reason === 'incomplete_variation_group')).toBe(true);
  });
  it('compara conjuntos e bloqueia ID duplicado ou trocado', () => {
    expect(validateTargets([target(3), target(3), target(5)], state()).map(x => x.reason)).toContain('duplicate_target');
    const changed = state(); changed.traditionalGroups[0].variations[2].variationId = 'VAR-NOVA';
    expect(validateTargets([target(3), target(4), target(5)], changed).map(x => x.reason)).toContain('incomplete_variation_group');
  });
  it('não mistura grupos com mesmo groupId em contas diferentes', () => {
    const other = { ...listings[3], accountId: 'acc-sul', sellerId: 'TEST-1003', variationId: 'VAR-999' };
    const current = [...listings, other];
    const revalidated = state(current);
    revalidated.traditionalGroups.push({ accountId: 'acc-sul', sellerId: 'TEST-1003', itemId: other.id, variations: [other] });
    expect(validateTargets([target(3), target(4), target(5)], revalidated)).toEqual([]);
  });
  it('permite User Product independente e grupo tradicional completo', () => {
    expect(validateTargets([target(0)], state())).toEqual([]);
    expect(validateTargets([target(3), target(4), target(5)], state())).toEqual([]);
  });
  it('usa flags atuais de promoção, automático e migração, não as do snapshot', () => {
    const current = structuredClone(listings);
    current[0].promotionActive = true; current[3].automaticPricing = true; current[6].state = 'pending_migration';
    const issues = validateTargets([target(0), target(3), target(4), target(5), { snapshot: { ...listings[6], state: 'active' }, newPrice: 550 }], state(current));
    expect(issues.map(x => x.reason)).toEqual(expect.arrayContaining(['active_promotion', 'automatic_pricing', 'pending_migration', 'stale_data']));
  });
  it.each(['price', 'sku', 'sellerId', 'accountId', 'state', 'structure', 'currency', 'variationId', 'userProductId', 'size', 'color'] as const)('bloqueia mudança em %s', field => {
    const current = structuredClone(listings);
    (current[0] as any)[field] = field === 'price' ? 999 : 'mudou';
    expect(validateTargets([target(0)], state(current)).some(x => x.reason === 'stale_data')).toBe(true);
  });
});

describe('seleção visual', () => {
  const search: SearchResult = { listings: structuredClone(listings), traditionalGroups: state().traditionalGroups };
  it('impede seleção de itens bloqueados', () => {
    expect(selectionAvailability(listings[1], search).selectable).toBe(false);
    expect(selectionAvailability(listings[2], search).selectable).toBe(false);
    expect(selectionAvailability(listings[6], search).selectable).toBe(false);
  });
  it('impede todo o grupo quando um integrante está bloqueado', () => {
    const changed = structuredClone(search);
    changed.listings[4].promotionActive = true;
    changed.traditionalGroups[0].variations[1].promotionActive = true;
    expect(selectionAvailability(changed.listings[3], changed).selectable).toBe(false);
    expect(selectionAvailability(changed.listings[5], changed).reason).toContain('RT-CL-PT-58');
  });
  it('impede subconjunto visual sem grupo completo', () => {
    const partial = { ...search, listings: [listings[3]] };
    expect(selectionAvailability(listings[3], partial).selectable).toBe(false);
  });
});
