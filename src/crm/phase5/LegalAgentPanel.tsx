import { useState } from "react";
import { invoke } from "../phase4/api";
import { message } from "../types";
import { Context, Document, Run } from "./types";
export function LegalAgentPanel({
  context,
  runs,
  documents,
  onDraft,
  onChanged,
}: {
  context: Context;
  runs: Run[];
  documents: Document[];
  onDraft: (value: string) => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState("reply"),
    [doc, setDoc] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID()),
    [selected, setSelected] = useState<Run | null>(null),
    [content, setContent] = useState(""),
    [reviewed, setReviewed] = useState(false);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<Run>("legal-agent", {
        context,
        task,
        id,
        document_id: doc || null,
        authorized,
      });
      setSelected(result);
      setContent(result.content ?? "");
      setReviewed(false);
      setId(crypto.randomUUID());
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await invoke("legal-agent", {
        operation: "approve_summary",
        context,
        id: selected.id,
        content,
        reviewed,
      });
      onChanged();
      setReviewed(false);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-hub-box">
      <h3>Agente jurídico interno</h3>
      <p>
        Rascunhos sujeitos à revisão do advogado. O contexto é parcial e inclui
        somente as mensagens vinculadas ao caso nesta geração. Não há envio
        automático. Sem caso de cliente, a resposta é apenas administrativa, sem
        parecer jurídico automatizado.
      </p>
      <div className="crm-stack">
        <label>
          Tarefa
          <select
            value={task}
            disabled={busy}
            onChange={(e) => {
              setTask(e.target.value);
              setId(crypto.randomUUID());
            }}
          >
            <option value="reply">Rascunho de resposta</option>
            <option disabled={!context.case_id} value="summary">
              Resumo do caso
            </option>
            <option disabled={!context.case_id} value="meeting">
              Pauta de reunião
            </option>
          </select>
        </label>
        <label>
          Documento como fonte (opcional, até 5 MB)
          <select
            value={doc}
            disabled={busy || !context.case_id}
            onChange={(e) => {
              setDoc(e.target.value);
              setId(crypto.randomUUID());
            }}
          >
            <option value="">Sem documento</option>
            {documents
              .filter((d) => d.size_bytes <= 5 * 1024 * 1024)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.original_name}
                </option>
              ))}
          </select>
        </label>
        <label className="crm-inline-check">
          <input
            type="checkbox"
            checked={authorized}
            disabled={busy}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          Autorizo o processamento deste contexto conforme a política do
          escritório, inclusive o envio ao provedor de IA quando aplicável.
        </label>
        <button disabled={busy || !authorized} onClick={() => void generate()}>
          {busy ? "Preparando rascunho…" : "Gerar rascunho interno"}
        </button>
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <h4>Histórico de rascunhos</h4>
      {runs.length === 0 && <p>Nenhum rascunho neste contexto.</p>}
      <div className="crm-actions">
        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => {
              setSelected(run);
              setContent(run.content ?? "");
              setReviewed(false);
            }}
          >
            {
              (
                {
                  reply: "Resposta",
                  summary: "Resumo",
                  meeting: "Pauta",
                } as Record<string, string>
              )[run.task]
            }{" "}
            · {run.status}
          </button>
        ))}
      </div>
      {selected && (
        <div className="crm-stack">
          <p className="crm-eyebrow">
            Rascunho · revisão humana obrigatória · {selected.status}
          </p>
          {!selected.content ? (
            <p>
              Execução sem conteúdo confirmado. Confira o status antes de
              iniciar outra geração.
            </p>
          ) : (
            <>
              <label>
                Texto para revisão
                <textarea
                  rows={12}
                  maxLength={20000}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setReviewed(false);
                  }}
                />
              </label>
              <label className="crm-inline-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                Revisei fatos, sigilo e conteúdo jurídico deste texto.
              </label>
              {selected.task === "reply" && (
                <button
                  disabled={!reviewed || busy}
                  onClick={() => onDraft(content)}
                >
                  Usar texto revisado no compositor de resposta
                </button>
              )}
              {selected.task === "summary" && context.case_id && (
                <button
                  disabled={!reviewed || busy}
                  onClick={() => void approve()}
                >
                  Salvar resumo revisado no caso
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
