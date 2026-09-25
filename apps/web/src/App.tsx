import { useEffect, useMemo, useState } from 'react';
import type { Account, Listing, OperationRecord, PriceTarget, SearchCriteria, SearchResult } from '@preco-certo/domain';
import { parsePrice, percentChange, selectionAvailability, targetKey } from '@preco-certo/domain';
import { api } from './api';

type Step = 'search' | 'review' | 'result';
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emptySearch: SearchResult = { listings: [], traditionalGroups: [] };

export function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'dark');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('Capacete Norisk');
  const [mode, setMode] = useState<'name' | 'sku' | 'list'>('name');
  const [criteria, setCriteria] = useState<SearchCriteria>({});
  const [searchResult, setSearchResult] = useState<SearchResult>(emptySearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState('');
  const [step, setStep] = useState<Step>('search');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OperationRecord | null>(null);
  const [history, setHistory] = useState<OperationRecord[]>([]);
  const [tab, setTab] = useState<'operation' | 'accounts' | 'history'>('operation');

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { api.accounts().then(setAccounts).catch(e => setError(e.message)); api.history().then(setHistory).catch(() => {}); }, []);
  const items = searchResult.listings;
  const selectedItems = useMemo(() => items.filter(item => selected.has(targetKey(item))), [items, selected]);
  const parsedPrice = parsePrice(price);

  async function search() {
    setLoading(true); setError(''); setSelected(new Set()); setStep('search'); setSearchResult(emptySearch);
    const values = query.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
    const next: SearchCriteria = mode === 'sku' ? { skus: values } : mode === 'list' ? { names: values } : { query };
    setCriteria(next);
    try { setSearchResult(await api.search(next)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  function toggle(item: Listing) {
    const availability = selectionAvailability(item, searchResult);
    if (!availability.selectable) return;
    const keys = availability.group.map(targetKey);
    setSelected(previous => {
      const next = new Set(previous);
      const allSelected = keys.every(key => next.has(key));
      for (const key of keys) allSelected ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function review() {
    if (parsedPrice === null) { setError('Informe um preço positivo, sem texto e com no máximo duas casas decimais.'); return; }
    if (!selectedItems.length) { setError('Selecione ao menos um item.'); return; }
    if (selectedItems.some(item => !selectionAvailability(item, searchResult).selectable)) {
      setError('A seleção contém item ou grupo bloqueado. Pesquise novamente.'); return;
    }
    setError(''); setStep('review');
  }

  async function execute() {
    if (parsedPrice === null) return;
    setLoading(true); setError('');
    const targets: PriceTarget[] = selectedItems.map(snapshot => ({ snapshot, newPrice: parsedPrice }));
    try {
      const response = await api.execute(criteria, targets);
      setResult(response.operation); setStep('result'); setHistory(await api.history());
    } catch (e: any) {
      if (e.data?.operation) { setResult(e.data.operation); setStep('result'); setHistory(await api.history()); }
      else setError(e.message);
    } finally { setLoading(false); }
  }

  const accountName = (item: Listing) => accounts.find(account => account.id === item.accountId)?.nickname ?? item.accountId;
  const resultDetails = (record: OperationRecord) => record.results.map((entry, index) =>
    <article className="result" key={`${entry.targetKey ?? targetKey(entry.snapshot)}:${index}`}>
      <span className={`pill ${entry.status}`}>{entry.status}</span>
      <div><b>{entry.snapshot.title}</b><small>{entry.snapshot.id} · {entry.snapshot.variationId ?? entry.snapshot.userProductId} · {entry.snapshot.sku} · {entry.snapshot.size}/{entry.snapshot.color}</small></div>
      <div>Anterior {money(entry.snapshot.price)}<br/>Pretendido <b>{money(entry.intendedPrice)}</b><br/>Aplicado: {entry.appliedPrice == null ? 'não aplicado' : money(entry.appliedPrice)}</div>
      <p>{entry.message}</p>
    </article>);

  return <div className="shell">
    <header><div><span className="logo">PC</span><strong>Preço Certo</strong><small>ambiente local · demonstração</small></div><button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Tema claro' : '☾ Tema escuro'}</button></header>
    <nav>{(['operation', 'accounts', 'history'] as const).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value === 'operation' ? 'Alterar preços' : value === 'accounts' ? 'Contas' : 'Histórico'}</button>)}</nav>
    <main>{error && <div className="alert error">{error}</div>}
      {tab === 'accounts' && <section><div className="heading"><div><p className="eyebrow">Etapa futura: OAuth individual</p><h1>Contas de vendedor</h1></div></div><div className="cards">{accounts.map(account => <article className="account" key={account.id}><span className={account.connected ? 'dot ok' : 'dot'}></span><div><b>{account.nickname}</b><p>seller_id {account.sellerId}</p><small>{account.connected ? 'Conectada ao gateway fictício' : 'Desconectada'} · conta DEMO</small></div><button disabled>Autorizar OAuth</button></article>)}</div><div className="alert">Credenciais e tokens ficarão exclusivamente no backend. Nenhuma conta real está configurada.</div></section>}
      {tab === 'history' && <section><div className="heading"><div><p className="eyebrow">SQLite local</p><h1>Histórico de operações</h1></div><button className="ghost" onClick={() => api.history().then(setHistory)}>Atualizar</button></div>{!history.length ? <div className="empty">Nenhuma operação registrada.</div> : history.map(operation => <details className="history" key={operation.id}><summary><span className={`pill ${operation.status}`}>{operation.status}</span><b>{new Date(operation.createdAt).toLocaleString('pt-BR')}</b><span>{operation.results.length} combinação(ões)</span></summary><p>{operation.note} · responsável: {operation.user}</p>{operation.issues?.filter(issue => issue.targetKey === null).map((issue, index) => <p className="warning" key={index}>Bloqueio global: {issue.message}</p>)}{operation.results.map((entry, index) => <div className="history-row" key={`${entry.targetKey ?? targetKey(entry.snapshot)}:${index}`}><code>{entry.snapshot.id} / {entry.snapshot.variationId ?? entry.snapshot.userProductId}<br/>{entry.snapshot.sku}</code><span>Anterior {money(entry.snapshot.price)}<br/>Pretendido {money(entry.intendedPrice)}<br/>Aplicado: {entry.appliedPrice == null ? 'não aplicado' : money(entry.appliedPrice)}</span><b>{entry.status}: {entry.message}</b></div>)}</details>)}</section>}
      {tab === 'operation' && <section><div className="steps"><span className={step === 'search' ? 'on' : ''}>1 Pesquisa</span><i></i><span className={step === 'review' ? 'on' : ''}>2 Revisão</span><i></i><span className={step === 'result' ? 'on' : ''}>3 Resultado</span></div>
        {step === 'search' && <><div className="heading"><div><p className="eyebrow">Seleção granular, sem atualização automática</p><h1>Encontre os anúncios</h1></div></div><div className="searchbox"><div className="modes"><button className={mode === 'name' ? 'active' : ''} onClick={() => setMode('name')}>Nome ou modelo</button><button className={mode === 'sku' ? 'active' : ''} onClick={() => setMode('sku')}>SKU exato</button><button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>Lista</button></div><textarea value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'list' ? 'Um nome por linha ou separado por vírgula' : 'Digite para pesquisar'}/><button className="primary" onClick={search} disabled={loading}>{loading ? 'Pesquisando…' : 'Pesquisar'}</button></div>
          {!!items.length && <><div className="results-head"><div><b>{items.length} combinações encontradas</b><small>Nenhuma é selecionada automaticamente. Anúncios tradicionais são selecionados por grupo completo.</small></div><span>{selected.size} selecionada(s)</span></div><div className="table-wrap"><table><thead><tr><th></th><th>Conta / anúncio</th><th>SKU</th><th>Variação</th><th>Estrutura</th><th>Preço</th><th>Estado</th></tr></thead><tbody>{items.map(item => {
            const availability = selectionAvailability(item, searchResult);
            const group = availability.group;
            const checked = group.length > 0 && group.every(member => selected.has(targetKey(member)));
            return <tr className={!availability.selectable ? 'blocked' : ''} key={targetKey(item)}><td><input aria-label={item.structure === 'traditional' ? `Selecionar grupo ${item.id} pela variação ${item.sku}` : `Selecionar ${item.sku}`} type="checkbox" checked={checked} disabled={!availability.selectable} onChange={() => toggle(item)}/></td><td><b>{item.title}</b><small>{accountName(item)} · {item.id}</small>{item.structure === 'traditional' && <small>Grupo completo: {group.map(member => `${member.sku} (${member.size}/${member.color})`).join(', ')}</small>}</td><td><code>{item.sku}</code></td><td>{item.size} · {item.color}<small>{item.variationId ?? item.userProductId}</small></td><td><span className="pill">{item.structure === 'traditional' ? `Tradicional · ${group.length} variações` : 'User Product'}</span></td><td><b>{money(item.price)}</b></td><td>{availability.reason ? <span className="warning">⚠ {availability.reason}</span> : <span className="success">Ativo</span>}</td></tr>;
          })}</tbody></table></div><div className="pricebar"><div><label>Novo preço único</label><input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal" placeholder="0,00"/><small>Regra deste produto: todos os selecionados recebem o mesmo novo preço.</small></div><div className="summary"><span>{selectedItems.length} combinação(ões)</span><b>{parsedPrice !== null && selectedItems[0] ? `${percentChange(selectedItems[0].price, parsedPrice) > 0 ? '+' : ''}${percentChange(selectedItems[0].price, parsedPrice)}%` : '—'}</b></div><button className="primary" onClick={review}>Revisar alteração</button></div></>}
          {!loading && !items.length && <div className="empty">Pesquise “Capacete Norisk” para ver a massa de demonstração.</div>}</>}
        {step === 'review' && <><div className="heading"><div><p className="eyebrow">Confirmação explícita obrigatória</p><h1>Revise antes de simular</h1></div><button className="ghost" onClick={() => setStep('search')}>← Voltar e editar</button></div><div className="alert">O servidor reconsulta as combinações e grupos imediatamente antes da simulação. Nenhum preço será aplicado no Mercado Livre.</div><div className="review-grid"><article><small>Combinações afetadas</small><strong>{selectedItems.length}</strong></article><article><small>Contas afetadas</small><strong>{new Set(selectedItems.map(item => item.accountId)).size}</strong></article><article><small>Novo preço único</small><strong>{money(parsedPrice!)}</strong></article></div><div className="table-wrap"><table><thead><tr><th>Anúncio</th><th>Conta</th><th>SKU / variação</th><th>Anterior</th><th>Pretendido</th><th>Reajuste</th></tr></thead><tbody>{selectedItems.map(item => <tr key={targetKey(item)}><td>{item.id}<small>{item.title}</small></td><td>{accountName(item)}</td><td><code>{item.sku}</code><small>{item.variationId ?? item.userProductId} · {item.size}/{item.color}</small></td><td>{money(item.price)}</td><td><b>{money(parsedPrice!)}</b></td><td>{percentChange(item.price, parsedPrice!)}%</td></tr>)}</tbody></table></div><div className="approval"><p><b>Ao confirmar, aprovo exatamente as combinações e valores acima.</b><br/><small>Condições alteradas bloqueiam a operação inteira e exigem nova pesquisa e aprovação.</small></p><button className="danger" disabled={loading} onClick={execute}>{loading ? 'Verificando…' : 'Confirmar e executar simulação'}</button></div></>}
        {step === 'result' && result && <><div className="heading"><div><p className="eyebrow">Operação {result.id}</p><h1>{result.status === 'simulated' ? 'Simulação concluída' : result.status === 'blocked' ? 'Operação bloqueada' : 'Simulação com falhas individuais'}</h1></div></div><div className={`alert ${result.status === 'simulated' ? 'successbox' : 'error'}`}>{result.note}{result.status === 'blocked' && ' Pesquise novamente, revise e aprove os dados atuais.'}</div>{result.issues?.filter(issue => issue.targetKey === null).map((issue, index) => <div className="alert error" key={index}>Bloqueio global: {issue.message}</div>)}{resultDetails(result)}<button className="primary" onClick={() => { setStep('search'); setSelected(new Set()); setPrice(''); }}>Nova operação</button></>}
      </section>}
    </main><footer>Preço Certo v0.1 · dados fictícios · API local em 127.0.0.1</footer>
  </div>;
}
