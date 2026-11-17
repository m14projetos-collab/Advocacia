import { FormEvent, useEffect, useState } from "react";
import { invoke } from "../phase4/api";
import { message } from "../types";
import { PRACTICE_AREAS } from "../../data/office";
interface Config {
  tone_examples_json: { input: string; output: string }[];
  practice_knowledge_json: Record<string, string>;
  document_ai_enabled: boolean;
  oab_guardrails_enabled: boolean;
  updated_at: string;
}
export function AgentConfigPage() {
  const [config, setConfig] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setError("");
    try {
      setConfig(
        await invoke<Config>("legal-agent", { operation: "config_get" }),
      );
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConfig(
        await invoke<Config>("legal-agent", {
          operation: "config_save",
          config: {
            ...config,
            expected_updated_at: config.updated_at,
            oab_guardrails_enabled: true,
          },
        }),
      );
      setNotice("Estilo e base de conhecimento salvos.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crm-editor">
      <h2>Agente do Matheus · configuração</h2>
      <p>
        Cadastre apenas exemplos reais autorizados e anonimizados e orientações
        conferidas. A configuração orienta rascunhos internos; não publica nem
        envia respostas automaticamente.
      </p>
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
      {!config ? (
        <button onClick={() => void load()}>Carregar configuração</button>
      ) : (
        <form className="crm-stack" onSubmit={save}>
          <fieldset disabled={busy} className="crm-stack">
            <h3>Exemplos reais do tom de voz</h3>
            {config.tone_examples_json.map((example, index) => (
              <section className="crm-hub-box" key={index}>
                <label>
                  Entrada do exemplo {index + 1}
                  <textarea
                    required
                    rows={2}
                    maxLength={1500}
                    value={example.input}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        tone_examples_json: config.tone_examples_json.map(
                          (x, i) =>
                            i === index ? { ...x, input: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Resposta do Matheus {index + 1}
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={example.output}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        tone_examples_json: config.tone_examples_json.map(
                          (x, i) =>
                            i === index ? { ...x, output: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setConfig({
                      ...config,
                      tone_examples_json: config.tone_examples_json.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  Remover exemplo {index + 1}
                </button>
              </section>
            ))}
            <button
              type="button"
              disabled={config.tone_examples_json.length >= 10}
              onClick={() =>
                setConfig({
                  ...config,
                  tone_examples_json: [
                    ...config.tone_examples_json,
                    { input: "", output: "" },
                  ],
                })
              }
            >
              Adicionar exemplo real
            </button>
            <h3>Base de conhecimento</h3>
            {PRACTICE_AREAS.map((area) => (
              <label key={area.id}>
                {area.title}
                <textarea
                  rows={4}
                  maxLength={4000}
                  value={config.practice_knowledge_json[area.id] ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      practice_knowledge_json: {
                        ...config.practice_knowledge_json,
                        [area.id]: e.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
            <label className="crm-inline-check">
              <input type="checkbox" checked disabled />
              Trava ética OAB sempre ativa
            </label>
            <label className="crm-inline-check">
              <input
                type="checkbox"
                checked={config.document_ai_enabled}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    document_ai_enabled: e.target.checked,
                  })
                }
              />
              Autorizar documentos privados no provedor de IA conforme política
              do escritório
            </label>
            <p className="crm-muted">
              A configuração de credenciais, modelo e retenção do provedor é
              feita somente no backend. Arquivos ainda exigem autorização em
              cada geração.
            </p>
            <button className="crm-primary">
              {busy ? "Salvando…" : "Salvar configuração do agente"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
