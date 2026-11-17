import { FormEvent, useCallback, useEffect, useState } from "react";
import { Case, Client, message } from "../types";
import { invoke } from "../phase4/api";
import { useOfficeRole } from "../OfficeRole";
import { SearchableCombobox } from "../components/SearchableCombobox";
import { caseOptions } from "./options";
interface Source {
  id: string;
  title: string;
  area: string;
  jurisdiction: string;
  official_url: string;
  last_checked_at: string | null;
  last_error: string | null;
}
interface Update {
  id: string;
  source_id: string;
  title: string;
  official_url: string;
  summary: string;
  fetched_at: string;
}
interface Turn {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  citations_json: { url: string; title: string }[];
}
const AREAS = [
  ["familia_sucessoes", "Família e Sucessões"],
  ["medico_saude", "Médico / Saúde"],
  ["criminal", "Prática Criminal"],
  ["contratos", "Contratos"],
  ["etica", "Ética / OAB 205/2021"],
  ["geral", "Geral"],
] as const;
export function CopilotPage({
  cases,
  clients,
}: {
  cases: Case[];
  clients: Client[];
}) {
  const role = useOfficeRole(),
    [sources, setSources] = useState<Source[]>([]),
    [updates, setUpdates] = useState<Update[]>([]),
    [turns, setTurns] = useState<Turn[]>([]),
    [area, setArea] = useState(""),
    [jurisdiction, setJurisdiction] = useState(""),
    [caseId, setCaseId] = useState(""),
    [question, setQuestion] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const loadKnowledge = useCallback(async () => {
    const data = await invoke<{ sources: Source[]; updates: Update[] }>(
      "product-hub",
      { operation: "knowledge" },
    );
    setSources(data.sources);
    setUpdates(data.updates);
  }, []);
  useEffect(() => {
    void loadKnowledge().catch((e) => setError(message(e)));
  }, [loadKnowledge]);
  useEffect(() => {
    let alive = true;
    setTurns([]);
    void invoke<Turn[]>("product-hub", {
      operation: "chat_history",
      context: caseId ? { case_id: caseId } : {},
    })
      .then((d) => {
        if (alive) setTurns(d);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    setId(crypto.randomUUID());
    setAuthorized(false);
    return () => {
      alive = false;
    };
  }, [caseId]);
  async function sync() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await invoke<{
        results: { ok: boolean }[];
        datajud?: { error?: string };
      }>("sync-legal-updates", { context: caseId ? { case_id: caseId } : {} });
      setNotice(
        `${data.results.filter((s) => s.ok).length} fontes consultadas; ${data.results.filter((s) => !s.ok).length} indisponíveis, com histórico preservado.${data.datajud?.error ? " " + data.datajud.error : ""}`,
      );
      await loadKnowledge();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const turn = await invoke<Turn>("legal-copilot", {
        id,
        question,
        area,
        jurisdiction,
        context: caseId ? { case_id: caseId } : {},
        authorized,
      });
      setTurns((items) => [...items.filter((t) => t.id !== turn.id), turn]);
      setId(crypto.randomUUID());
      setQuestion("");
      setAuthorized(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const filtered = sources.filter(
    (s) =>
      (!area || s.area === area || s.area === "geral" || s.area === "etica") &&
      (!jurisdiction ||
        s.jurisdiction === jurisdiction ||
        s.jurisdiction === "Nacional"),
  );
  return (
    <section className="crm-stack">
      <p>
        Copiloto interno com Tom de Voz do Matheus e revisão humana. A pesquisa
        retorna trechos oficiais verificáveis; os rascunhos de resumo, pauta e
        resposta permanecem na ficha do caso.
      </p>
      <div className="crm-grid-2">
        <label>
          Área do conhecimento
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas as áreas</option>
            {AREAS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Jurisdição
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          >
            <option value="">Todas as jurisdições</option>
            {[
              "SP/TJSP",
              "RJ/TJRJ",
              "MG/TJMG",
              "STJ",
              "STF",
              "CNJ",
              "Nacional",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <SearchableCombobox
        label="Caso para contexto do copiloto"
        value={caseId}
        options={caseOptions(cases, clients)}
        onChange={setCaseId}
        emptyLabel="Pesquisa interna sem dados de caso"
      />
      {caseId && (
        <a href={`/crm/hub?case_id=${caseId}`}>
          Abrir ficha para resumo, pauta e rascunho de resposta →
        </a>
      )}
      {role === "admin" ? (
        <div className="crm-actions">
          <button disabled={busy} onClick={() => void sync()}>
            Atualizar Base Jurídica
          </button>
          <a href="/crm/agente">Configurar Tom de Voz do Matheus →</a>
        </div>
      ) : (
        <p>
          Atualizações e configuração do tom são administradas pelo responsável
          do escritório.
        </p>
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
      <div className="crm-today-grid">
        <section className="crm-stack">
          <h2>Chat copiloto interno</h2>
          {!turns.length && (
            <p>
              Faça uma pergunta com área e jurisdição. Sem fonte disponível, a
              pesquisa informa a lacuna.
            </p>
          )}
          {turns.map((t) => (
            <article className="crm-hub-box" key={t.id}>
              <h3>{t.question}</h3>
              <p className="crm-message-content">
                {t.answer ??
                  (t.status === "failed"
                    ? "Consulta não concluída. Refine a pergunta ou confira a configuração."
                    : "Consulta em processamento.")}
              </p>
              {t.citations_json.map((c, i) => (
                <a
                  key={i}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fonte oficial: {c.title} ↗
                </a>
              ))}
            </article>
          ))}
          <form onSubmit={ask} className="crm-stack">
            <label>
              Pergunta ao copiloto
              <textarea
                required
                minLength={2}
                maxLength={4000}
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setId(crypto.randomUUID());
                }}
              />
            </label>
            <label className="crm-inline-check">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              Autorizo processar este contexto e revisarei a resposta antes de
              qualquer uso externo.
            </label>
            <button disabled={busy || !authorized}>
              Consultar fontes com o copiloto
            </button>
          </form>
        </section>
        <section>
          <h2>Base jurídica oficial</h2>
          <p>
            Extratos datados das páginas oficiais. Uma consulta bem-sucedida não
            garante vigência ou cobertura integral; confira a fonte. DataJud
            fornece metadados públicos, não jurisprudência nem autos sigilosos.
          </p>
          {filtered.map((s) => {
            const latest = updates.find((u) => u.source_id === s.id);
            return (
              <article key={s.id} className="crm-hub-box">
                <h3>{s.title}</h3>
                <p>
                  {s.jurisdiction} · {AREAS.find(([v]) => v === s.area)?.[1]}
                </p>
                <a
                  href={s.official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir fonte oficial ↗
                </a>
                {s.last_error && <p className="crm-error">{s.last_error}</p>}
                <p>
                  Última tentativa:{" "}
                  {s.last_checked_at
                    ? new Date(s.last_checked_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })
                    : "Ainda não consultada"}
                </p>
                {latest ? (
                  <details>
                    <summary>
                      Extrato de{" "}
                      {new Date(latest.fetched_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </summary>
                    <p>{latest.summary}</p>
                  </details>
                ) : (
                  <p>Sem extrato válido armazenado.</p>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </section>
  );
}
