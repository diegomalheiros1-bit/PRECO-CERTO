import { describe,expect,it } from 'vitest';
import { listings } from './fixtures.js';
import { parsePrice, searchListings, validateTargets } from './pricing.js';
const target=(i:number,newPrice=550)=>({snapshot:structuredClone(listings[i]),newPrice});
describe('pesquisa',()=>{
 it('encontra nome em contas, tamanhos e cores sem criar seleção',()=>{const found=searchListings(listings,{query:'capacete norisk'});expect(found.length).toBe(7);expect(new Set(found.map(x=>x.accountId)).size).toBe(3)});
 it('faz SKU exato sem confundir SKUs parecidos ou diferentes',()=>expect(searchListings(listings,{skus:['RT-CL-PT-56']}).map(x=>x.sku)).toEqual(['RT-CL-PT-56']));
});
describe('validação de preço',()=>{
 it.each(['', '0','-1','12.345','12abc',0,-2,1.234])('rejeita %p',v=>expect(parsePrice(v)).toBeNull());
 it.each(['12','12,3','12.34',12.34])('aceita %p',v=>expect(parsePrice(v)).toBe(Number(String(v).replace(',','.'))));
 it('preços divergentes identificam os itens',()=>{const issues=validateTargets([target(0,500),target(1,501)],listings);expect(issues.filter(x=>x.reason==='divergent_prices')).toHaveLength(2)});
 it('bloqueia seleção parcial de variações tradicionais',()=>expect(validateTargets([target(3)],listings).some(x=>x.reason==='incomplete_variation_group')).toBe(true));
 it('permite user product independente mas trata tradicional em grupo',()=>{expect(validateTargets([target(0)],listings)).toEqual([]);expect(validateTargets([target(3),target(4),target(5)],listings).some(x=>x.reason==='incomplete_variation_group')).toBe(false)});
 it('sinaliza promoção, automático e migração',()=>{expect(validateTargets([target(1),target(2),target(6)],listings).map(x=>x.reason)).toEqual(expect.arrayContaining(['active_promotion','automatic_pricing','pending_migration']))});
 it.each(['price','sku','sellerId','state','structure'] as const)('bloqueia mudança em %s',field=>{const current=structuredClone(listings);(current[0] as any)[field]=field==='price'?999:'mudou';expect(validateTargets([target(0)],current).some(x=>x.reason==='stale_data')).toBe(true)});
});
