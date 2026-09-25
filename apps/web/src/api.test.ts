import { describe, expect, it } from 'vitest';
import { parsePrice, percentChange } from '@preco-certo/domain';
describe('regras compartilhadas pela interface',()=>{
  it('formata a intenção sem corrigir entrada inválida',()=>{expect(parsePrice('10abc')).toBeNull();expect(parsePrice('10,50')).toBe(10.5)});
  it('calcula aumento e redução',()=>{expect(percentChange(100,110)).toBe(10);expect(percentChange(100,90)).toBe(-10)});
});
