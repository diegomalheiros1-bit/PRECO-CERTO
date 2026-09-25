import type { Listing, PriceTarget, RevalidationState, SearchCriteria, SearchResult, TraditionalGroup, ValidationIssue } from './types.js';

export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100))) return null;
    return Math.abs(Math.round(value * 100) - value * 100) < 1e-8 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  return parsePrice(Number(value.replace(',', '.')));
}

export function percentChange(previous: number, next: number): number {
  return Math.round(((next - previous) / previous) * 10000) / 100;
}

// JSON encoding keeps identifier boundaries unambiguous even when IDs contain punctuation.
export function targetKey(item: Listing): string {
  return JSON.stringify([item.accountId, item.sellerId, item.id, item.structure,
    item.structure === 'traditional' ? item.variationId ?? null : item.userProductId ?? null]);
}

export function traditionalGroupKey(item: Pick<Listing, 'accountId' | 'sellerId' | 'id'>): string {
  return JSON.stringify([item.accountId, item.sellerId, item.id]);
}

export function validIdentity(item: Listing): boolean {
  return item.structure === 'traditional'
    ? Boolean(item.variationId) && !item.userProductId
    : Boolean(item.userProductId) && !item.variationId;
}

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function searchListings(listings: Listing[], criteria: SearchCriteria): Listing[] {
  const exactSkus = (criteria.skus ?? []).map(normalized).filter(Boolean);
  const names = [criteria.query, ...(criteria.names ?? [])].filter((v): v is string => Boolean(v?.trim())).map(normalized);
  if (!exactSkus.length && !names.length) return [];
  return listings.filter(item => exactSkus.includes(normalized(item.sku)) || names.some(term => normalized(`${item.title} ${item.size} ${item.color}`).includes(term)));
}

export function selectionBlockReason(item: Listing): string | null {
  if (item.promotionActive) return 'Promoção ativa';
  if (item.automaticPricing) return 'Preço automático ativo';
  if (item.state === 'pending_migration') return 'Migração pendente';
  if (item.state !== 'active') return 'Anúncio não está ativo';
  return null;
}

export function selectionAvailability(item: Listing, search: SearchResult): { selectable: boolean; reason: string | null; group: Listing[] } {
  if (item.structure !== 'traditional') {
    const reason = !validIdentity(item) ? 'Identificador de User Product ausente' : selectionBlockReason(item);
    return { selectable: !reason, reason, group: [item] };
  }
  const groupKey = traditionalGroupKey(item);
  const matches = search.traditionalGroups.filter(group => traditionalGroupKey({ ...group, id: group.itemId }) === groupKey);
  const group = matches[0]?.variations ?? [];
  const visible = search.listings.filter(x => x.structure === 'traditional' && traditionalGroupKey(x) === groupKey);
  const expectedIds = group.map(x => x.variationId);
  const visibleIds = visible.map(x => x.variationId);
  const complete = matches.length === 1 && group.length > 0 && expectedIds.every(Boolean)
    && new Set(expectedIds).size === expectedIds.length && new Set(visibleIds).size === visibleIds.length
    && expectedIds.length === visibleIds.length && expectedIds.every(id => visibleIds.includes(id))
    && group.every(x => x.structure === 'traditional' && traditionalGroupKey(x) === groupKey && validIdentity(x));
  if (!complete) return { selectable: false, reason: 'Grupo tradicional incompleto; pesquise novamente', group: visible };
  const inconsistent = visible.some(x => {
    const member = group.find(y => y.variationId === x.variationId);
    return !member || ['sku', 'price', 'state', 'promotionActive', 'automaticPricing'].some(field =>
      member[field as keyof Listing] !== x[field as keyof Listing]);
  });
  if (inconsistent) return { selectable: false, reason: 'Dados do grupo inconsistentes; pesquise novamente', group: visible };
  const blocked = group.find(x => selectionBlockReason(x)) ?? visible.find(x => selectionBlockReason(x));
  const reason = blocked ? `Grupo bloqueado: ${blocked.sku} — ${selectionBlockReason(blocked)}` : null;
  return { selectable: !reason, reason, group: visible };
}

const relevantFields = [
  'accountId', 'sellerId', 'id', 'variationId', 'userProductId', 'sku', 'structure',
  'currency', 'state', 'price', 'promotionActive', 'automaticPricing',
  'groupId', 'title', 'size', 'color'
] as const satisfies readonly (keyof Listing)[];

export function validateTargets(targets: PriceTarget[], state: RevalidationState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!targets.length) return [{ targetKey: null, reason: 'invalid_price', message: 'Selecione ao menos um item.' }];
  const selectedKeys = targets.map(t => targetKey(t.snapshot));
  if (new Set(selectedKeys).size !== selectedKeys.length) {
    issues.push({ targetKey: null, reason: 'duplicate_target', message: 'A operação contém a mesma combinação mais de uma vez.' });
  }
  const currentKeys = state.currentTargets.map(targetKey);
  if (new Set(currentKeys).size !== currentKeys.length) {
    issues.push({ targetKey: null, reason: 'stale_data', message: 'A reconsulta devolveu combinações duplicadas; pesquise novamente.' });
  }

  for (const target of targets) {
    const key = targetKey(target.snapshot);
    if (!validIdentity(target.snapshot)) issues.push({ targetKey: key, reason: 'invalid_identity', message: 'Identificador da variação ou User Product inválido.' });
    if (parsePrice(target.newPrice) === null) issues.push({ targetKey: key, reason: 'invalid_price', message: 'Preço deve ser positivo e ter no máximo duas casas decimais.' });
    const current = state.currentTargets.find(x => targetKey(x) === key);
    if (!current || relevantFields.some(field => current[field] !== target.snapshot[field])) {
      issues.push({ targetKey: key, reason: 'stale_data', message: 'Dados mudaram desde a revisão; pesquise e aprove novamente.' });
    }
    // Conditions come from the gateway response, never from browser snapshots.
    if (current?.promotionActive) issues.push({ targetKey: key, reason: 'active_promotion', message: 'Promoção ativa no anúncio reconsultado.' });
    if (current?.automaticPricing) issues.push({ targetKey: key, reason: 'automatic_pricing', message: 'Preço automático ativo no anúncio reconsultado.' });
    if (current?.state === 'pending_migration') issues.push({ targetKey: key, reason: 'pending_migration', message: 'Migração pendente no anúncio reconsultado.' });
    if (current?.state === 'paused') issues.push({ targetKey: key, reason: 'stale_data', message: 'Anúncio reconsultado não está ativo.' });
  }

  if (new Set(targets.map(t => t.newPrice)).size > 1) {
    for (const target of targets) issues.push({ targetKey: targetKey(target.snapshot), reason: 'divergent_prices', message: `Preço divergente: R$ ${target.newPrice.toFixed(2)}.` });
  }

  const selectedGroups = new Map<string, PriceTarget[]>();
  for (const target of targets.filter(t => t.snapshot.structure === 'traditional')) {
    const key = traditionalGroupKey(target.snapshot);
    selectedGroups.set(key, [...(selectedGroups.get(key) ?? []), target]);
  }
  for (const [key, selected] of selectedGroups) {
    const groups = state.traditionalGroups.filter(group => traditionalGroupKey({ ...group, id: group.itemId }) === key);
    const group = groups[0]?.variations ?? [];
    const selectedIds = selected.map(t => t.snapshot.variationId);
    const currentIds = group.map(x => x.variationId);
    const complete = groups.length === 1 && group.length > 0 && selectedIds.every(Boolean)
      && currentIds.every(Boolean) && new Set(selectedIds).size === selectedIds.length
      && new Set(currentIds).size === currentIds.length
      && selectedIds.length === currentIds.length && selectedIds.every(id => currentIds.includes(id))
      && group.every(x => x.structure === 'traditional' && traditionalGroupKey(x) === key && validIdentity(x));
    if (!complete) {
      for (const target of selected) issues.push({ targetKey: targetKey(target.snapshot), reason: 'incomplete_variation_group', message: 'Composição do anúncio tradicional mudou ou a seleção está incompleta; pesquise e aprove novamente.' });
    }
  }
  return issues;
}

export function traditionalGroupsFor(items: Listing[], selected: Listing[]): TraditionalGroup[] {
  const keys = new Set(selected.filter(x => x.structure === 'traditional').map(traditionalGroupKey));
  const groups = new Map<string, TraditionalGroup>();
  for (const item of items.filter(x => x.structure === 'traditional' && keys.has(traditionalGroupKey(x)))) {
    const key = traditionalGroupKey(item);
    if (!groups.has(key)) groups.set(key, { accountId: item.accountId, sellerId: item.sellerId, itemId: item.id, variations: [] });
    groups.get(key)!.variations.push(item);
  }
  return [...groups.values()];
}
