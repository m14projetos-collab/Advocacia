import { useEffect, useState } from "react";
import { invoke } from "../phase4/api";
import { Appointment, Payment } from "../phase4/types";
import { officeInput } from "../phase4/time";
import { Lead, message } from "../types";
import { contextLink } from "../phase5/types";
export function leadSla(lead: Lead, now = Date.now()) {
  if (
    lead.last_contact_at &&
    lead.last_contact_at >= (lead.last_inbound_at ?? lead.created_at)
  )
    return "Contato realizado";
  const hours = Math.max(
    0,
    Math.floor(
      (now - Date.parse(lead.last_inbound_at ?? lead.created_at)) / 3600000,
    ),
  );
  return hours >= 24
    ? `SLA excedido · ${hours}h sem resposta`
    : `Aguardando contato · ${hours}h`;
}
export function DashboardPage() {
  const [data, setData] = useState<{
      today: string;
      appointments: Appointment[];
      unanswered: Lead[];
      payments: Payment[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await invoke("product-hub", { operation: "dashboard" }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const deadlines = data?.appointments.filter((a) => a.type === "prazo") ?? [],
    today = data?.appointments.filter((a) => a.type !== "prazo") ?? [];
  return (
    <>
      <p className="crm-muted">
        Prioridades do escritório · horário de São Paulo. Prazos exigem
        conferência do advogado.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        Atualizar visão de hoje
      </button>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Carregando prioridades…</p>}
      {data && (
        <div className="crm-today-grid">
          <section className="crm-hub-box">
            <h2>Prazos dos próximos 5 dias</h2>
            <p>Inclui hoje até o quinto dia seguinte.</p>
            {!deadlines.length && <p>Nenhum prazo cadastrado no período.</p>}
            {deadlines.map((a) => (
              <article key={a.id}>
                <a
                  href={contextLink(
                    "/crm/agenda",
                    {
                      ...(a.case_id ? { case_id: a.case_id } : {}),
                      ...(a.lead_id ? { lead_id: a.lead_id } : {}),
                    },
                    { appointment_id: a.id },
                  )}
                >
                  {a.title}
                </a>
                <p>{officeInput(a.starts_at).replace("T", " ")}</p>
              </article>
            ))}
          </section>
          <section className="crm-hub-box">
            <h2>Audiências e reuniões de hoje</h2>
            {!today.length && <p>Nenhum compromisso hoje.</p>}
            {today.map((a) => (
              <article key={a.id}>
                <a
                  href={contextLink(
                    "/crm/agenda",
                    {},
                    { appointment_id: a.id },
                  )}
                >
                  {a.title}
                </a>
                <p>
                  {officeInput(a.starts_at).replace("T", " ")} · {a.status}
                </p>
              </article>
            ))}
          </section>
          <section className="crm-hub-box">
            <h2>Leads sem resposta</h2>
            {!data.unanswered.length && (
              <p>Nenhum atendimento aguardando contato.</p>
            )}
            {data.unanswered.map((l) => (
              <article key={l.id}>
                <a href={contextLink("/crm/hub", { lead_id: l.id })}>
                  {l.name}
                </a>
                <p className="crm-sla">{leadSla(l)}</p>
              </article>
            ))}
          </section>
          <section className="crm-hub-box">
            <h2>Cobranças vencidas / pendentes</h2>
            {!data.payments.length && <p>Nenhuma cobrança pendente.</p>}
            {data.payments.map((p) => (
              <article key={p.id}>
                <a
                  href={contextLink("/crm/financeiro", {
                    client_id: p.client_id,
                    ...(p.case_id ? { case_id: p.case_id } : {}),
                  })}
                >
                  {p.description}
                </a>
                <p>
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(p.amount_cents / 100)}{" "}
                  ·{" "}
                  {p.due_date && p.due_date < data.today
                    ? "Vencida"
                    : "Pendente"}{" "}
                  {p.due_date ?? "sem vencimento"}
                </p>
              </article>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
