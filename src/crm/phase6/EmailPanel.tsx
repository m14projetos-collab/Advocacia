import { FormEvent, useEffect, useState } from "react";
import { Context, HubSnapshot } from "../phase5/types";
import { invoke } from "../phase4/api";
import { message } from "../types";
import { SearchableCombobox } from "../components/SearchableCombobox";
interface Preview {
  recipient: string;
  subject: string;
  content: string;
  preview_token: string;
}
interface History {
  id: string;
  template: string;
  recipient: string;
  status: string;
  created_at: string;
}
export function EmailPanel({
  context,
  data,
}: {
  context: Context;
  data: HubSnapshot;
}) {
  const [template, setTemplate] = useState("summary"),
    [reference, setReference] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [reviewed, setReviewed] = useState(false),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<History[]>([]),
    [inbound, setInbound] = useState<
      {
        id: string;
        subject: string;
        content: string;
        sender: string;
        received_at: string;
      }[]
    >([]);
  function load() {
    void invoke<{
      emails: History[];
      inbound_emails?: {
        id: string;
        subject: string;
        content: string;
        sender: string;
        received_at: string;
      }[];
    }>("product-hub", { operation: "details", context })
      .then((d) => {
        setHistory(d.emails);
        setInbound(d.inbound_emails ?? []);
      })
      .catch((e) => setError(message(e)));
  }
  useEffect(() => {
    load();
  }, [context]);
  function reset() {
    setPreview(null);
    setReviewed(false);
    setId(crypto.randomUUID());
    setNotice("");
  }
  async function prepare(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setPreview(
        await invoke("email-send", {
          operation: "preview",
          context,
          template,
          reference_id: reference || null,
        }),
      );
      setReviewed(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<{ pending: boolean }>("email-send", {
        context,
        id,
        template,
        reference_id: reference || null,
        reviewed,
        preview_token: preview?.preview_token,
      });
      setNotice(
        result.pending
          ? "Envio sem confirmação. Confira o provedor antes de tentar outro envio."
          : "E-mail enviado e registrado no cliente/caso.",
      );
      setReviewed(false);
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const options =
    template === "payment"
      ? data.payments
          .filter(
            (p) =>
              p.status === "pending" &&
              p.checkout_url &&
              (!context.case_id || p.case_id === context.case_id),
          )
          .map((p) => ({
            value: p.id,
            label: p.description,
            description: "Link InfinitePay cadastrado",
            recent: p.created_at,
          }))
      : data.appointments
          .filter(
            (a) =>
              a.status === "confirmado" &&
              (!context.case_id || a.case_id === context.case_id),
          )
          .map((a) => ({
            value: a.id,
            label: a.title,
            description: new Date(a.starts_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }),
            recent: a.starts_at,
          }));
  if (!context.client_id)
    return (
      <p>
        Converta o atendimento e confirme o e-mail do cliente antes do envio
        transacional.
      </p>
    );
  return (
    <section className="crm-stack">
      <h3>E-mail ao cliente</h3>
      <p>
        Envie resumo já aprovado, link de cobrança ou confirmação de compromisso
        para o endereço cadastrado. Confira conteúdo e destinatário antes de
        autorizar.
      </p>
      <form onSubmit={prepare} className="crm-stack">
        <label>
          Modelo de e-mail
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              setReference("");
              reset();
            }}
          >
            <option value="summary">Resumo aprovado</option>
            <option value="payment">Cobrança InfinitePay</option>
            <option value="appointment">Confirmação de agenda</option>
          </select>
        </label>
        {template !== "summary" && (
          <SearchableCombobox
            label="Registro do e-mail"
            required
            value={reference}
            options={options}
            onChange={(v) => {
              setReference(v);
              reset();
            }}
          />
        )}
        <button disabled={busy}>Pré-visualizar e-mail</button>
      </form>
      {preview && (
        <div className="crm-hub-box">
          <p>
            Para: <strong>{preview.recipient}</strong>
          </p>
          <h4>{preview.subject}</h4>
          <pre className="crm-message-content">{preview.content}</pre>
          <label className="crm-inline-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            Revisei o conteúdo e autorizo envio ao destinatário acima.
          </label>
          <button disabled={!reviewed || busy} onClick={() => void send()}>
            Enviar e-mail revisado
          </button>
        </div>
      )}
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
      <h4>E-mails recebidos e vinculados após triagem</h4>
      {!inbound.length && <p>Nenhum e-mail recebido vinculado a esta ficha.</p>}
      {inbound.map((e) => (
        <details key={e.id}>
          <summary>
            {e.subject} · {e.sender}
          </summary>
          <p className="crm-message-content">{e.content}</p>
        </details>
      ))}
      <h4>Histórico de envios</h4>
      {!history.length && <p>Nenhum envio registrado.</p>}
      {history.map((e) => (
        <p key={e.id}>
          {{
            summary: "Resumo",
            payment: "Cobrança",
            appointment: "Compromisso",
          }[e.template] ?? e.template}{" "}
          · {e.recipient} ·{" "}
          {e.status === "sent"
            ? "Enviado"
            : e.status === "unknown"
              ? "Confirmação incerta"
              : "Em processamento"}{" "}
          ·{" "}
          {new Date(e.created_at).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          })}
        </p>
      ))}
    </section>
  );
}
