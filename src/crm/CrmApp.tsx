import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuthGate } from './AuthGate';
import { ConversionForm } from './ConversionForm';
import { Case, Client, Lead, STAGES, Stage, message } from './types';
import { AccountPage } from './phase4/AccountPage';
import { AgendaPage } from './phase4/AgendaPage';
import { FinancePage } from './phase4/FinancePage';
import './crm.css';

const NAV = [['/crm', 'Funil de atendimento'], ['/crm/clientes', 'Clientes / Casos'], ['/crm/agenda', 'Agenda'], ['/crm/financeiro', 'Financeiro'], ['/crm/conta', 'Minha Conta / Segurança']] as const;
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' }).format(new Date(value));

// Pagina a leitura para não perder registros além do limite padrão de 1.000 da API.
async function readAll<T>(table: string, columns: string, signal: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase!.from(table).select(columns).order('id').range(offset, offset + 499).abortSignal(signal);
    if (error) throw error;
    rows.push(...data as T[]);
    if (data.length < 500) return rows;
  }
}

function Workspace() {
  const path = window.location.pathname.replace(/\/$/, '');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setLoading(true); setError('');
    if (path === '/crm/conta') { setLoading(false); return; }
    try {
      const [nextLeads, nextClients, nextCases] = await Promise.all([
        readAll<Lead>('leads_intake', 'id,name,phone,email,summary,practice_area,stage,urgency,created_at,converted_client_id', current.signal),
        readAll<Client>('clients', 'id,full_name,document_type,document_number,phone,email,address_json', current.signal),
        readAll<Case>('cases', 'id,client_id,title,status,practice_area,opposing_party,source_lead_id', current.signal),
      ]);
      if (!current.signal.aborted) { setLeads(nextLeads.sort((a, b) => b.created_at.localeCompare(a.created_at))); setClients(nextClients.sort((a, b) => a.full_name.localeCompare(b.full_name))); setCases(nextCases); }
    } catch (err) { if (!current.signal.aborted) setError(message(err)); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); return () => controller.current?.abort(); }, [reload]);
  async function move(lead: Lead, stage: Stage) {
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: updateError } = await supabase!.from('leads_intake').update({ stage })
        .eq('id', lead.id).eq('stage', lead.stage).is('converted_client_id', null).select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('Este lead mudou em outra sessão. Atualize o funil.');
      setLeads(items => items.map(item => item.id === lead.id ? { ...item, stage } : item));
      setNotice(`Etapa de ${lead.name} atualizada.`);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { const { error: signOutError } = await supabase!.auth.signOut({ scope: 'local' }); if (signOutError) throw signOutError; }
    catch (err) { setError(message(err)); setBusy(false); }
  }
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const filteredLeads = leads.filter(lead => `${lead.name} ${lead.phone} ${lead.email ?? ''} ${lead.summary}`.toLocaleLowerCase('pt-BR').includes(needle));
  const filteredClients = clients.filter(client => `${client.full_name} ${client.document_number ?? ''} ${client.phone ?? ''}`.toLocaleLowerCase('pt-BR').includes(needle));
  const client = clients.find(item => item.id === selectedClient);
  const heading = path === '/crm' ? 'Funil de atendimento' : path === '/crm/clientes' ? 'Clientes e casos' : path === '/crm/agenda' ? 'Agenda' : path === '/crm/financeiro' ? 'Financeiro' : path === '/crm/conta' ? 'Minha Conta / Segurança' : 'Página não encontrada';
  return <div className="crm-shell">
    <aside className="crm-sidebar"><a className="crm-brand" href="/crm">M14 <span>ADVOCACIA</span></a><p className="crm-eyebrow">Escritório / Gestão interna</p>
      <nav aria-label="Navegação do CRM">{NAV.map(([href, label], i) => <a href={href} key={href} aria-current={path === href ? 'page' : undefined}><span>0{i + 1}</span>{label}</a>)}</nav>
      <div className="crm-sidebar-foot"><p>Matheus Moraes<br /><span>Santos · São Paulo</span></p><a href="/">Portal público ↗</a><button disabled={busy} onClick={() => void signOut()}>Sair da sessão</button></div>
    </aside>
    <main className="crm-main" id="crm-content">
      <header className="crm-header"><div><p className="crm-eyebrow">Advocacia e assessoria jurídica</p><h1>{heading}</h1></div><span className="crm-confidential">Uso interno · Sigilo profissional</span></header>
      {(path === '/crm' || path === '/crm/clientes') && <div className="crm-toolbar"><label>Buscar atendimento ou cliente<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, documento ou telefone" /></label><button disabled={loading || busy} onClick={() => void reload()}>Atualizar dados</button></div>}
      {error && <p role="alert" className="crm-error">{error}</p>}{notice && <p role="status" className="crm-notice">{notice}</p>}
      {loading ? <p role="status">Carregando registros do escritório…</p> : path === '/crm' ? <>
        <div className="crm-summary"><span><strong>{leads.filter(item => !['fechado', 'arquivado'].includes(item.stage)).length}</strong> atendimentos em andamento</span><span><strong>{clients.length}</strong> clientes cadastrados</span><span><strong>{cases.filter(item => item.status === 'ativo').length}</strong> casos ativos</span></div>
        <div className="crm-kanban" aria-label="Funil de leads">{STAGES.map(([stage, label]) => {
          const items = filteredLeads.filter(lead => lead.stage === stage);
          return <section className="crm-column" key={stage} aria-labelledby={`stage-${stage}`}><header><h2 id={`stage-${stage}`}>{label}</h2><span>{items.length}</span></header>
            {items.length === 0 && <p className="crm-empty">Nenhum atendimento nesta etapa.</p>}
            {items.map(lead => <article className="crm-lead" key={lead.id}>
              <div className="crm-lead-meta"><time dateTime={lead.created_at}>{date(lead.created_at)}</time><span className={lead.urgency !== 'normal' ? 'crm-urgent' : ''}>{lead.urgency}</span></div>
              <h3>{lead.name}</h3><p className="crm-area">{lead.practice_area.replace(/_/g, ' ')}</p><p className="crm-excerpt">{lead.summary}</p>
              <a href={`tel:${lead.phone}`}>{lead.phone}</a>{lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
              <details><summary>Resumo completo</summary><p>{lead.summary}</p></details>
              {lead.converted_client_id ? <a className="crm-text-action" href="/crm/clientes">Consultar cliente e caso →</a> : <>
                <label>Etapa de {lead.name}<select value={lead.stage} disabled={busy} onChange={e => void move(lead, e.target.value as Stage)}>{STAGES.filter(([value]) => value !== 'fechado').map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                <button disabled={busy || lead.stage === 'arquivado'} onClick={() => setSelected(lead)}>Formalizar cliente / caso →</button></>}
            </article>)}
          </section>;
        })}</div>
      </> : path === '/crm/clientes' ? <>
        <p className="crm-muted">{filteredClients.length} clientes · {cases.length} casos. Cadastros originados pela conversão de atendimentos.</p>
        {filteredClients.length === 0 ? <p className="crm-empty">Nenhum cliente encontrado. Formalize um atendimento no funil para iniciar.</p> : <div className="crm-table-scroll"><table><caption>Cadastro de clientes do escritório</caption><thead><tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Casos</th></tr></thead><tbody>{filteredClients.map(item => <tr key={item.id}><td><button className="crm-name-button" onClick={() => setSelectedClient(item.id)}>{item.full_name}</button></td><td>{item.document_type?.toUpperCase()} {item.document_number ?? 'Não informado'}</td><td>{item.phone}<br />{item.email}</td><td>{cases.filter(k => k.client_id === item.id).length}</td></tr>)}</tbody></table></div>}
        {client && <section className="crm-client-detail"><p className="crm-eyebrow">Ficha do cliente</p><h2>{client.full_name}</h2><p>{[client.address_json.street, client.address_json.number, client.address_json.complement, client.address_json.city, client.address_json.state, client.address_json.cep].filter(Boolean).join(' · ') || 'Endereço não informado.'}</p><h3>Casos vinculados</h3>{cases.filter(k => k.client_id === client.id).length === 0 && <p>Nenhum caso vinculado.</p>}{cases.filter(k => k.client_id === client.id).map(k => <article key={k.id}><h3>{k.title}</h3><p>{k.practice_area.replace(/_/g, ' ')} · {k.status}</p><p>Parte adversa: {k.opposing_party || 'Não informada'}</p><small>Referência: {k.id}</small></article>)}</section>}
      </> : path === '/crm/agenda' ? <AgendaPage leads={leads} cases={cases}/> : path === '/crm/financeiro' ? <FinancePage clients={clients} cases={cases} leads={leads}/> : path === '/crm/conta' ? <AccountPage/> : <p>Endereço não encontrado. <a href="/crm">Voltar ao funil</a></p>}
    </main>
    {selected && <ConversionForm key={selected.id} lead={selected} onClose={() => setSelected(null)} onConverted={() => { setSelected(null); setNotice('Atendimento convertido. Cliente, caso e histórico vinculados com sucesso.'); void reload(); }} />}
  </div>;
}
export default function CrmApp() { return <AuthGate><Workspace /></AuthGate>; }
