export type ListingStructure = 'traditional' | 'user_product';
export type ListingState = 'active' | 'paused' | 'pending_migration';
export type BlockReason =
  | 'active_promotion' | 'automatic_pricing' | 'pending_migration'
  | 'incomplete_variation_group' | 'stale_data' | 'invalid_price'
  | 'divergent_prices' | 'duplicate_target' | 'invalid_identity';

export interface Account { id: string; sellerId: string; nickname: string; connected: boolean; demo: boolean }
export interface Listing {
  id: string; variationId?: string; userProductId?: string; accountId: string; sellerId: string;
  title: string; sku: string; size: string; color: string; structure: ListingStructure;
  groupId?: string; currency: 'BRL'; price: number; state: ListingState;
  promotionActive: boolean; automaticPricing: boolean;
}
export interface SearchCriteria { query?: string; skus?: string[]; names?: string[] }
export interface PriceTarget { snapshot: Listing; newPrice: number }
export interface TraditionalGroup { accountId: string; sellerId: string; itemId: string; variations: Listing[] }
export interface SearchResult { listings: Listing[]; traditionalGroups: TraditionalGroup[] }
export interface RevalidationState { currentTargets: Listing[]; traditionalGroups: TraditionalGroup[] }
export interface ValidationIssue { targetKey: string | null; reason: BlockReason; message: string }
export interface ExecutionResult {
  targetKey: string; status: 'simulated' | 'blocked' | 'failed'; message: string;
  appliedPrice: number | null;
}
export interface OperationRecord {
  id: string; createdAt: string; user: string; criteria: SearchCriteria;
  status: 'simulated' | 'blocked' | 'partial_failure'; note: string;
  issues: ValidationIssue[];
  results: Array<ExecutionResult & { snapshot: Listing; intendedPrice: number; percent: number }>;
}
