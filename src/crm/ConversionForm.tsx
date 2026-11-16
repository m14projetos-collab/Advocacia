import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ConversionInput, Lead, Review, message } from './types';

interface Props { lead: Lead; onClose: () => void; onConverted: () => void }
export function ConversionForm({ lead, onClose, onConverted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(lead.name);
  const [documentType, setDocumentType] = useState('cpf');
  const [documentNumber, setDocumentNumber] = useState('');
  const [title, setTitle] = useState('');
  const [opposingName, setOpposingName] = useState('');
  const [opposingType, setOpposingType] = useState('cpf');
  const [opposingNumber, setOpposingNumber] = useState('');
  const [address, setAddress] = useState({ cep: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' });
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { alive.current = false; request.current?.abort(); element?.close(); };
  }, []);
  function invalidate() { setReview(null); setConfirmed(false); setError(''); setNotice(''); }
  const input: ConversionInput = {
    p_lead_id: lead.id, p_name: name, p_document_type: documentType, p_document_number: documentNumber,
    p_title: title, p_address: address, p_opposing_name: opposingName,
    p_opposing_document_type: opposingType, p_opposing_document_number: opposingNumber,
  };
  async function lookup(kind: 'cnpj' | 'cep') {
    invalidate(); setBusy(true);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const value = (kind === 'cnpj' ? documentNumber : address.cep).replace(/\D/g, '');
      if (value.length !== (kind === 'cnpj' ? 14 : 8)) throw new Error(`Informe ${kind === 'cnpj' ? 'um CNPJ numérico com 14 dígitos' : 'um CEP com 8 dígitos'}.`);
      const response = await fetch(`https://brasilapi.com.br/api/${kind}/${kind === 'cnpj' ? 'v1' : 'v2'}/${value}`, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'Cadastro não encontrado.' : 'Consulta indisponível. Preencha os dados manualmente.');
      const data = await response.json();
      if (!alive.current) return;
      if (kind === 'cnpj') {
        if (typeof data.razao_social !== 'string') throw new Error('Resposta de CNPJ inválida.');
        setName(data.razao_social.slice(0, 160));
        setAddress(a => ({ ...a, cep: String(data.cep ?? ''), street: String(data.logradouro ?? ''),
          number: String(data.numero ?? ''), complement: String(data.complemento ?? ''),
          neighborhood: String(data.bairro ?? ''), city: String(data.municipio ?? ''), state: String(data.uf ?? '') }));
      } else {
        if (typeof data.city !== 'string') throw new Error('Resposta de CEP inválida.');
        setAddress(a => ({ ...a, cep: value, street: String(data.street ?? ''), neighborhood: String(data.neighborhood ?? ''), city: data.city, state: String(data.state ?? '') }));
      }
      setNotice('Dados consultados na BrasilAPI. Confira antes de continuar.');
    } catch (err) { if (alive.current) setError(err instanceof DOMException && err.name === 'AbortError' ? 'A consulta expirou. Tente novamente ou preencha manualmente.' : message(err)); }
    finally { clearTimeout(timeout); if (alive.current) setBusy(false); }
  }
  async function check(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setReview(null); setConfirmed(false);
    try {
      const { data, error: rpcError } = await supabase!.rpc('review_lead_conversion', input);
      if (rpcError) throw rpcError;
      if (alive.current) setReview(data as Review);
    } catch (err) { if (alive.current) setError(message(err)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function convert() {
    if (!review || !confirmed || review.conflicts.length) return;
    setBusy(true); setError('');
    try {
      const { error: rpcError } = await supabase!.rpc('convert_lead', { ...input, p_review_token: review.token });
      if (rpcError) throw rpcError;
      onConverted();
    } catch (err) { if (alive.current) { setError(message(err)); setReview(null); setConfirmed(false); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="crm-dialog" aria-labelledby="conversion-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="crm-dialog-head"><p className="crm-eyebrow">Formalização de atendimento</p><button type="button" disabled={busy} onClick={onClose} aria-label="Fechar conversão">Fechar ×</button></div>
    <h2 id="conversion-title">Do atendimento ao caso</h2>
    <p className="crm-muted">{lead.name} · {lead.phone}</p>
    <blockquote>{lead.summary}</blockquote>
    <form onSubmit={check} onChange={invalidate}>
      <fieldset disabled={busy}>
        <legend>01 / Identificação do cliente</legend>
        <label>Nome completo ou razão social<input required minLength={2} maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="crm-grid-2">
          <label>Tipo de documento<select value={documentType} onChange={e => setDocumentType(e.target.value)}><option value="cpf">CPF</option><option value="cnpj">CNPJ</option></select></label>
          <label>Documento<input required maxLength={18} value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} /></label>
        </div>
        {documentType === 'cnpj' && <button type="button" onClick={() => void lookup('cnpj')}>Consultar CNPJ na BrasilAPI</button>}
        <p className="crm-muted">O documento é validado no servidor. Se já houver cadastro, ele será reutilizado e os dados existentes serão preservados.</p>
        <h3 className="crm-eyebrow">02 / Endereço</h3>
        <div className="crm-grid-2"><label>CEP<input maxLength={9} value={address.cep} onChange={e => setAddress({ ...address, cep: e.target.value })} /></label><button type="button" onClick={() => void lookup('cep')}>Consultar CEP na BrasilAPI</button></div>
        <p className="crm-muted">As consultas enviam apenas o CNPJ ou o CEP à BrasilAPI. Preenchimento manual disponível.</p>
        <div className="crm-grid-2">{([['street', 'Logradouro'], ['number', 'Número'], ['complement', 'Complemento'], ['neighborhood', 'Bairro'], ['city', 'Cidade'], ['state', 'UF']] as const).map(([key, label]) =>
          <label key={key}>{label}<input value={address[key]} maxLength={key === 'state' ? 2 : 160} onChange={e => setAddress({ ...address, [key]: e.target.value })} /></label>)}</div>
        <h3 className="crm-eyebrow">03 / Caso e conflito de interesses</h3>
        <label>Título do caso<input required minLength={2} maxLength={240} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>Parte adversa (se conhecida)<input minLength={2} maxLength={160} value={opposingName} onChange={e => setOpposingName(e.target.value)} /></label>
        <div className="crm-grid-2"><label>Documento da parte adversa<select value={opposingType} onChange={e => setOpposingType(e.target.value)}><option value="cpf">CPF</option><option value="cnpj">CNPJ</option></select></label>
          <label>Número (opcional)<input maxLength={18} value={opposingNumber} onChange={e => setOpposingNumber(e.target.value)} /></label></div>
        <button type="submit">Verificar conflitos por nome e documento</button>
      </fieldset>
    </form>
    {busy && <p role="status">Processando…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="crm-error">{error}</p>}
    {review && <section aria-live="polite" className="crm-review">
      {review.conflicts.length ? <><h3>Possíveis conflitos encontrados</h3><p>Conversão bloqueada. A equipe jurídica deve revisar os vínculos antes de prosseguir.</p>
        <ul>{review.conflicts.map((hit, i) => <li key={`${hit.case_id}-${i}`}>{hit.full_name} · {hit.party_role} · coincidência por {hit.match_by} · caso {hit.case_id}</li>)}</ul></> :
        <><h3>Nenhuma coincidência impeditiva encontrada</h3><p>A busca não substitui a análise jurídica, especialmente com dados incompletos ou nomes diferentes.</p>
          <label className="crm-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Revisei a identidade, as partes e a ausência de impedimento para este atendimento.</label>
          <button type="button" className="crm-primary" disabled={busy || !confirmed} onClick={() => void convert()}>Converter em cliente e caso</button></>}
    </section>}
  </dialog>;
}
