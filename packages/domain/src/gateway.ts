import type { Account, ExecutionResult, PriceTarget, RevalidationState, SearchCriteria, SearchResult } from './types.js';

export interface MarketplaceGateway {
  listAccounts(): Promise<Account[]>;
  search(criteria: SearchCriteria): Promise<SearchResult>;
  revalidate(targets: PriceTarget[]): Promise<RevalidationState>;
  updatePrices(targets: PriceTarget[]): Promise<ExecutionResult[]>;
}

export class MercadoLivreGateway implements MarketplaceGateway {
  private unavailable(): never { throw new Error('Gateway Mercado Livre não configurado. Somente leitura será habilitada após OAuth com usuários de teste.'); }
  async listAccounts(): Promise<Account[]> { return this.unavailable(); }
  async search(_criteria: SearchCriteria): Promise<SearchResult> { return this.unavailable(); }
  async revalidate(_targets: PriceTarget[]): Promise<RevalidationState> { return this.unavailable(); }
  async updatePrices(_targets: PriceTarget[]): Promise<ExecutionResult[]> { throw new Error('Escrita real desabilitada.'); }
}
