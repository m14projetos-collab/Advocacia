import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Case, Lead, message } from "../types";
import { AppointmentForm } from "./AppointmentForm";
import { DeadlineCalculator } from "./DeadlineCalculator";
import {
  dayBounds,
  monthBounds,
  monthDays,
  officeDate,
  officeInput,
} from "./time";
import {
  Appointment,
  APPOINTMENT_STATUS,
  APPOINTMENT_TYPES,
  safeHttps,
} from "./types";
interface Editor {
  id: string;
  date: string;
  type?: Appointment["type"];
  existing?: Appointment;
}
export function AgendaPage({ leads, cases }: { leads: Lead[]; cases: Case[] }) {
  const today = officeDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError("");
    try {
      const bounds = monthBounds(month);
      const rows: Appointment[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error: queryError } = await supabase!
          .from("appointments")
          .select(
            "id,title,type,starts_at,ends_at,lead_id,case_id,meeting_url,payment_required,status,updated_at",
          )
          .lt("starts_at", bounds.end)
          .gt("ends_at", bounds.start)
          .order("id")
          .range(offset, offset + 499)
          .abortSignal(request.signal);
        if (queryError) throw queryError;
        rows.push(...(data as Appointment[]));
        if (data.length < 500) break;
      }
      if (!request.signal.aborted)
        setItems(rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    } catch (err) {
      if (!request.signal.aborted) setError(message(err));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  const onDay = (date: string) => {
    const bounds = dayBounds(date);
    return items.filter(
      (a) =>
        Date.parse(a.starts_at) < Date.parse(bounds.end) &&
        Date.parse(a.ends_at) > Date.parse(bounds.start),
    );
  };
  function newDeadline(date: string) {
    setMonth(date.slice(0, 7));
    setDay(date);
    setEditor({ id: crypto.randomUUID(), date, type: "prazo" });
  }
  return (
    <div className="crm-agenda">
      <div className="crm-section-toolbar">
        <label>
          Mês da agenda
          <input
            type="month"
            min="2020-01"
            max="2100-12"
            required
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setDay(`${e.target.value}-01`);
              }
            }}
          />
        </label>
        <div className="crm-actions">
          <button disabled={loading} onClick={() => void load()}>
            Atualizar calendário
          </button>
          <button
            className="crm-primary"
            onClick={() => setEditor({ id: crypto.randomUUID(), date: day })}
          >
            Novo compromisso
          </button>
        </div>
      </div>
      <p className="crm-muted">
        Horários de São Paulo. Consultas pendentes também reservam horário;
        prazos podem coincidir com outros compromissos.
      </p>
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
        <p role="status">Carregando calendário…</p>
      ) : (
        <>
          <div className="crm-calendar" aria-label="Calendário mensal">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
              <div className="crm-weekday" key={d}>
                {d}
              </div>
            ))}
            {monthDays(month).map((date, index) =>
              date ? (
                <button
                  key={date}
                  className={
                    date === day
                      ? "crm-calendar-day selected"
                      : "crm-calendar-day"
                  }
                  aria-pressed={date === day}
                  aria-label={`${date.split("-").reverse().join("/")} · ${onDay(date).length} compromissos`}
                  onClick={() => setDay(date)}
                >
                  <span>{Number(date.slice(8))}</span>
                  <small>
                    {onDay(date).length
                      ? `${onDay(date).length} registro${onDay(date).length === 1 ? "" : "s"}`
                      : ""}
                  </small>
                </button>
              ) : (
                <div key={`blank-${index}`} className="crm-calendar-blank" />
              ),
            )}
          </div>
          <h2 className="crm-day-heading">
            Compromissos de {day.split("-").reverse().join("/")}
          </h2>
          {onDay(day).length === 0 && (
            <p className="crm-empty">Nenhum compromisso neste dia.</p>
          )}
          <div className="crm-appointment-list">
            {onDay(day).map((a) => (
              <article
                key={a.id}
                className={`crm-appointment ${a.status === "cancelado" ? "canceled" : ""}`}
              >
                <div>
                  <p className="crm-eyebrow">
                    {APPOINTMENT_TYPES[a.type]} · {APPOINTMENT_STATUS[a.status]}
                    {a.payment_required && a.status === "pendente"
                      ? " · aguarda pagamento"
                      : ""}
                  </p>
                  <h3>{a.title}</h3>
                  <p>
                    {officeInput(a.starts_at).replace("T", " às ")} →{" "}
                    {officeInput(a.ends_at).replace("T", " às ")}
                  </p>
                  {a.case_id && (
                    <p className="crm-muted">
                      {cases.find((k) => k.id === a.case_id)?.title ??
                        "Caso vinculado"}
                    </p>
                  )}
                  {safeHttps(a.meeting_url) && (
                    <a
                      href={safeHttps(a.meeting_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir reunião ↗
                    </a>
                  )}
                </div>
                <button
                  onClick={() =>
                    setEditor({
                      id: a.id,
                      date: officeDate(a.starts_at),
                      existing: a,
                    })
                  }
                >
                  Editar compromisso
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {editor && (
        <AppointmentForm
          key={editor.id}
          {...editor}
          leads={leads}
          cases={cases}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice("Compromisso salvo com sucesso.");
            void load();
          }}
        />
      )}
      <DeadlineCalculator onUse={newDeadline} />
    </div>
  );
}
