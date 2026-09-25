import type { Account, ExecutionResult, Listing, PriceTarget, SearchCriteria } from './types.js';

export interface MarketplaceGateway {
  listAccounts(): Promise<Account[]>;
  search(criteria: SearchCriteria): Promise<Listing[]>;
  revalidate(targets: PriceTarget[]): Promise<Listing[]>;
  updatePrices(targets: PriceTarget[]): Promise<ExecutionResult[]>;
}

export class MercadoLivreGateway implements MarketplaceGateway {
  private unavailable(): never { throw new Error('Gateway Mercado Livre não configurado. Somente leitura será habilitada após OAuth com usuários de teste.'); }
  async listAccounts(): Promise<Account[]> { return this.unavailable(); }
  async search(_criteria: SearchCriteria): Promise<Listing[]> { return this.unavailable(); }
  async revalidate(_targets: PriceTarget[]): Promise<Listing[]> { return this.unavailable(); }
  async updatePrices(_targets: PriceTarget[]): Promise<ExecutionResult[]> { throw new Error('Escrita real desabilitada.'); }
}

