import type { Listing, PriceTarget, SearchCriteria, ValidationIssue } from './types.js';

export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && Math.round(value * 100) === value * 100 ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function percentChange(previous: number, next: number): number {
  return Math.round(((next - previous) / previous) * 10000) / 100;
}

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function searchListings(listings: Listing[], criteria: SearchCriteria): Listing[] {
  const exactSkus = (criteria.skus ?? []).map(normalized).filter(Boolean);
  const names = [criteria.query, ...(criteria.names ?? [])].filter((v): v is string => Boolean(v?.trim())).map(normalized);
  if (!exactSkus.length && !names.length) return [];
  return listings.filter(item => exactSkus.includes(normalized(item.sku)) || names.some(term => normalized(`${item.title} ${item.size} ${item.color}`).includes(term)));
}

export function validateTargets(targets: PriceTarget[], current: Listing[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!targets.length) return [{ itemId: '*', reason: 'invalid_price', message: 'Selecione ao menos um item.' }];
  for (const target of targets) {
    if (parsePrice(target.newPrice) === null) issues.push({ itemId: target.snapshot.id, reason: 'invalid_price', message: 'Preço deve ser maior que zero e ter no máximo duas casas decimais.' });
    if (target.snapshot.promotionActive) issues.push({ itemId: target.snapshot.id, reason: 'active_promotion', message: 'Promoção ativa: fluxo simples bloqueado por decisão conservadora do produto.' });
    if (target.snapshot.automaticPricing) issues.push({ itemId: target.snapshot.id, reason: 'automatic_pricing', message: 'Preço automático ativo.' });
    if (target.snapshot.state === 'pending_migration') issues.push({ itemId: target.snapshot.id, reason: 'pending_migration', message: 'Migração pendente.' });
    const now = current.find(x => x.id === target.snapshot.id && x.variationId === target.snapshot.variationId);
    const stable = now && ['sellerId','accountId','sku','state','structure','currency','price'].every(k => now[k as keyof Listing] === target.snapshot[k as keyof Listing]);
    if (!stable) issues.push({ itemId: target.snapshot.id, reason: 'stale_data', message: 'Dados mudaram desde a revisão; pesquise e aprove novamente.' });
  }
  const prices = new Set(targets.map(t => t.newPrice));
  if (prices.size > 1) for (const target of targets) issues.push({ itemId: target.snapshot.id, reason: 'divergent_prices', message: `Preço divergente: R$ ${target.newPrice.toFixed(2)}.` });
  const groups = new Map<string, Listing[]>();
  for (const item of current.filter(x => x.structure === 'traditional' && x.groupId)) groups.set(item.groupId!, current.filter(x => x.groupId === item.groupId));
  for (const [groupId, members] of groups) {
    const chosen = targets.filter(t => t.snapshot.groupId === groupId);
    if (chosen.length > 0 && chosen.length !== members.length) for (const target of chosen) issues.push({ itemId: target.snapshot.id, reason: 'incomplete_variation_group', message: `O grupo tradicional ${groupId} exige todas as ${members.length} variações.` });
  }
  return issues;
}

