import type { MarketplaceGateway } from './gateway.js';
import type { Account, ExecutionResult, Listing, PriceTarget, SearchCriteria } from './types.js';
import { accounts, listings } from './fixtures.js';
import { searchListings, targetKey, traditionalGroupsFor } from './pricing.js';

export class MockMarketplaceGateway implements MarketplaceGateway {
  constructor(private readonly items: Listing[] = structuredClone(listings), private readonly demoAccounts: Account[] = structuredClone(accounts)) {}
  async listAccounts() { return structuredClone(this.demoAccounts); }
  async search(criteria: SearchCriteria) {
    const found = searchListings(this.items, criteria);
    const groups = traditionalGroupsFor(this.items, found);
    const foundKeys = new Set(found.map(targetKey));
    // Show every variation when even one variation matched a name or exact SKU.
    const expanded = [...found, ...groups.flatMap(group => group.variations).filter(x => !foundKeys.has(targetKey(x)))];
    return structuredClone({ listings: expanded, traditionalGroups: groups });
  }
  async revalidate(targets: PriceTarget[]) {
    const currentTargets = this.items.filter(item => targets.some(t =>
      t.snapshot.accountId === item.accountId && t.snapshot.sellerId === item.sellerId &&
      t.snapshot.id === item.id &&
      (t.snapshot.structure === 'traditional' ? t.snapshot.variationId === item.variationId : t.snapshot.userProductId === item.userProductId)
    ));
    const traditionalGroups = traditionalGroupsFor(this.items, targets.map(t => t.snapshot));
    return structuredClone({ currentTargets, traditionalGroups });
  }
  async updatePrices(targets: PriceTarget[]): Promise<ExecutionResult[]> {
    return targets.map(t => ({ targetKey: targetKey(t.snapshot), status: 'simulated', message: 'simulado; nenhum envio ao Mercado Livre', appliedPrice: null }));
  }
}
