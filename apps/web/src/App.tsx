import { useEffect, useMemo, useState } from 'react';
import {
  parsePrice, percentChange, selectionAvailability, targetKey,
  type Account, type Listing, type OperationRecord, type SearchCriteria, type SearchResult
} from '@preco-certo/domain';
import { api } from './api';
import { buildSearchCriteria, eligibleKeys, reviewPriceIssues, updateGroupPrice, type PriceInputs, type SearchMode } from './workflow';

type View = 'prices' | 'history' | 'accounts';
type Step = 1 | 2 | 3 | 4;
type HistoryEntry = { operation: OperationRecord; result: OperationRecord['results'][number] };
const emptySearch: SearchResult = { listings: [], traditionalGroups: [] };
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (oldPrice: number, nextPrice: number) => {
  const value = percentChange(oldPrice, nextPrice);
  return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
};
const statusLabel = (status: string) => status === 'simulated' ? 'Simulado' : status === 'blocked' ? 'Bloqueado' : 'Falha';

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');
  const [view, setView] = useState<View>('prices');
  const [step, setStep] = useState<Step>(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<OperationRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDetail, setHistoryDetail] = useState<HistoryEntry | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('name');
  const [searchInput, setSearchInput] = useState('Capacete Norisk');
  const [referencePrice, setReferencePrice] = useState('529,90');
  const [criteria, setCriteria] = useState<SearchCriteria>({});
  const [searchResult, setSearchResult] = useState<SearchResult>(emptySearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<PriceInputs>({});
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<OperationRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { api.accounts().then(setAccounts).catch(e => setError(e.message)); api.history().then(setHistory).catch(() => {}); }, []);
  const items = searchResult.listings;
  const selectedItems = useMemo(() => items.filter(item => selected.has(targetKey(item))), [items, selected]);
  const available = useMemo(() => eligibleKeys(searchResult), [searchResult]);
  const blockedCount = items.length - available.size;
  const accountName = (item: Listing) => accounts.find(account => account.id === item.accountId)?.nickname ?? item.accountId;
  const historyRows = useMemo<HistoryEntry[]>(() => history.flatMap(operation => operation.results.map(result => ({ operation, result }))), [history]);
  const visibleHistory = historyRows.filter(({ operation, result }) => {
    const selectedStatus = historyFilter === 'all' || result.status === historyFilter;
    const term = historyQuery.trim().toLocaleLowerCase('pt-BR');
    const matches = !term || [operation.id, result.snapshot.sku, result.snapshot.title, result.snapshot.id,
      result.snapshot.variationId, result.snapshot.userProductId, result.snapshot.accountId,
      result.snapshot.sellerId, accountName(result.snapshot)].some(value => (value ?? '').toLocaleLowerCase('pt-BR').includes(term));
    return selectedStatus && matches;
  });

  function switchView(next: View) {
    setView(next); setError('');
    if (next === 'history') api.history().then(setHistory).catch(e => setError(e.message));
    window.scrollTo?.(0, 0);
  }

  async function search() {
    const nextCriteria = buildSearchCriteria(searchMode, searchInput);
    if (!nextCriteria) { setError('Informe um SKU, nome ou lista para pesquisar.'); return; }
    if (parsePrice(referencePrice) === null) { setError('Informe um preço de referência positivo com até duas casas decimais.'); return; }
    setLoading(true); setError('');
    try {
      const found = await api.search(nextCriteria);
      setCriteria(nextCriteria); setSearchResult(found); setSelected(new Set());
      setPrices(Object.fromEntries(found.listings.map(item => [targetKey(item), referencePrice])));
      if (!found.listings.length) { setError('Nenhum anúncio corresponde à pesquisa. Ajuste o termo e tente novamente.'); return; }
      setStep(2); window.scrollTo?.(0, 0);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  function toggleItem(item: Listing) {
    const availability = selectionAvailability(item, searchResult);
    if (!availability.selectable) return;
    setError('');
    const keys = availability.group.map(targetKey);
    setSelected(previous => {
      const next = new Set(previous);
      const allSelected = keys.every(key => next.has(key));
      for (const key of keys) allSelected ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function selectAll() { setError(''); setSelected(new Set(available)); }
  function selectAccount(accountId: string) {
    if (!accountId) { setError('Escolha uma conta para selecionar.'); return; }
    setError(''); setSelected(previous => new Set([...previous, ...eligibleKeys(searchResult, accountId)]));
  }
  function editPrice(item: Listing, value: string) {
    setError('');
    setPrices(previous => updateGroupPrice(previous, item, searchResult, value));
  }

  function toApproval() {
    if (!selectedItems.length) { setError('Selecione ao menos uma combinação liberada.'); return; }
    if (selectedItems.some(item => !selectionAvailability(item, searchResult).selectable)) { setError('Há itens bloqueados na seleção. Refaça a pesquisa.'); return; }
    const problems = reviewPriceIssues(selectedItems, prices);
    if (mismatch) { setError(''); return; }
    if (problems.length) { setError(problems.join('\n')); return; }
    setApprovalChecked(false); setError(''); setStep(3); window.scrollTo?.(0, 0);
  }

  function requestConfirmation() {
    if (!approvalChecked) { setError('Marque a confirmação de revisão para continuar.'); return; }
    setError(''); setConfirmOpen(true);
  }

  async function execute() {
    if (!approvalChecked) return;
    const problems = reviewPriceIssues(selectedItems, prices);
    if (problems.length) { setConfirmOpen(false); setStep(2); setError(problems.join('\n')); return; }
    setConfirmOpen(false); setLoading(true); setError('');
    const targets = selectedItems.map(snapshot => ({ snapshot, newPrice: parsePrice(prices[targetKey(snapshot)])! }));
    try {
      const response = await api.execute(criteria, targets);
      setResult(response.operation); setStep(4);
      setHistory(await api.history()); window.scrollTo?.(0, 0);
    } catch (e: any) {
      if (e.data?.operation) {
        setResult(e.data.operation); setStep(4);
        setHistory(await api.history()); window.scrollTo?.(0, 0);
      } else setError(e.message);
    } finally { setLoading(false); }
  }

  function resetFlow() {
    setStep(1); setSearchResult(emptySearch); setSelected(new Set()); setPrices({});
    setApprovalChecked(false); setResult(null); setError('');
  }

  const screenName = view === 'prices' ? 'Atualizar preços' : view === 'history' ? 'Histórico' : 'Contas conectadas';
  const selectedPrices = selectedItems.map(item => parsePrice(prices[targetKey(item)]));
  const mismatch = new Set(selectedPrices.filter((value): value is number => value !== null).map(value => Math.round(value * 100))).size > 1;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="logo">P</span><strong>PreçoCerto</strong></div>
      <div className="nav-label">Operação</div>
      <button className={`nav-item ${view === 'prices' ? 'active' : ''}`} onClick={() => switchView('prices')}><span>⇄</span><span>Atualizar preços</span></button>
      <button className={`nav-item ${view === 'history' ? 'active' : ''}`} onClick={() => switchView('history')}><span>▣</span><span>Histórico</span></button>
      <div className="nav-label settings-label">Configurações</div>
      <button className={`nav-item ${view === 'accounts' ? 'active' : ''}`} onClick={() => switchView('accounts')}><span>♙</span><span>Contas conectadas</span></button>
      <div className="side-foot">Demonstração local · Sem conexão real</div>
    </aside>
    <div className="main">
      <header className="topbar"><div className="crumb">{view === 'accounts' ? 'Configurações' : 'Operação'} &nbsp;/&nbsp; <b>{screenName}</b></div><div className="profile"><label htmlFor="themePicker">Tema</label><select id="themePicker" className="input theme-picker" aria-label="Tema da interface" value={theme} onChange={event => setTheme(event.target.value as 'light' | 'dark')}><option value="light">Claro</option><option value="dark">Escuro</option></select><span className="avatar">DM</span><span className="profile-name">Demonstração</span></div></header>
      <main className="content">
        {error && <div className="notice danger error-banner" role="alert"><span>⚠</span><div>{error.split('\n').map((line, index) => <div key={index}>{line}</div>)}</div></div>}

        {view === 'prices' && <>
          <div className="title-row"><div><div className="eyebrow">Gestão de anúncios</div><h1 className="title">Atualização segura de preços</h1><p className="subtitle">Revise cada anúncio antes de simular qualquer alteração.</p></div><span className="demo-tag">● Demonstração · nenhuma conta real conectada</span></div>
          <div className="steps" aria-label="Etapas da operação">{(['Informar alterações', 'Revisar anúncios', 'Aprovação final', 'Resultado'] as const).map((label, index) => <div className="step-wrap" key={label}><div className={`step ${step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}`}><span className="num">{step > index + 1 ? '✓' : index + 1}</span><span>{label}</span></div>{index < 3 && <div className="connector"/>}</div>)}</div>

          {step === 1 && <>
            <div className="grid intro-grid"><article className="card"><div className="card-head"><div><h2 className="card-title">1. Informe o que deseja alterar</h2><p className="card-desc">Busque produtos fictícios por nome, modelo ou SKU.</p></div></div><div className="card-body">
              <label className="label" htmlFor="searchMode">Como deseja localizar os produtos?</label>
              <select id="searchMode" className="input" value={searchMode} onChange={event => setSearchMode(event.target.value as SearchMode)}><option value="sku">SKU exato</option><option value="name">Nome do produto, marca ou modelo</option><option value="list">Lista de SKUs ou nomes</option></select>
              <label className="label field-gap" htmlFor="searchInput">{searchMode === 'sku' ? 'SKU exato' : searchMode === 'list' ? 'SKUs ou nomes dos produtos' : 'Nome, marca ou modelo'}</label>
              {searchMode === 'list' ? <textarea id="searchInput" className="input textarea" rows={4} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Um SKU ou nome por linha, vírgula ou ponto e vírgula"/> : <input id="searchInput" className="input" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={searchMode === 'sku' ? 'Ex.: RT-CL-PT-56' : 'Ex.: Capacete Norisk'}/>}
              <button className="btn primary search-inline" disabled={loading} onClick={search}>{loading ? 'Buscando…' : searchMode === 'sku' ? 'Buscar' : 'Buscar produtos'}</button>
              <p className="hint">{searchMode === 'list' ? 'Cada SKU é comparado exatamente; os demais termos procuram nome ou modelo.' : searchMode === 'sku' ? 'Um SKU encontra suas ocorrências; anúncios tradicionais mostram o grupo completo.' : 'Encontre modelos, tamanhos e cores nas três contas fictícias.'}</p>
              <label className="label field-gap" htmlFor="referencePrice">Novo preço de referência (R$)</label><div className="row"><input id="referencePrice" className="input" inputMode="decimal" value={referencePrice} onChange={event => setReferencePrice(event.target.value)} placeholder="Ex.: 529,90"/><button className="btn" disabled title="Em desenvolvimento">⇧ Importar planilha</button></div><p className="hint">O preço poderá ser ajustado por combinação na próxima etapa. Importação de planilha: em desenvolvimento.</p>
              <div className="notice info"><span>ⓘ</span><div>Massa fictícia: capacetes Norisk Force e Route, com tamanhos, cores e anúncios em três contas.</div></div>
            </div></article>
              <article className="card"><div className="card-head"><div><h2 className="card-title">Contas do vendedor</h2><p className="card-desc">Autorização individual será implementada com OAuth.</p></div><button className="btn small" onClick={() => switchView('accounts')}>Gerenciar</button></div><div className="card-body"><div className="account-list">{accounts.map(account => <div className="account" key={account.id}><span className="account-name"><span className="shop-icon">▣</span>{account.nickname}</span><span className="connected">DEMO</span></div>)}</div><div className="notice warn"><span>🔒</span><div>Estas contas são fictícias. Nenhum dado ou preço será enviado ao Mercado Livre.</div></div></div></article></div>
            <div className="footer-actions"><span className="tiny">Etapa 1 de 4 · A busca não altera anúncios.</span><button className="btn primary" disabled={loading} onClick={search}>{loading ? 'Buscando…' : 'Buscar e revisar anúncios →'}</button></div>
          </>}

          {step === 2 && <>
            <article className="card"><div className="card-head"><div><h2 className="card-title">2. Revise os anúncios encontrados</h2><p className="card-desc">Selecione apenas as combinações liberadas e ajuste o novo preço.</p></div><button className="btn small" onClick={() => { setStep(1); setError(''); }}>Editar busca</button></div>
              <div className="card-body review-top"><div className="metric-row"><div className="metric"><b>{items.length}</b><small>Combinações encontradas</small></div><div className="metric"><b>{available.size}</b><small>Liberadas</small></div><div className="metric"><b>{blockedCount}</b><small>Bloqueadas</small></div></div>
                <div className={`notice ${blockedCount ? 'warn' : 'info'}`}><span>{blockedCount ? '⚠' : 'ⓘ'}</span><div>{blockedCount ? `${blockedCount} combinação(ões) bloqueada(s). Veja o motivo em cada linha.` : 'Nenhuma combinação está selecionada automaticamente.'} Anúncios tradicionais são selecionados e editados como grupo completo.</div></div>
                {mismatch && <div className="notice danger mismatch-notice" role="alert"><span>⚠</span><div><b>Novos preços divergentes entre os selecionados.</b> A regra deste produto exige um preço único nesta operação. Corrija os valores abaixo para continuar.<ul className="mismatch-list">{selectedItems.map(item => <li key={targetKey(item)}>{item.title} · <code>{item.sku}</code> · {accountName(item)}: <strong>R$ {prices[targetKey(item)] || 'vazio'}</strong></li>)}</ul></div></div>}
                <div className="selection-bar"><button className="btn" onClick={selectAll}>Selecionar todos os liberados</button><select className="input" aria-label="Selecionar por conta" defaultValue="" id="selectionAccount"><option value="">Selecionar por conta…</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.nickname}</option>)}</select><button className="btn" onClick={() => selectAccount((document.getElementById('selectionAccount') as HTMLSelectElement).value)}>Selecionar conta</button><button className="btn" onClick={() => { setError(''); setSelected(new Set()); }}>Limpar seleção</button></div><p className="hint">As linhas começam desmarcadas. Selecionar uma variação tradicional marca o grupo completo.</p>
              </div>
              <div className="table-wrap"><table className="table review-table"><thead><tr><th><input className="check" type="checkbox" aria-label="Selecionar todos os resultados disponíveis" checked={available.size > 0 && selected.size === available.size} onChange={event => event.target.checked ? selectAll() : setSelected(new Set())}/></th><th>Conta / anúncio</th><th>SKU</th><th>Preço atual</th><th>Novo preço</th><th>Reajuste (%)</th><th>Variação / estado</th></tr></thead><tbody>{items.map(item => {
                const availability = selectionAvailability(item, searchResult);
                const itemKey = targetKey(item);
                const nextPrice = parsePrice(prices[itemKey]);
                const rowSelected = availability.group.length > 0 && availability.group.every(member => selected.has(targetKey(member)));
                const delta = nextPrice === null ? null : percentChange(item.price, nextPrice);
                return <tr className={`${availability.selectable ? '' : 'locked'} ${mismatch && rowSelected ? 'price-mismatch' : ''}`} key={itemKey}><td><input className="check" type="checkbox" aria-label={item.structure === 'traditional' ? `Selecionar grupo ${item.id} pela variação ${item.sku}` : `Selecionar ${item.sku}`} checked={rowSelected} disabled={!availability.selectable} onChange={() => toggleItem(item)}/></td><td><div className="product">{accountName(item)}</div><div className="sub">{item.title}</div><div className="sub">ID {item.id} · {item.structure === 'traditional' ? `var. ${item.variationId}` : `UP ${item.userProductId}`}</div>{item.structure === 'traditional' && <div className="sub">Grupo de {availability.group.length} variações</div>}</td><td><code className="sku">{item.sku}</code></td><td className="money">{money(item.price)}</td><td><input className="price-input" aria-label={`Novo preço de ${item.sku}`} inputMode="decimal" value={prices[itemKey] ?? ''} disabled={!availability.selectable} onChange={event => editPrice(item, event.target.value)}/>{nextPrice === null && <span className="blocked-reason">Preço inválido</span>}</td><td className={delta === null ? 'delta-same' : delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-same'}>{nextPrice === null ? '—' : percent(item.price, nextPrice)}<span className="percent-note">sobre o preço atual</span></td><td><span className={`pill ${availability.selectable ? 'ok' : 'lock'}`}>{availability.selectable ? 'Liberado' : 'Bloqueado'}</span><div className="sub">{item.size} · {item.color}</div>{availability.reason && <span className="blocked-reason">{availability.reason}</span>}</td></tr>;
              })}</tbody></table></div><div className="card-body"><div className="notice info"><span>ⓘ</span><div>Seleção por nome gera candidatos. O servidor reconsulta identificadores, composição dos grupos e condições antes da simulação. Preço único é uma regra deste produto.</div></div></div>
            </article>
            <div className="footer-actions"><button className="btn" onClick={() => { setStep(1); setError(''); }}>← Voltar</button><div className="action-cluster"><span className="tiny">{selected.size} combinação(ões) selecionada(s)</span><button className="btn primary" onClick={toApproval}>Continuar para aprovação →</button></div></div>
          </>}

          {step === 3 && <>
            <article className="card"><div className="card-head"><div><h2 className="card-title">3. Aprovação final</h2><p className="card-desc">Confira o resumo. Nenhuma alteração foi aplicada.</p></div><span className="pill review">Aguardando aprovação</span></div><div className="card-body"><div className="metric-row"><div className="metric"><b>{selectedItems.length}</b><small>Combinações selecionadas</small></div><div className="metric"><b>{new Set(selectedItems.map(item => item.accountId)).size}</b><small>Contas envolvidas</small></div><div className="metric"><b>{new Set(selectedItems.map(item => `${item.accountId}:${item.id}`)).size}</b><small>Anúncios distintos</small></div></div></div>
              <div className="table-wrap approval-table-wrap"><table className="table"><thead><tr><th>Conta</th><th>Produto / ID</th><th>SKU / variação</th><th>Preço atual</th><th>Preço aprovado</th><th>Reajuste (%)</th></tr></thead><tbody>{selectedItems.map(item => <tr key={targetKey(item)}><td>{accountName(item)}</td><td><div className="product">{item.title}</div><div className="sub">ID {item.id} · {item.structure === 'traditional' ? 'Tradicional' : 'User Product'}</div></td><td><code className="sku">{item.sku}</code><div className="sub">{item.variationId ?? item.userProductId} · {item.size}/{item.color}</div></td><td>{money(item.price)}</td><td className="new-price">{money(parsePrice(prices[targetKey(item)])!)}</td><td>{percent(item.price, parsePrice(prices[targetKey(item)])!)}</td></tr>)}</tbody></table></div>
              <div className="card-body"><div className="notice danger"><span>⛔</span><div><b>Antes da simulação:</b> o servidor reconsulta os dados atuais e bloqueia qualquer divergência. Nenhum envio ao Mercado Livre é realizado nesta versão.</div></div><div className="confirm-box"><label className="confirm-check"><input type="checkbox" aria-label="Confirmo que revisei os anúncios" checked={approvalChecked} onChange={event => setApprovalChecked(event.target.checked)}/><span>Confirmo que revisei as combinações selecionadas e aprovo os preços listados acima para esta simulação.</span></label></div></div>
            </article><div className="footer-actions"><button className="btn" onClick={() => { setStep(2); setApprovalChecked(false); setError(''); }}>← Voltar para revisão</button><button className="btn primary" onClick={requestConfirmation}>Confirmar simulação ✓</button></div>
          </>}

          {step === 4 && result && <article className="card"><div className="card-body result-body"><div className={`result-icon ${result.status === 'simulated' ? '' : 'result-warning'}`}>{result.status === 'simulated' ? '✓' : '!'}</div><h2>{result.status === 'simulated' ? 'Simulação concluída' : result.status === 'blocked' ? 'Operação bloqueada' : 'Simulação com falhas'}</h2><p className="subtitle">Nenhum preço real foi alterado. {result.status === 'blocked' ? 'Pesquise novamente para revisar os dados atuais.' : 'Consulte o resultado de cada combinação abaixo.'}</p><div className={`notice ${result.status === 'simulated' ? 'success' : 'danger'}`}><span>{result.status === 'simulated' ? '✓' : '⚠'}</span><div>{result.note} · {result.results.length} combinação(ões) registrada(s).</div></div>{result.issues?.filter(issue => issue.targetKey === null).map((issue, index) => <div className="notice danger" key={index}><span>⚠</span><div>Bloqueio global: {issue.message}</div></div>)}
              <div className="table-wrap result-wrap"><table className="table result-table"><thead><tr><th>Conta</th><th>Produto / SKU</th><th>Preço pretendido</th><th>Reajuste</th><th>Resultado</th></tr></thead><tbody>{result.results.map((entry, index) => <tr key={`${entry.targetKey ?? targetKey(entry.snapshot)}:${index}`}><td>{accountName(entry.snapshot)}</td><td><div className="product">{entry.snapshot.title}</div><code className="sku">{entry.snapshot.sku}</code><div className="sub">{entry.snapshot.id} · {entry.snapshot.variationId ?? entry.snapshot.userProductId}</div></td><td className="new-price">{money(entry.intendedPrice)}<div className="sub">Aplicado: {entry.appliedPrice == null ? 'não aplicado' : money(entry.appliedPrice)}</div></td><td>{percent(entry.snapshot.price, entry.intendedPrice)}</td><td><span className={`pill ${entry.status === 'simulated' ? 'ok' : 'lock'}`}>{statusLabel(entry.status)}</span><div className="sub result-message">{entry.message}</div></td></tr>)}</tbody></table></div><div className="footer-actions"><span className="tiny">Protocolo: <strong>{result.id}</strong> · <button className="link-button" onClick={() => switchView('history')}>Ver histórico</button></span><button className="btn primary" onClick={resetFlow}>Nova atualização</button></div>
            </div></article>}
        </>}

        {view === 'history' && <><div className="title-row"><div><div className="eyebrow">Auditoria</div><h1 className="title">Histórico de alterações</h1><p className="subtitle">Consulte protocolos, responsáveis, combinações e resultados persistidos no SQLite.</p></div><span className="demo-tag">● Somente simulações locais</span></div><article className="card"><div className="card-head"><div><h2 className="card-title">Atividades recentes</h2><p className="card-desc">Resultados individuais das operações registradas nesta máquina.</p></div><button className="btn small" onClick={() => api.history().then(setHistory).catch(e => setError(e.message))}>Atualizar</button></div><div className="card-body history-filters"><div><label className="label" htmlFor="historyFilter">Filtrar por resultado</label><select id="historyFilter" className="input" value={historyFilter} onChange={event => setHistoryFilter(event.target.value)}><option value="all">Todos os resultados</option><option value="simulated">Simulados</option><option value="blocked">Bloqueados</option><option value="failed">Falhas</option></select></div><div><label className="label" htmlFor="historySearch">Buscar protocolo, SKU, produto ou conta</label><input id="historySearch" className="input" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Ex.: RT-CL-PT-56"/></div></div><div className="table-wrap"><table className="table history-table"><thead><tr><th>Data / protocolo</th><th>Conta</th><th>Produto / SKU</th><th>Anterior</th><th>Pretendido</th><th>Reajuste</th><th>Resultado</th><th>Responsável</th><th></th></tr></thead><tbody>{visibleHistory.map(({ operation, result: entry }, index) => <tr key={`${operation.id}:${entry.targetKey ?? targetKey(entry.snapshot)}:${index}`}><td>{new Date(operation.createdAt).toLocaleString('pt-BR')}<div className="sub protocol">{operation.id}</div></td><td>{accountName(entry.snapshot)}</td><td><div className="product">{entry.snapshot.title}</div><code className="sku">{entry.snapshot.sku}</code></td><td>{money(entry.snapshot.price)}</td><td className="new-price">{money(entry.intendedPrice)}</td><td>{percent(entry.snapshot.price, entry.intendedPrice)}</td><td><span className={`pill ${entry.status === 'simulated' ? 'ok' : 'lock'}`}>{statusLabel(entry.status)}</span></td><td>{operation.user}</td><td><button className="btn small" onClick={() => setHistoryDetail({ operation, result: entry })}>Detalhes</button></td></tr>)}{!visibleHistory.length && <tr><td colSpan={9} className="empty">Nenhum registro encontrado para este filtro.</td></tr>}</tbody></table></div><div className="card-body"><span className="tiny">Histórico local em SQLite. Nenhum preço foi aplicado no Mercado Livre.</span></div></article></>}

        {view === 'accounts' && <><div className="title-row"><div><div className="eyebrow">Acessos e permissões</div><h1 className="title">Gerenciamento de contas</h1><p className="subtitle">Acompanhe as três contas fictícias desta demonstração. Nenhuma conta real está conectada.</p></div><button className="btn primary" disabled title="OAuth em desenvolvimento">＋ Conectar conta</button></div><div className="notice info"><span>🔐</span><div>Somente dados fictícios: não há conexão ativa com o Mercado Livre. A autorização individual por OAuth ainda não foi implementada.</div></div><article className="card"><div className="card-head"><div><h2 className="card-title">Contas de demonstração</h2><p className="card-desc">{accounts.length} contas fictícias · nenhuma conexão real ativa</p></div><span className="pill ok">DEMO</span></div><div className="card-body"><div className="account-list">{accounts.map(account => <div className="account account-manage" key={account.id}><div className="account-name"><span className="shop-icon">▣</span><div><strong>{account.nickname}</strong><div className="sub">Vendedor ID: {account.sellerId} · Brasil</div></div></div><div className="account-tools"><span className="connected">{account.connected ? 'Disponível no simulador' : 'Indisponível no simulador'}</span><button className="btn small" disabled>Reautorizar</button><button className="btn small" disabled>Desconectar</button></div></div>)}</div><div className="notice warn"><span>ⓘ</span><div>Os estados acima pertencem à massa fictícia. Ações de autorização e revogação estão em desenvolvimento.</div></div></div></article><article className="card"><div className="card-head"><div><h2 className="card-title">Como a autorização funcionará</h2><p className="card-desc">Fluxo previsto para contas de teste antes de qualquer integração real.</p></div></div><div className="card-body oauth-grid"><div><b>1. Iniciar conexão</b><p>O aplicativo abre a autorização oficial.</p></div><div><b>2. Revisar permissões</b><p>O vendedor confere o acesso solicitado.</p></div><div><b>3. Confirmar vínculo</b><p>A conta aparece após a autorização.</p></div><div><b>4. Revogar</b><p>A conexão pode ser removida posteriormente.</p></div></div></article></>}
      </main>
    </div>

    {confirmOpen && <div className="modal-bg" role="presentation" onClick={event => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmTitle"><h3 id="confirmTitle">Confirmar simulação?</h3><p>Você aprovou {selectedItems.length} combinação(ões) com preço pretendido de {selectedItems.length ? money(parsePrice(prices[targetKey(selectedItems[0])])!) : '—'}. A API fará uma nova checagem; nenhum preço real será enviado.</p><div className="modal-actions"><button className="btn" onClick={() => setConfirmOpen(false)}>Voltar e revisar</button><button className="btn primary" disabled={loading} onClick={execute}>Confirmar na demonstração</button></div></div></div>}
    {historyDetail && <div className="modal-bg" role="presentation" onClick={event => { if (event.target === event.currentTarget) setHistoryDetail(null); }}><div className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="historyDetailTitle"><h3 id="historyDetailTitle">Detalhes da alteração</h3><div className="detail-grid">{([
      ['Protocolo', historyDetail.operation.id], ['Data e hora', new Date(historyDetail.operation.createdAt).toLocaleString('pt-BR')],
      ['Responsável', historyDetail.operation.user], ['Resultado', statusLabel(historyDetail.result.status)],
      ['Conta', accountName(historyDetail.result.snapshot)], ['Vendedor ID', historyDetail.result.snapshot.sellerId],
      ['Produto', historyDetail.result.snapshot.title], ['SKU', historyDetail.result.snapshot.sku],
      ['ID do anúncio', historyDetail.result.snapshot.id], ['ID da variação / User Product', historyDetail.result.snapshot.variationId ?? historyDetail.result.snapshot.userProductId ?? '—'],
      ['Tamanho / cor', `${historyDetail.result.snapshot.size} · ${historyDetail.result.snapshot.color}`], ['Estrutura', historyDetail.result.snapshot.structure],
      ['Preço anterior', money(historyDetail.result.snapshot.price)], ['Preço pretendido', money(historyDetail.result.intendedPrice)],
      ['Preço aplicado', historyDetail.result.appliedPrice == null ? 'não aplicado' : money(historyDetail.result.appliedPrice)],
      ['Reajuste', percent(historyDetail.result.snapshot.price, historyDetail.result.intendedPrice)],
      ['Motivo / resposta', historyDetail.result.message]
    ] as const).map(([label, value]) => <div key={label}><span className="sub">{label}</span><strong>{value}</strong></div>)}</div><p className="tiny">{historyDetail.operation.note}</p><div className="modal-actions"><button className="btn" onClick={() => setHistoryDetail(null)}>Fechar</button></div></div></div>}
  </div>;
}
