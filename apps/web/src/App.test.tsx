// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, listings, MockMarketplaceGateway, type SearchResult } from '@preco-certo/domain';
import { api } from './api';
import { App } from './App';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(api, 'accounts').mockResolvedValue(accounts);
  vi.spyOn(api, 'history').mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks();
});

async function renderAndSearch(response: SearchResult) {
  vi.spyOn(api, 'search').mockResolvedValue(response);
  await act(async () => root.render(<App />));
  const searchButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Pesquisar')!;
  await act(async () => searchButton.click());
}

function checkbox(sku: string) {
  return container.querySelector<HTMLInputElement>(`input[aria-label="Selecionar ${sku}"]`)!;
}

describe('seleção na interface', () => {
  it('desabilita itens com promoção, preço automático ou migração', async () => {
    const response = await new MockMarketplaceGateway().search({ query: 'Capacete Norisk' });
    await renderAndSearch(response);
    expect(checkbox('FORCE-BR-M').disabled).toBe(true);
    expect(checkbox('ROUTE-AZ-58').disabled).toBe(true);
    expect(checkbox('NF-MIG-GG').disabled).toBe(true);
    expect(checkbox('NRK-FOR-P-PT').disabled).toBe(false);
    expect(container.textContent).toContain('Promoção ativa');
  });
  it('seleciona e remove as três variações tradicionais juntas', async () => {
    const response = await new MockMarketplaceGateway().search({ skus: ['RT-CL-PT-56'] });
    await renderAndSearch(response);
    const checks = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(3);
    await act(async () => checks[0].click());
    expect(checks.every(input => input.checked)).toBe(true);
    expect(container.textContent).toContain('3 selecionada(s)');
    await act(async () => checks[1].click());
    expect(checks.every(input => !input.checked)).toBe(true);
  });
  it('desabilita todo o grupo quando uma variação está bloqueada', async () => {
    const current = structuredClone(listings);
    current[4].automaticPricing = true;
    const response = await new MockMarketplaceGateway(current).search({ skus: ['RT-CL-PT-56'] });
    await renderAndSearch(response);
    const checks = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(3);
    expect(checks.every(input => input.disabled)).toBe(true);
    expect(container.textContent).toContain('RT-CL-PT-58');
  });
  it('desabilita busca parcial sem todas as variações visíveis', async () => {
    const complete = await new MockMarketplaceGateway().search({ skus: ['RT-CL-PT-56'] });
    await renderAndSearch({ ...complete, listings: [complete.listings[0]] });
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(container.textContent).toContain('Grupo tradicional incompleto');
  });
});
