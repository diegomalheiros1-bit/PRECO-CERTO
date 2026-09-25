import { parsePrice, selectionAvailability, targetKey, type Listing, type SearchCriteria, type SearchResult } from '@preco-certo/domain';

export type SearchMode = 'sku' | 'name' | 'list';
export type PriceInputs = Record<string, string>;

export function buildSearchCriteria(mode: SearchMode, input: string): SearchCriteria | null {
  const value = input.trim();
  if (!value) return null;
  if (mode === 'sku') return { skus: [value] };
  if (mode === 'name') return { query: value };
  const terms = [...new Set(value.split(/[\n,;]+/).map(term => term.trim()).filter(Boolean))];
  return terms.length ? { terms } : null;
}

export function eligibleKeys(search: SearchResult, accountId?: string): Set<string> {
  const result = new Set<string>();
  for (const item of search.listings) {
    if (accountId && item.accountId !== accountId) continue;
    const availability = selectionAvailability(item, search);
    if (availability.selectable) for (const member of availability.group) result.add(targetKey(member));
  }
  return result;
}

export function updateGroupPrice(inputs: PriceInputs, item: Listing, search: SearchResult, value: string): PriceInputs {
  const availability = selectionAvailability(item, search);
  if (!availability.selectable) return inputs;
  const next = { ...inputs };
  for (const member of availability.group) next[targetKey(member)] = value;
  return next;
}

export function reviewPriceIssues(items: Listing[], inputs: PriceInputs): string[] {
  const problems = items.filter(item => parsePrice(inputs[targetKey(item)]) === null);
  const issues = problems.map(item => `${item.accountId} · ${item.id} · ${item.sku}: preço inválido (${inputs[targetKey(item)] ?? 'vazio'}).`);
  const valid = items.filter(item => parsePrice(inputs[targetKey(item)]) !== null);
  const prices = new Set(valid.map(item => Math.round(parsePrice(inputs[targetKey(item)])! * 100)));
  if (prices.size > 1) {
    issues.push('Regra deste produto: todas as combinações selecionadas devem receber o mesmo novo preço.');
    for (const item of valid) issues.push(`${item.accountId} · ${item.id} · ${item.sku}: ${inputs[targetKey(item)]}.`);
  }
  return issues;
}
