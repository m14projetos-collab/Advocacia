import { FormEvent, useEffect, useState } from "react";
import { Context } from "../phase5/types";
import { invoke } from "../phase4/api";
import { message } from "../types";
interface Kit {
  id: string;
  created_at: string;
  documents: { title: string; content: string }[];
}
export function InitialKitPanel({ context }: { context: Context }) {
  const [scope, setScope] = useState(""),
    [fees, setFees] = useState(""),
    [qualification, setQualification] = useState(""),
    [kits, setKits] = useState<Kit[]>([]),
    [active, setActive] = useState<Kit | null>(null),
    [reviewed, setReviewed] = useState(false),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [reviewId, setReviewId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let alive = true;
    void invoke<{ kits: Kit[] }>("product-hub", {
      operation: "details",
      context,
    })
      .then((d) => {
        if (alive) setKits(d.kits);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [context]);
  function changed(setter: (v: string) => void, value: string) {
    setter(value);
    setId(crypto.randomUUID());
    setReviewed(false);
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const kit = await invoke<Kit>("initial-kit", {
        context,
        id,
        fields: { scope, fees, qualification },
      });
      setActive(kit);
      setDirty(false);
      setKits((items) => [kit, ...items.filter((k) => k.id !== kit.id)]);
      setReviewed(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveReview() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const saved = await invoke<Kit>("initial-kit", {
        operation: "review",
        context,
        id: reviewId,
        base_kit_id: active.id,
        documents: active.documents,
        reviewed,
      });
      setActive(saved);
      setKits((items) => [saved, ...items.filter((k) => k.id !== saved.id)]);
      setDirty(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!context.case_id)
    return <p>Selecione um caso para gerar o kit com os dados do cliente.</p>;
  return (
    <section className="crm-stack">
      <h3>Gerador de Kit Inicial</h3>
      <p>
        Nome, documento, endereço e OAB vêm da ficha e do seu perfil. Complete
        apenas as condições específicas. As três minutas exigem revisão jurídica
        antes da assinatura.
      </p>
      <form onSubmit={generate} className="crm-stack">
        <label>
          Qualificação complementar do cliente
          <input
            required
            maxLength={1500}
            value={qualification}
            onChange={(e) => changed(setQualification, e.target.value)}
            placeholder="Nacionalidade, estado civil e profissão, conforme informado"
          />
        </label>
        <label>
          Objeto e limites da atuação
          <textarea
            required
            maxLength={2500}
            value={scope}
            onChange={(e) => changed(setScope, e.target.value)}
          />
        </label>
        <label>
          Honorários e condições acordadas
          <textarea
            required
            maxLength={2500}
            value={fees}
            onChange={(e) => changed(setFees, e.target.value)}
          />
        </label>
        <button disabled={busy}>Gerar três minutas pré-preenchidas</button>
      </form>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {kits.length > 0 && (
        <details>
          <summary>Versões geradas neste caso</summary>
          {kits.map((k) => (
            <button
              key={k.id}
              onClick={() => {
                setActive(k);
                setDirty(false);
                setReviewed(false);
              }}
            >
              {new Date(k.created_at).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}{" "}
              · abrir kit
            </button>
          ))}
        </details>
      )}
      {active && (
        <>
          <label className="crm-inline-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            Conferi dados, condições, poderes e veracidade da declaração com o
            cliente.
          </label>
          {dirty && (
            <button
              disabled={!reviewed || busy}
              onClick={() => void saveReview()}
            >
              Salvar versão revisada do kit
            </button>
          )}
          <button disabled={!reviewed || dirty} onClick={() => window.print()}>
            Imprimir / Salvar PDF do kit revisado
          </button>
          <div className="crm-kit-print">
            {active.documents.map((doc) => (
              <article className="crm-kit-page" key={doc.title}>
                <h2>{doc.title}</h2>
                <textarea
                  className="crm-kit-edit"
                  aria-label={`Revisar ${doc.title}`}
                  rows={14}
                  maxLength={8000}
                  value={doc.content}
                  onChange={(e) => {
                    setActive({
                      ...active,
                      documents: active.documents.map((d) =>
                        d.title === doc.title
                          ? { ...d, content: e.target.value }
                          : d,
                      ),
                    });
                    setDirty(true);
                    setReviewed(false);
                    setReviewId(crypto.randomUUID());
                  }}
                />
                <pre className="crm-kit-read">{doc.content}</pre>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
