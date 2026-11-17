import { FormEvent, useState } from "react";
import { Case, Lead, message } from "../types";
import { contextFromUrl } from "../phase5/types";
import { invoke } from "./api";
import { fromOfficeInput, officeInput } from "./time";
import { Appointment, APPOINTMENT_STATUS, APPOINTMENT_TYPES } from "./types";
export function AppointmentForm({
  existing,
  id,
  date,
  type,
  leads,
  cases,
  onSaved,
  onClose,
}: {
  existing?: Appointment;
  id: string;
  date: string;
  type?: Appointment["type"];
  leads: Lead[];
  cases: Case[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [kind, setKind] = useState(existing?.type ?? type ?? "consulta");
  const [start, setStart] = useState(
    existing ? officeInput(existing.starts_at) : `${date}T09:00`,
  );
  const [end, setEnd] = useState(
    existing ? officeInput(existing.ends_at) : `${date}T10:00`,
  );
  const initial = contextFromUrl();
  const [caseId, setCaseId] = useState(existing?.case_id ?? initial.case_id ?? "");
  const [leadId, setLeadId] = useState(existing?.lead_id ?? initial.lead_id ?? "");
  const [meeting, setMeeting] = useState(existing?.meeting_url ?? "");
  const [required, setRequired] = useState(existing?.payment_required ?? false);
  const [status, setStatus] = useState(existing?.status ?? "pendente");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const starts = fromOfficeInput(start),
        ends = fromOfficeInput(end);
      if (ends <= starts)
        throw new Error("O fim deve ser posterior ao início.");
      await invoke("appointments", {
        id,
        expected_updated_at: existing?.updated_at ?? null,
        appointment: {
          title,
          type: kind,
          starts_at: starts,
          ends_at: ends,
          lead_id: leadId || null,
          case_id: caseId || null,
          meeting_url: meeting || null,
          payment_required: required,
          status,
        },
      });
      onSaved();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-editor" aria-labelledby="appointment-form-title">
      <h2 id="appointment-form-title">
        {existing ? "Editar compromisso" : "Novo compromisso"}
      </h2>
      <form onSubmit={save} className="crm-stack">
        <fieldset disabled={busy} className="crm-stack">
          <label>
            Título do compromisso
            <input
              required
              minLength={2}
              maxLength={240}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="crm-grid-2">
            <label>
              Tipo de compromisso
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Appointment["type"]);
                  if (e.target.value !== "consulta") setRequired(false);
                }}
              >
                {Object.entries(APPOINTMENT_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status do compromisso
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as Appointment["status"])
                }
              >
                {Object.entries(APPOINTMENT_STATUS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="crm-grid-2">
            <label>
              Início (São Paulo)
              <input
                required
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Fim (São Paulo)
              <input
                required
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <label>
            Caso vinculado
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Sem caso</option>
              {cases.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atendimento vinculado
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Sem atendimento</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Link de reunião (HTTPS, opcional)
            <input
              type="url"
              value={meeting}
              maxLength={1000}
              onChange={(e) => setMeeting(e.target.value)}
            />
          </label>
          {kind === "consulta" && (
            <label className="crm-inline-check">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Confirmar esta consulta somente após o pagamento
            </label>
          )}
          {required && (
            <p className="crm-muted">
              Vincule um caso ou um atendimento já convertido. A cobrança será
              criada no Financeiro, e a consulta ficará pendente até a
              confirmação no provedor.
            </p>
          )}
          <div className="crm-actions">
            <button className="crm-primary">
              {busy ? "Salvando…" : "Salvar compromisso"}
            </button>
            <button type="button" onClick={onClose}>
              Fechar edição
            </button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="crm-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
