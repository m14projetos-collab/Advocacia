import { useEffect, useState } from "react";
import { Case, Client, message } from "../types";
import { invoke } from "../phase4/api";
import { SearchableCombobox } from "../components/SearchableCombobox";
import { caseOptions } from "./options";
interface Email {
  id: string;
  sender: string;
  subject: string;
  content: string;
  priority: string;
  classification_method: string;
  cnj_numbers_json: string[];
  suggested_case_ids: string[];
  case_id: string | null;
  status: string;
  updated_at: string;
  received_at: string;
}
export function EmailTriagePage({
  cases,
  clients,
}: {
  cases: Case[];
  clients: Client[];
}) {
  const [items, setItems] = useState<Email[]>([]),
    [selected, setSelected] = useState<Email | null>(null),
    [caseId, setCaseId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(0);
  async function load(next = 0) {
    setBusy(true);
    setError("");
    try {
      const data = await invoke<{ items: Email[]; has_more: boolean }>(
        "product-hub",
        { operation: "triage_list", offset: next },
      );
      setItems((current) => (next ? [...current, ...data.items] : data.items));
      setOffset(next);
      setHasMore(data.has_more);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function review(status: string) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await invoke("product-hub", {
        operation: "triage_review",
        id: selected.id,
        context: caseId ? { case_id: caseId } : {},
        status,
        expected_updated_at: selected.updated_at,
      });
      setSelected(null);
      setNotice(
        status === "linked"
          ? "E-mail vinculado ao caso após revisão. Nenhum prazo foi criado automaticamente."
          : "E-mail marcado como revisado e dispensado.",
      );
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-stack">
      <p>
        Recebimento por encaminhamento configurado. A prioridade é sugestão;
        intimações e termo inicial exigem conferência na fonte oficial. Anexos
        permanecem na caixa de origem até upload privado no caso.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        Atualizar triagem
      </button>
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
      {!items.length && !busy && (
        <p>
          Nenhum e-mail recebido. Configure o endereço de encaminhamento
          conforme o checklist de implantação.
        </p>
      )}
      <div className="crm-today-grid">
        <div>
          {items.map((item) => (
            <article key={item.id} className="crm-hub-box">
              <strong>
                {item.priority.toUpperCase()} ·{" "}
                {item.classification_method === "ai"
                  ? "Classificação IA"
                  : "Regras auxiliares"}
              </strong>
              <button
                onClick={() => {
                  setSelected(item);
                  setCaseId(item.case_id ?? "");
                }}
              >
                {item.subject}
              </button>
              <p>
                {item.sender} ·{" "}
                {new Date(item.received_at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}{" "}
                ·{" "}
                {item.status === "pending"
                  ? "Revisão pendente"
                  : item.status === "linked"
                    ? "Vinculado"
                    : "Dispensado"}
              </p>
              {item.case_id && (
                <a href={`/crm/hub?case_id=${item.case_id}`}>
                  Abrir caso vinculado →
                </a>
              )}
            </article>
          ))}
          {hasMore && (
            <button disabled={busy} onClick={() => void load(offset + 100)}>
              Carregar e-mails anteriores
            </button>
          )}
        </div>
        {selected && (
          <div className="crm-hub-box">
            <h2>{selected.subject}</h2>
            <pre className="crm-message-content">{selected.content}</pre>
            <p>
              CNJ identificado:{" "}
              {selected.cnj_numbers_json.join(", ") || "Nenhum número válido"}
            </p>
            {selected.suggested_case_ids.map((id) => (
              <button key={id} onClick={() => setCaseId(id)}>
                Selecionar sugestão:{" "}
                {cases.find((k) => k.id === id)?.title ?? "Caso cadastrado"}
              </button>
            ))}
            <SearchableCombobox
              label="Caso da intimação ou e-mail"
              value={caseId}
              options={caseOptions(cases, clients)}
              onChange={setCaseId}
            />
            <div className="crm-actions">
              <button
                disabled={busy || !caseId}
                onClick={() => void review("linked")}
              >
                Confirmar vínculo após revisão
              </button>
              <button disabled={busy} onClick={() => void review("dismissed")}>
                Dispensar após revisão
              </button>
              <button onClick={() => setSelected(null)}>Fechar e-mail</button>
            </div>
            {caseId && (
              <a href={`/crm/agenda?case_id=${caseId}`}>
                Conferir agenda e cadastrar prazo manualmente →
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
