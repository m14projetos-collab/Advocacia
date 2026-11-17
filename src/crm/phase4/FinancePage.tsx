import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Case, Client, Lead, message } from "../types";
import { contextFromUrl, contextLink } from "../phase5/types";
import { invoke } from "./api";
import { Appointment, Payment, PAYMENT_STATUS, safeHttps } from "./types";
import { officeInput } from "./time";
const currency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );
function cents(value: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value))
    throw new Error("Use valor como 150,00, sem separador de milhar.");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 100 || result > 999999999999)
    throw new Error("Valor inválido; mínimo de R$ 1,00.");
  return result;
}
export function FinancePage({
  clients,
  cases,
  leads,
}: {
  clients: Client[];
  cases: Case[];
  leads: Lead[];
}) {
  const [items, setItems] = useState<Payment[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  const initial = contextFromUrl();
  const [client, setClient] = useState(initial.client_id ?? cases.find(k=>k.id===initial.case_id)?.client_id ?? "");
  const [caseId, setCaseId] = useState(initial.case_id ?? "");
  const [appointment, setAppointment] = useState(new URLSearchParams(window.location.search).get("appointment_id") ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [fee, setFee] = useState("consulta");
  const [due, setDue] = useState("");
  const [verify, setVerify] = useState<Payment | null>(null);
  const [transaction, setTransaction] = useState("");
  const [slug, setSlug] = useState("");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (keepError = false) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    if (!keepError) setError("");
    try {
      const rows: Payment[] = [];
      const slots: Appointment[] = [];
      await Promise.all([
        (async () => {
          for (let offset = 0; ; offset += 500) {
            const { data, error: e } = await supabase!
              .from("payments")
              .select(
                "id,order_nsu,client_id,case_id,appointment_id,description,fee_type,amount_cents,status,checkout_url,checkout_state,review_required,created_at,due_date,paid_at",
              )
              .order("id")
              .range(offset, offset + 499)
              .abortSignal(request.signal);
            if (e) throw e;
            rows.push(...(data as Payment[]));
            if (data.length < 500) break;
          }
        })(),
        (async () => {
          for (let offset = 0; ; offset += 500) {
            const { data, error: e } = await supabase!
              .from("appointments")
              .select("id,title,case_id,lead_id,starts_at")
              .eq("payment_required", true)
              .eq("status", "pendente")
              .order("id")
              .range(offset, offset + 499)
              .abortSignal(request.signal);
            if (e) throw e;
            slots.push(...(data as Appointment[]));
            if (data.length < 500) break;
          }
        })(),
      ]);
      if (!request.signal.aborted) {
        setItems(rows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
        setAppointments(slots);
      }
    } catch (err) {
      if (!request.signal.aborted) setError(message(err));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  const prefilled = useRef(false);
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get('appointment_id');
    if(loading||!requested||prefilled.current)return;
    prefilled.current=true;
    const slot=appointments.find(a=>a.id===requested);
    if(slot){setCaseId(slot.case_id??'');setClient(slot.case_id?cases.find(k=>k.id===slot.case_id)?.client_id??'':leads.find(l=>l.id===slot.lead_id)?.converted_client_id??'');setAppointment(slot.id);}
    else{setAppointment('');setNotice('Consulta não disponível para nova cobrança pendente. Confira os pagamentos já vinculados.');}
  },[loading,appointments,cases,leads]);
  const visible = client ? items.filter(p=>p.client_id===client) : items;
  const relevantAppointments = appointments.filter((a) =>
    a.case_id
      ? cases.find((k) => k.id === a.case_id)?.client_id === client
      : leads.find((l) => l.id === a.lead_id)?.converted_client_id === client,
  );
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<{ payment: Payment; pending?: boolean }>(
        "infinitepay-checkout",
        {
          id,
          operation: "create",
          payment: {
            client_id: client,
            case_id: caseId || null,
            appointment_id: appointment || null,
            amount_cents: cents(amount),
            description,
            fee_type: fee,
            due_date: due || null,
          },
        },
      );
      setNotice(
        result.pending
          ? "Cobrança em processamento ou aguardando conferência. Atualize os dados antes de criar outra."
          : "Link de pagamento disponível na lista de cobranças.",
      );
      if (result.payment.checkout_url) {
        setId(crypto.randomUUID());
        setAmount("");
        setDescription("");
        setAppointment("");
      }
      await load();
    } catch (err) {
      setError(message(err));
      void load(true);
    } finally {
      setBusy(false);
    }
  }
  async function check(e: FormEvent) {
    e.preventDefault();
    if (!verify) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invoke("infinitepay-checkout", {
        id: verify.id,
        operation: "verify",
        transaction_nsu: transaction,
        slug,
      });
      setNotice(
        "Consulta ao provedor concluída. Confira o status atualizado da cobrança.",
      );
      setVerify(null);
      setTransaction("");
      setSlug("");
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Link copiado.");
    } catch {
      setError("Não foi possível copiar. Use o endereço do link na lista.");
    }
  }
  return (
    <div className="crm-finance">
      <div className="crm-section-toolbar">
        <p>Honorários e consultas · confirmação pelo provedor</p>
        <button disabled={loading || busy} onClick={() => void load()}>
          Atualizar financeiro
        </button>
      </div>
      <div className="crm-summary">
        <span>
          <strong>
            {currency(
              visible
                .filter((p) => ["paid", "settled"].includes(p.status))
                .reduce((n, p) => n + Number(p.amount_cents), 0),
            )}
          </strong>{" "}
          pagos
        </span>
        <span>
          <strong>
            {currency(
              visible
                .filter((p) => p.status === "pending")
                .reduce((n, p) => n + Number(p.amount_cents), 0),
            )}
          </strong>{" "}
          pendentes
        </span>
      </div>
      <details className="crm-editor" open={Boolean(initial.client_id || initial.case_id || new URLSearchParams(window.location.search).get("appointment_id"))}>
        <summary>Nova cobrança InfinitePay</summary>
        <form className="crm-stack" onSubmit={create}>
          <fieldset disabled={busy} className="crm-stack">
            <label>
              Cliente da cobrança
              <select
                required
                value={client}
                onChange={(e) => {
                  setClient(e.target.value);
                  setCaseId("");
                  setAppointment("");
                }}
              >
                <option value="">Selecione o cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Caso da cobrança
              <select
                value={caseId}
                onChange={(e) => {
                  setCaseId(e.target.value);
                  setAppointment("");
                }}
              >
                <option value="">Sem caso</option>
                {cases
                  .filter((k) => k.client_id === client)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Consulta vinculada
              <select
                value={appointment}
                onChange={(e) => {
                  setAppointment(e.target.value);
                  const a = appointments.find(
                    (item) => item.id === e.target.value,
                  );
                  if (a) setCaseId(a.case_id ?? "");
                }}
              >
                <option value="">Sem consulta</option>
                {relevantAppointments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {officeInput(a.starts_at).replace("T", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Descrição interna
              <input
                required
                minLength={1}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <p className="crm-muted">
              O checkout recebe uma descrição genérica do serviço. O conteúdo
              jurídico da descrição interna não é enviado ao provedor.
            </p>
            <div className="crm-grid-2">
              <label>
                Valor em reais
                <input
                  required
                  inputMode="decimal"
                  placeholder="150,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Tipo de honorário
                <select value={fee} onChange={(e) => setFee(e.target.value)}>
                  <option value="consulta">Consulta</option>
                  <option value="inicial">Inicial</option>
                  <option value="parcela">Parcela</option>
                  <option value="exito">Êxito</option>
                </select>
              </label>
            </div>
            <label>
              Vencimento interno (opcional)
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <p className="crm-muted">
              O vencimento interno não encerra o link na InfinitePay.
            </p>
            <button className="crm-primary">
              {busy ? "Processando…" : "Criar link de pagamento"}
            </button>
          </fieldset>
        </form>
      </details>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="crm-notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Carregando cobranças…</p>
      ) : visible.length === 0 ? (
        <p className="crm-empty">Nenhuma cobrança cadastrada.</p>
      ) : (
        <div className="crm-table-scroll">
          <table>
            <caption>Cobranças do escritório</caption>
            <thead>
              <tr>
                <th>Cliente / referência</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    {clients.find((c) => c.id === p.client_id)?.full_name ??
                      "Cliente vinculado"}
                    <p><a href={contextLink("/crm/hub", {client_id:p.client_id,...(p.case_id?{case_id:p.case_id}:{})})}>{p.description} · abrir ficha →</a></p>
                    <small>{p.order_nsu}</small>
                  </td>
                  <td>
                    {currency(Number(p.amount_cents))}
                    {p.due_date && (
                      <p>Venc.: {p.due_date.split("-").reverse().join("/")}</p>
                    )}
                  </td>
                  <td>
                    {PAYMENT_STATUS[p.status] ?? p.status}
                    {p.review_required && (
                      <p className="crm-urgent">Conferência necessária</p>
                    )}
                    {p.appointment_id && (
                      <p className="crm-muted">Vinculado à agenda</p>
                    )}
                  </td>
                  <td>
                    {safeHttps(p.checkout_url) ? (
                      <>
                        <a
                          href={safeHttps(p.checkout_url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir checkout ↗
                        </a>
                        <button onClick={() => void copy(p.checkout_url!)}>
                          Copiar link
                        </button>
                      </>
                    ) : (
                      <p className="crm-muted">
                        Link não disponível. Confira a cobrança antes de criar
                        outra.
                      </p>
                    )}
                    {p.status === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setVerify(p);
                          setTransaction("");
                          setSlug("");
                        }}
                      >
                        Conferir no provedor
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {verify && (
        <section className="crm-editor">
          <h2>Conferir pagamento na InfinitePay</h2>
          <p>
            Informe os identificadores do retorno ou comprovante da transação
            para a cobrança {verify.id}. O status só muda após confirmação no
            provedor.
          </p>
          <form className="crm-stack" onSubmit={check}>
            <label>
              Identificador da transação
              <input
                required
                maxLength={120}
                value={transaction}
                disabled={busy}
                onChange={(e) => setTransaction(e.target.value)}
              />
            </label>
            <label>
              Código da fatura (slug)
              <input
                required
                maxLength={160}
                value={slug}
                disabled={busy}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
            <div className="crm-actions">
              <button disabled={busy}>Consultar confirmação</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setVerify(null)}
              >
                Fechar conferência
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
