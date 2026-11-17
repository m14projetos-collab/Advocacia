import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Case, Client, Lead, message } from "../types";
import { invoke } from "../phase4/api";
import { officeInput } from "../phase4/time";
import { PAYMENT_STATUS } from "../phase4/types";
import { Context, contextFromUrl, contextLink, HubSnapshot } from "./types";
import { DocumentsPanel } from "./DocumentsPanel";
import { LegalAgentPanel } from "./LegalAgentPanel";
function HubCard({ context }: { context: Context }) {
  const [data, setData] = useState<HubSnapshot | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("conversation"),
    [text, setText] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [sendId, setSendId] = useState(() => crypto.randomUUID());
  const [notes, setNotes] = useState(""),
    [outcome, setOutcome] = useState("atendida"),
    [direction, setDirection] = useState("outbound"),
    [duration, setDuration] = useState(""),
    [callId, setCallId] = useState(() => crypto.randomUUID());
  const [cnj, setCnj] = useState(""),
    [confidential, setConfidential] = useState(true),
    [offset, setOffset] = useState(0);
  const version = useRef(0);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<HubSnapshot>("case-hub", { context });
      if (current === version.current) {
        setData(result);
        setCnj(result.case?.cnj_number ?? "");
        setConfidential(result.case?.is_confidential ?? true);
        setOffset(0);
      }
    } catch (err) {
      if (current === version.current) setError(message(err));
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [context]);
  useEffect(() => {
    void load();
    return () => {
      version.current++;
    };
  }, [load]);
  async function older() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<HubSnapshot>("case-hub", {
        context,
        offset: offset + 100,
      });
      setData((current) =>
        current
          ? {
              ...current,
              messages: [
                ...new Map(
                  [...result.messages, ...current.messages].map((m) => [
                    m.id,
                    m,
                  ]),
                ).values(),
              ].sort(
                (a, b) =>
                  a.created_at.localeCompare(b.created_at) ||
                  a.id.localeCompare(b.id),
              ),
              has_more: result.has_more,
            }
          : current,
      );
      setOffset((value) => value + 100);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<{ pending?: boolean }>("whatsapp-send", {
        context,
        id: sendId,
        content: text,
        reviewed,
      });
      if (result.pending)
        setNotice(
          "Envio já registrado e sem confirmação. Confira o provedor antes de reenviar.",
        );
      else {
        setText("");
        setReviewed(false);
        setSendId(crypto.randomUUID());
        setNotice("Resposta registrada no histórico.");
      }
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function call(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await invoke("whatsapp-send", {
        operation: "call",
        context,
        id: callId,
        notes,
        outcome,
        direction,
        duration_seconds: duration ? Number(duration) : null,
      });
      setNotes("");
      setDuration("");
      setCallId(crypto.randomUUID());
      setNotice("Ligação registrada no card.");
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function caseSave(e: FormEvent) {
    e.preventDefault();
    if (!data?.case) return;
    setBusy(true);
    setError("");
    try {
      await invoke("case-hub", {
        operation: "case_update",
        context,
        cnj_number: cnj,
        is_confidential: confidential,
        expected_updated_at: data.case.updated_at,
      });
      await load();
      setNotice("Identificação e classificação do caso atualizadas.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function lookup() {
    setBusy(true);
    setError("");
    try {
      await invoke("datajud-lookup", { context });
      await load();
      setNotice(
        "Consulta pública concluída. Confira a fonte e a data da base.",
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function assign(id: string) {
    setBusy(true);
    setError("");
    try {
      await invoke("case-hub", { operation: "message_case", context, id });
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const ctx: Context = data
    ? {
        ...(data.lead_id ? { lead_id: data.lead_id } : {}),
        ...(data.client_id ? { client_id: data.client_id } : {}),
        ...(data.case_id ? { case_id: data.case_id } : {}),
      }
    : context;
  return (
    <article className="crm-hub-card">
      {loading && <p role="status">Carregando ficha integrada…</p>}
      {error && (
        <p className="crm-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="crm-notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <button disabled={loading} onClick={() => void load()}>
          Carregar ficha
        </button>
      ) : (
        <>
          <header className="crm-hub-header">
            <div>
              <p className="crm-eyebrow">
                {data.case
                  ? "Caso / cliente"
                  : data.client
                    ? "Cliente"
                    : "Atendimento em triagem"}
              </p>
              <h2>
                {data.case?.title ?? data.client?.full_name ?? data.lead?.name}
              </h2>
              <p>
                {data.client?.full_name ?? data.lead?.name}{" "}
                {data.phone && (
                  <>
                    · <a href={`tel:${data.phone}`}>{data.phone}</a>
                  </>
                )}
              </p>
              {data.case && (
                <p className="crm-muted">
                  {data.case.is_confidential
                    ? "Sigilo informado — documentos privados"
                    : "Classificado como público pelo escritório"}
                </p>
              )}
            </div>
            <button disabled={busy || loading} onClick={() => void load()}>
              Atualizar ficha
            </button>
          </header>
          <div className="crm-actions crm-hub-shortcuts">
            <a href={contextLink("/crm/agenda", ctx)}>
              Agendar neste contexto →
            </a>
            {data.client_id && (
              <a href={contextLink("/crm/financeiro", ctx)}>
                Cobrar deste cliente →
              </a>
            )}
            {data.case && (
              <a href={contextLink("/crm/hub", { client_id: data.client_id! })}>
                Ver ficha geral do cliente →
              </a>
            )}
            {data.phone && (
              <a href={`tel:${data.phone}`}>Ligar para o contato</a>
            )}
          </div>
          {data.cases.length > 0 && (
            <nav aria-label="Casos do cliente" className="crm-actions">
              {data.cases.map((k) => (
                <a
                  key={k.id}
                  aria-current={k.id === data.case_id ? "page" : undefined}
                  href={contextLink("/crm/hub", { case_id: k.id })}
                >
                  {k.title}
                </a>
              ))}
            </nav>
          )}
          <div
            className="crm-hub-tabs"
            role="tablist"
            aria-label="Seções da ficha"
          >
            {[
              ["conversation", "WhatsApp e ligações"],
              ["case", "Caso / DataJud"],
              ["documents", "Documentos privados"],
              ["agent", "Agente IA"],
              ["activity", "Agenda e financeiro"],
            ].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`hub-${value}`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <section role="tabpanel" id={`hub-${tab}`}>
            {tab === "conversation" && (
              <>
                <h3>Conversa vinculada ao contato</h3>
                <p className="crm-muted">
                  Mensagens gerais do cliente permanecem visíveis no card.
                  Vincule ao caso específico quando a relação for confirmada;
                  não é necessário redigitar o histórico.
                </p>
                {data.has_more && (
                  <button disabled={busy} onClick={() => void older()}>
                    Carregar mensagens anteriores
                  </button>
                )}
                {data.messages.length === 0 && (
                  <p>Nenhuma mensagem recebida neste contato.</p>
                )}
                <ol className="crm-message-list">
                  {data.messages.map((m) => (
                    <li
                      key={m.id}
                      className={
                        m.direction === "outbound" ? "outbound" : "inbound"
                      }
                    >
                      <p className="crm-eyebrow">
                        {m.direction === "inbound" ? "Contato" : "Equipe"} ·{" "}
                        {officeInput(m.created_at).replace("T", " ")} ·{" "}
                        {m.send_state}
                      </p>
                      <p className="crm-message-content">{m.content}</p>
                      <small>
                        {m.case_id
                          ? (data.cases.find((k) => k.id === m.case_id)
                              ?.title ?? "Caso vinculado")
                          : "Conversa geral do contato"}
                      </small>
                      {data.case_id && !m.case_id && m.client_id && (
                        <button
                          disabled={busy}
                          onClick={() => void assign(m.id)}
                        >
                          Vincular esta mensagem ao caso atual
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <form className="crm-stack crm-hub-box" onSubmit={send}>
                  <label>
                    Resposta no WhatsApp
                    <textarea
                      rows={4}
                      maxLength={4000}
                      required
                      value={text}
                      disabled={busy}
                      onChange={(e) => {
                        setText(e.target.value);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <label className="crm-inline-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    Revisei o destinatário, o sigilo e o conteúdo da resposta.
                  </label>
                  <p className="crm-muted">
                    Texto livre exige mensagem recebida deste número nas últimas
                    24 horas. Não há envio automático de IA nem marketing em
                    massa.
                  </p>
                  <button
                    disabled={busy || !reviewed || !text.trim()}
                    className="crm-primary"
                  >
                    Enviar resposta revisada
                  </button>
                </form>
                <details className="crm-hub-box">
                  <summary>Registrar ligação no card</summary>
                  <form className="crm-stack" onSubmit={call}>
                    <div className="crm-grid-2">
                      <label>
                        Sentido da ligação
                        <select
                          value={direction}
                          onChange={(e) => setDirection(e.target.value)}
                        >
                          <option value="outbound">Realizada</option>
                          <option value="inbound">Recebida</option>
                        </select>
                      </label>
                      <label>
                        Resultado da ligação
                        <select
                          value={outcome}
                          onChange={(e) => setOutcome(e.target.value)}
                        >
                          <option value="atendida">Atendida</option>
                          <option value="sem_resposta">Sem resposta</option>
                          <option value="retorno_pendente">
                            Retorno pendente
                          </option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Duração em segundos (opcional)
                      <input
                        type="number"
                        min={0}
                        max={86400}
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                      />
                    </label>
                    <label>
                      Registro da ligação
                      <textarea
                        required
                        rows={3}
                        maxLength={3000}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </label>
                    <button disabled={busy}>Salvar registro da ligação</button>
                  </form>
                </details>
                <ul>
                  {data.calls.map((c) => (
                    <li className="crm-hub-box" key={c.id}>
                      <p>
                        {officeInput(c.created_at).replace("T", " ")} ·{" "}
                        {c.direction === "outbound" ? "Realizada" : "Recebida"}{" "}
                        · {c.outcome.replace(/_/g, " ")}
                      </p>
                      <p className="crm-message-content">{c.notes}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {tab === "case" &&
              (!data.case ? (
                <p>
                  Selecione um caso acima para identificar o processo. A
                  ausência de resultado público não comprova segredo de justiça.
                </p>
              ) : (
                <>
                  <form className="crm-stack crm-hub-box" onSubmit={caseSave}>
                    <h3>Identificação do processo</h3>
                    <label>
                      Número CNJ (20 dígitos)
                      <input
                        value={cnj}
                        maxLength={25}
                        onChange={(e) => setCnj(e.target.value)}
                      />
                    </label>
                    <label className="crm-inline-check">
                      <input
                        type="checkbox"
                        checked={confidential}
                        onChange={(e) => setConfidential(e.target.checked)}
                      />
                      Caso classificado como sigiloso pelo escritório
                    </label>
                    <p className="crm-muted">
                      Altere a classificação apenas após conferir a fonte
                      oficial. A consulta pública é bloqueada para casos
                      sigilosos.
                    </p>
                    <button disabled={busy}>
                      Salvar identificação do caso
                    </button>
                  </form>
                  <section className="crm-hub-box">
                    <h3>Consulta pública DataJud</h3>
                    <p>
                      Somente metadados públicos. Não disponibiliza autos
                      protegidos nem confirma sigilo por ausência de resultado.
                    </p>
                    <button
                      disabled={
                        busy ||
                        data.case.is_confidential ||
                        !data.case.cnj_number
                      }
                      onClick={() => void lookup()}
                    >
                      Consultar CNJ já cadastrado
                    </button>
                    {data.case.is_confidential && (
                      <p>
                        Sigilo informado: use a aba Documentos privados e a
                        revisão interna do advogado.
                      </p>
                    )}
                    <a
                      href="https://www.cnj.jus.br/sistemas/datajud/api-publica/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Fonte: CNJ / DataJud ↗
                    </a>
                    {data.lookups.map((q) => (
                      <div key={q.id}>
                        <p>
                          {officeInput(q.created_at).replace("T", " ")} ·{" "}
                          {q.status === "public"
                            ? "Resultado público"
                            : q.status === "restricted"
                              ? "Acesso protegido"
                              : "Sem resultado público confirmado"}
                        </p>
                        <pre className="crm-json-result">
                          {JSON.stringify(q.metadata, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </section>
                  {data.case.ai_summary && (
                    <section className="crm-hub-box">
                      <h3>Resumo revisado do caso</h3>
                      <p className="crm-message-content">
                        {data.case.ai_summary}
                      </p>
                    </section>
                  )}
                </>
              ))}
            {tab === "documents" && (
              <DocumentsPanel
                context={ctx}
                documents={data.documents}
                onChanged={() => void load()}
              />
            )}
            {tab === "agent" && (
              <LegalAgentPanel
                context={ctx}
                runs={data.ai_runs}
                documents={data.documents}
                onChanged={() => void load()}
                onDraft={(value) => {
                  setText(value);
                  setReviewed(false);
                  setTab("conversation");
                }}
              />
            )}
            {tab === "activity" && (
              <>
                <h3>Agenda vinculada</h3>
                {data.appointments.length === 0 && (
                  <p>Nenhum compromisso neste contato.</p>
                )}
                {data.appointments.map((a) => (
                  <article className="crm-hub-box" key={a.id}>
                    <h4>{a.title}</h4>
                    <p>
                      {officeInput(a.starts_at).replace("T", " ")} · {a.status}
                    </p>
                    <a
                      href={contextLink("/crm/agenda", ctx, {
                        appointment_id: a.id,
                      })}
                    >
                      Abrir compromisso →
                    </a>
                    {data.client_id &&
                      a.payment_required &&
                      a.status === "pendente" && (
                        <a
                          href={contextLink(
                            "/crm/financeiro",
                            {
                              client_id: data.client_id!,
                              ...(a.case_id ? { case_id: a.case_id } : {}),
                              ...(a.lead_id ? { lead_id: a.lead_id } : {}),
                            },
                            { appointment_id: a.id },
                          )}
                        >
                          Criar cobrança vinculada →
                        </a>
                      )}
                  </article>
                ))}
                <h3>Cobranças do cliente</h3>
                {data.payments.length === 0 && (
                  <p>Nenhuma cobrança vinculada.</p>
                )}
                {data.payments.map((p) => (
                  <article className="crm-hub-box" key={p.id}>
                    <p>
                      {p.description} ·{" "}
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(p.amount_cents / 100)}{" "}
                      · {PAYMENT_STATUS[p.status] ?? p.status}
                    </p>
                    <a href={contextLink("/crm/financeiro", ctx)}>
                      Abrir financeiro deste cliente →
                    </a>
                  </article>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </article>
  );
}
export function HubPage({
  leads,
  clients,
  cases,
}: {
  leads: Lead[];
  clients: Client[];
  cases: Case[];
}) {
  const [ctx, setCtx] = useState<Context>(() => {
    const requested = contextFromUrl();
    return Object.keys(requested).length
      ? requested
      : leads[0]
        ? { lead_id: leads[0].id }
        : clients[0]
          ? { client_id: clients[0].id }
          : {};
  });
  const value = ctx.case_id
    ? "case:" + ctx.case_id
    : ctx.lead_id
      ? "lead:" + ctx.lead_id
      : ctx.client_id
        ? "client:" + ctx.client_id
        : "";
  function select(value: string) {
    const [kind, id] = value.split(":");
    const next: Context =
      kind === "case"
        ? { case_id: id }
        : kind === "lead"
          ? { lead_id: id }
          : { client_id: id };
    setCtx(next);
    window.history.replaceState(null, "", contextLink("/crm/hub", next));
  }
  return (
    <div className="crm-hub">
      <label className="crm-hub-selector">
        Contato ou caso
        <select value={value} onChange={(e) => select(e.target.value)}>
          <option disabled value="">
            Selecione
          </option>
          <optgroup label="Atendimentos">
            {leads.map((l) => (
              <option key={l.id} value={"lead:" + l.id}>
                {l.name} · {l.stage}
              </option>
            ))}
          </optgroup>
          <optgroup label="Clientes">
            {clients.map((c) => (
              <option key={c.id} value={"client:" + c.id}>
                {c.full_name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Casos">
            {cases.map((k) => (
              <option key={k.id} value={"case:" + k.id}>
                {k.title}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {value ? (
        <HubCard key={JSON.stringify(ctx)} context={ctx} />
      ) : (
        <p>
          Sem contatos cadastrados. Contatos recebidos por webhook validado
          entram no funil com histórico vinculado.
        </p>
      )}
    </div>
  );
}
