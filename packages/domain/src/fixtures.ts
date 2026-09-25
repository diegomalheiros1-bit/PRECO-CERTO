import type { Account, Listing } from './types.js';
export const accounts: Account[] = [
  { id: 'acc-norte', sellerId: 'TEST-1001', nickname: 'Moto Norte (DEMO)', connected: true, demo: true },
  { id: 'acc-centro', sellerId: 'TEST-1002', nickname: 'Capacetes Centro (DEMO)', connected: true, demo: true },
  { id: 'acc-sul', sellerId: 'TEST-1003', nickname: 'Rota Sul (DEMO)', connected: false, demo: true }
];
const base = { currency: 'BRL' as const, state: 'active' as const, promotionActive: false, automaticPricing: false };
export const listings: Listing[] = [
  { ...base, id:'MLB-DEMO-101', userProductId:'UP-101', accountId:'acc-norte', sellerId:'TEST-1001', title:'Capacete Norisk Force II', sku:'NRK-FOR-P-PT', size:'P', color:'Preto', structure:'user_product', price:459.90 },
  { ...base, id:'MLB-DEMO-102', userProductId:'UP-102', accountId:'acc-centro', sellerId:'TEST-1002', title:'Capacete Norisk Force II', sku:'FORCE-BR-M', size:'M', color:'Branco', structure:'user_product', price:469.90, promotionActive:true },
  { ...base, id:'MLB-DEMO-103', userProductId:'UP-103', accountId:'acc-sul', sellerId:'TEST-1003', title:'Capacete Norisk Route', sku:'ROUTE-AZ-58', size:'58', color:'Azul', structure:'user_product', price:519.00, automaticPricing:true },
  { ...base, id:'MLB-DEMO-200', variationId:'VAR-201', groupId:'GRP-200', accountId:'acc-norte', sellerId:'TEST-1001', title:'Capacete Norisk Route Classic', sku:'RT-CL-PT-56', size:'56', color:'Preto', structure:'traditional', price:499.90 },
  { ...base, id:'MLB-DEMO-200', variationId:'VAR-202', groupId:'GRP-200', accountId:'acc-norte', sellerId:'TEST-1001', title:'Capacete Norisk Route Classic', sku:'RT-CL-PT-58', size:'58', color:'Preto', structure:'traditional', price:499.90 },
  { ...base, id:'MLB-DEMO-200', variationId:'VAR-203', groupId:'GRP-200', accountId:'acc-norte', sellerId:'TEST-1001', title:'Capacete Norisk Route Classic', sku:'RT-CL-VM-58', size:'58', color:'Vermelho', structure:'traditional', price:499.90 },
  { ...base, id:'MLB-DEMO-301', userProductId:'UP-301', accountId:'acc-centro', sellerId:'TEST-1002', title:'Capacete Norisk Force Articulado', sku:'NF-MIG-GG', size:'GG', color:'Grafite', structure:'user_product', price:629.90, state:'pending_migration' }
];

