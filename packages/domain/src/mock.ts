import type { MarketplaceGateway } from './gateway.js';
import type { Account, ExecutionResult, Listing, PriceTarget, SearchCriteria } from './types.js';
import { accounts, listings } from './fixtures.js';
import { searchListings } from './pricing.js';
export class MockMarketplaceGateway implements MarketplaceGateway {
  constructor(private readonly items: Listing[] = structuredClone(listings), private readonly demoAccounts: Account[] = structuredClone(accounts)) {}
  async listAccounts() { return structuredClone(this.demoAccounts); }
  async search(criteria: SearchCriteria) { return structuredClone(searchListings(this.items, criteria)); }
  async revalidate(targets: PriceTarget[]) { const keys = new Set(targets.map(t => `${t.snapshot.id}:${t.snapshot.variationId ?? ''}`)); return structuredClone(this.items.filter(x => keys.has(`${x.id}:${x.variationId ?? ''}`))); }
  async updatePrices(targets: PriceTarget[]): Promise<ExecutionResult[]> { return targets.map(t => ({ itemId:t.snapshot.id, status:'simulated', message:'simulado; nenhum envio ao Mercado Livre' })); }
}

