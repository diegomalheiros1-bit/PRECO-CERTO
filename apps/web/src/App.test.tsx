// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, listings, MockMarketplaceGateway, targetKey, type Listing, type OperationRecord, type SearchCriteria } from '@preco-certo/domain';
import { api } from './api';
import { App } from './App';

let container: HTMLDivElement;
let root: Root;
let searchSpy: ReturnType<typeof vi.spyOn>;
const allItems = structuredClone(listings);

function operation(): OperationRecord {
  return {
    id: 'demo-protocol-1', createdAt: '2026-09-25T12:00:00.000Z', user: 'operador-teste',
    criteria: { query: 'Norisk' }, status: 'partial_failure', note: 'simulado; nenhum envio ao Mercado Livre', issues: [],
    results: [
      { targetKey: targetKey(listings[0]), status: 'simulated', message: 'simulado; nenhum envio ao Mercado Livre', appliedPrice: null, snapshot: listings[0], intendedPrice: 529.9, percent: 15.22 },
      { targetKey: targetKey(listings[3]), status: 'blocked', message: 'Dados mudaram', appliedPrice: null, snapshot: listings[3], intendedPrice: 529.9, percent: 6 }
    ]
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = vi.fn();
  localStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(api, 'accounts').mockResolvedValue(accounts);
  vi.spyOn(api, 'history').mockResolvedValue([]);
  searchSpy = vi.spyOn(api, 'search').mockImplementation(criteria => new MockMarketplaceGateway().search(criteria));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks();
});

async function render() { await act(async () => root.render(<App />)); }
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === label || element.textContent?.trim().endsWith(label));
  if (!found) throw new Error(`Botão não encontrado: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  await act(async () => { setter?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function search() { await click('Buscar e revisar anúncios →'); }
function checkbox(sku: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Selecionar ${sku}"]`)!; }
function groupCheckbox(sku: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Selecionar grupo MLB-DEMO-200 pela variação ${sku}"]`)!; }
function priceInput(sku: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Novo preço de ${sku}"]`)!; }

describe('busca e etapas', () => {
  it('busca por nome e chega à revisão sem seleção automática', async () => {
    await render(); await search();
    expect(searchSpy).toHaveBeenCalledWith({ query: 'Capacete Norisk' });
    expect(container.textContent).toContain('2. Revise os anúncios encontrados');
    expect(container.textContent).toContain('0 combinação(ões) selecionada(s)');
  });
  it('busca SKU exato e expande as variações do anúncio tradicional', async () => {
    await render();
    await change(container.querySelector<HTMLSelectElement>('#searchMode')!, 'sku');
    await change(container.querySelector<HTMLInputElement>('#searchInput')!, 'RT-CL-PT-56');
    await search();
    expect(searchSpy).toHaveBeenCalledWith({ skus: ['RT-CL-PT-56'] });
    expect(container.textContent).toContain('RT-CL-VM-58');
  });
  it('busca lista mista separada por linha, vírgula e ponto e vírgula', async () => {
    await render();
    await change(container.querySelector<HTMLSelectElement>('#searchMode')!, 'list');
    await change(container.querySelector<HTMLTextAreaElement>('#searchInput')!, 'RT-CL-PT-56; Norisk Force II,\nRT-CL-PT-56');
    await search();
    expect(searchSpy).toHaveBeenCalledWith({ terms: ['RT-CL-PT-56', 'Norisk Force II'] });
    expect(container.textContent).toContain('NRK-FOR-P-PT');
    expect(container.textContent).toContain('RT-CL-VM-58');
  });
  it('bloqueia busca vazia e preço de referência inválido', async () => {
    await render();
    await change(container.querySelector<HTMLInputElement>('#searchInput')!, ' ');
    await search();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Informe um SKU');
    await change(container.querySelector<HTMLInputElement>('#searchInput')!, 'Norisk');
    await change(container.querySelector<HTMLInputElement>('#referencePrice')!, '0');
    await search();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('preço de referência');
  });
});

describe('revisão de anúncios', () => {
  it('seleciona por conta, todos os liberados e limpa a seleção', async () => {
    const current = structuredClone(allItems);
    current[1].promotionActive = false;
    searchSpy.mockImplementation((criteria: SearchCriteria) => new MockMarketplaceGateway(current).search(criteria));
    await render(); await search();
    await change(container.querySelector<HTMLSelectElement>('#selectionAccount')!, 'acc-centro');
    await click('Selecionar conta');
    expect(container.textContent).toContain('1 combinação(ões) selecionada(s)');
    await click('Selecionar todos os liberados');
    expect(container.textContent).toContain('5 combinação(ões) selecionada(s)');
    await click('Limpar seleção');
    expect(container.textContent).toContain('0 combinação(ões) selecionada(s)');
  });
  it('seleciona e edita todo o grupo tradicional por uma variação', async () => {
    await render(); await search();
    await act(async () => groupCheckbox('RT-CL-PT-56').click());
    expect(['RT-CL-PT-56', 'RT-CL-PT-58', 'RT-CL-VM-58'].every(sku => groupCheckbox(sku).checked)).toBe(true);
    await change(priceInput('RT-CL-PT-56'), '600,00');
    expect(['RT-CL-PT-56', 'RT-CL-PT-58', 'RT-CL-VM-58'].map(sku => priceInput(sku).value)).toEqual(['600,00', '600,00', '600,00']);
  });
  it('desabilita seleção e edição de itens bloqueados e de grupo com integrante bloqueado', async () => {
    const current = structuredClone(allItems);
    current[4].automaticPricing = true;
    searchSpy.mockImplementation((criteria: SearchCriteria) => new MockMarketplaceGateway(current).search(criteria));
    await render(); await search();
    expect(checkbox('FORCE-BR-M').disabled).toBe(true);
    expect(priceInput('FORCE-BR-M').disabled).toBe(true);
    expect(groupCheckbox('RT-CL-PT-56').disabled).toBe(true);
    expect(priceInput('RT-CL-VM-58').disabled).toBe(true);
  });
  it('mostra reajuste positivo e negativo por linha', async () => {
    await render(); await search();
    const row = priceInput('NRK-FOR-P-PT').closest('tr')!;
    expect(row.querySelector('.delta-up')?.textContent).toContain('+15,22%');
    await change(priceInput('NRK-FOR-P-PT'), '400,00');
    expect(row.querySelector('.delta-down')?.textContent).toContain('-13,02%');
  });
  it('mostra um único aviso na revisão, destaca linhas e remove o erro após correção', async () => {
    await render(); await search();
    await act(async () => checkbox('NRK-FOR-P-PT').click());
    await act(async () => groupCheckbox('RT-CL-PT-56').click());
    await change(priceInput('NRK-FOR-P-PT'), '600,00');
    await change(priceInput('RT-CL-PT-56'), '500,00');
    await click('Continuar para aprovação →');
    expect(container.textContent).toContain('2. Revise os anúncios encontrados');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('.error-banner')).toBeNull();
    const notice = container.querySelector('.review-top .mismatch-notice')!;
    expect(notice.textContent).toContain('Capacete Norisk Force II');
    expect(notice.textContent).toContain('NRK-FOR-P-PT');
    expect(notice.textContent).toContain('R$ 600,00');
    expect(notice.textContent).toContain('Capacete Norisk Route Classic');
    expect(notice.textContent).toContain('RT-CL-PT-56');
    expect(notice.textContent).toContain('R$ 500,00');
    expect(checkbox('NRK-FOR-P-PT').checked).toBe(true);
    expect(groupCheckbox('RT-CL-PT-56').checked).toBe(true);
    expect(priceInput('NRK-FOR-P-PT').value).toBe('600,00');
    expect(priceInput('RT-CL-PT-56').value).toBe('500,00');
    expect(container.querySelectorAll('.price-mismatch')).toHaveLength(4);
    await change(priceInput('NRK-FOR-P-PT'), '500,00');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('.price-mismatch')).toHaveLength(0);
    await click('Continuar para aprovação →');
    expect(container.textContent).toContain('3. Aprovação final');
    await click('← Voltar para revisão');
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('.price-mismatch')).toHaveLength(0);
  });
  it('exige seleção e conserva preço inválido para correção na revisão', async () => {
    await render(); await search();
    await click('Continuar para aprovação →');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Selecione ao menos uma');
    await act(async () => checkbox('NRK-FOR-P-PT').click());
    await change(priceInput('NRK-FOR-P-PT'), '12,345');
    await click('Continuar para aprovação →');
    expect(container.textContent).toContain('2. Revise os anúncios encontrados');
    expect(priceInput('NRK-FOR-P-PT').value).toBe('12,345');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('preço inválido');
  });
});

describe('aprovação, resultado, histórico e tema', () => {
  it('abre contas fictícias pelo menu e por Gerenciar sem sugerir conexão real', async () => {
    await render();
    await click('Contas conectadas');
    expect(container.textContent).toContain('Nenhuma conta real está conectada');
    expect(container.textContent).toContain('não há conexão ativa com o Mercado Livre');
    expect(container.querySelectorAll('.account-manage')).toHaveLength(3);
    expect(container.textContent).toContain('Moto Norte (DEMO)');
    expect(container.textContent).toContain('Capacetes Centro (DEMO)');
    expect(container.textContent).toContain('Rota Sul (DEMO)');
    expect(container.textContent).toContain('Disponível no simulador');
    expect(container.textContent).toContain('Indisponível no simulador');
    expect([...container.querySelectorAll('.account-tools button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    await click('Atualizar preços');
    await click('Gerenciar');
    expect(container.textContent).toContain('Gerenciamento de contas');
  });
  it('exige checkbox e confirmação final, preserva seleção ao voltar e mostra protocolo', async () => {
    const record = { ...operation(), status: 'simulated' as const, results: [operation().results[0]] };
    const executeSpy = vi.spyOn(api, 'execute').mockResolvedValue({ operation: record });
    await render(); await search();
    await act(async () => checkbox('NRK-FOR-P-PT').click());
    await click('Continuar para aprovação →');
    expect(container.textContent).toContain('3. Aprovação final');
    await click('← Voltar para revisão');
    expect(checkbox('NRK-FOR-P-PT').checked).toBe(true);
    await click('Continuar para aprovação →');
    await click('Confirmar simulação ✓');
    expect(executeSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Marque a confirmação');
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Confirmo que revisei os anúncios"]')!.click());
    await click('Confirmar simulação ✓');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Confirmar na demonstração');
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('demo-protocol-1');
    expect(container.textContent).toContain('não aplicado');
  });
  it('filtra histórico SQLite por resultado e texto e abre detalhes', async () => {
    vi.mocked(api.history).mockResolvedValue([operation()]);
    await render(); await click('Histórico');
    expect(container.querySelectorAll('.history-table tbody tr')).toHaveLength(2);
    await change(container.querySelector<HTMLSelectElement>('#historyFilter')!, 'blocked');
    expect(container.querySelectorAll('.history-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('RT-CL-PT-56');
    await change(container.querySelector<HTMLInputElement>('#historySearch')!, 'NRK-FOR-P-PT');
    expect(container.textContent).toContain('Nenhum registro encontrado');
    await change(container.querySelector<HTMLInputElement>('#historySearch')!, 'Moto Norte');
    expect(container.querySelectorAll('.history-table tbody tr')).toHaveLength(1);
    await click('Detalhes');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('não aplicado');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('VAR-201');
  });
  it('inicia em tema claro e salva a preferência escura', async () => {
    await render();
    const picker = container.querySelector<HTMLSelectElement>('#themePicker')!;
    expect(picker.value).toBe('light');
    await change(picker, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });
  it('respeita preferência de tema salva', async () => {
    localStorage.setItem('theme', 'dark');
    await render();
    expect(container.querySelector<HTMLSelectElement>('#themePicker')!.value).toBe('dark');
  });
});
