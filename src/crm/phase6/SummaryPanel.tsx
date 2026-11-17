import { FormEvent, useEffect, useState } from "react";
import { Context, HubSnapshot } from "../phase5/types";
import { invoke } from "../phase4/api";
import { message } from "../types";
import { normalizePhoneToE164 } from "../../lib/phone";
interface Party {
  id: string;
  case_id: string;
  full_name: string;
  party_role: string;
  document_number: string | null;
}
export function SummaryPanel({
  context,
  data,
  onChanged,
}: {
  context: Context;
  data: HubSnapshot;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [phone, setPhone] = useState(data.client?.phone ?? ""),
    [email, setEmail] = useState(data.client?.email ?? ""),
    [address, setAddress] = useState(data.client?.address_json ?? {}),
    [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalized = phone ? normalizePhoneToE164(phone) : "";
      if (phone && !normalized) throw new Error("Telefone inválido.");
      await invoke("product-hub", {
        operation: "client_save",
        context,
        client: {
          phone: normalized,
          email,
          address_json: address,
          expected_updated_at: data.client?.updated_at,
        },
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const [detail, setDetail] = useState<{
      parties: Party[];
      conflicts: Party[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void invoke<{ parties: Party[]; conflicts: Party[] }>("product-hub", {
      operation: "details",
      context,
    })
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [context]);
  return (
    <section className="crm-stack">
      <h3>Resumo & Partes / Conflito</h3>
      {data.client && (
        <>
          <button
            onClick={() => {
              setPhone(data.client?.phone ?? "");
              setEmail(data.client?.email ?? "");
              setAddress(data.client?.address_json ?? {});
              setEditing((v) => !v);
            }}
          >
            Editar contato e endereço do cliente
          </button>
          {editing && (
            <form onSubmit={save} className="crm-stack">
              <label>
                Telefone do cliente
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label>
                E-mail do cliente
                <input
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <div className="crm-grid-2">
                {[
                  ["street", "Logradouro"],
                  ["number", "Número"],
                  ["complement", "Complemento"],
                  ["neighborhood", "Bairro"],
                  ["city", "Cidade"],
                  ["state", "UF"],
                  ["cep", "CEP"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={300}
                      value={address[key] ?? ""}
                      onChange={(e) =>
                        setAddress({ ...address, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <p>
                Nome e documento preservam a formalização e a checagem de
                conflitos.
              </p>
              <button disabled={busy}>Salvar contato e endereço</button>
            </form>
          )}
        </>
      )}
      <dl className="crm-profile">
        <dt>Cliente / contato</dt>
        <dd>{data.client?.full_name ?? data.lead?.name}</dd>
        <dt>Documento</dt>
        <dd>{data.client?.document_number ?? "Ainda não formalizado"}</dd>
        <dt>Telefone</dt>
        <dd>{data.phone ?? "Não informado"}</dd>
        <dt>E-mail</dt>
        <dd>{data.client?.email ?? data.lead?.email ?? "Não informado"}</dd>
        <dt>CNJ</dt>
        <dd>{data.case?.cnj_number ?? "Não informado"}</dd>
      </dl>
      <p className="crm-message-content">
        {data.case?.ai_summary ??
          data.lead?.summary ??
          "Nenhum resumo aprovado. Use o agente interno e revise o rascunho antes de salvar."}
      </p>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {detail && (
        <>
          <h4>Partes registradas</h4>
          {!detail.parties.length && (
            <p>Selecione um caso ou confira as partes na formalização.</p>
          )}
          {detail.parties.map((p) => (
            <p key={p.id}>
              {p.full_name} · {p.party_role} ·{" "}
              {p.document_number ?? "Sem documento"}
            </p>
          ))}
          <h4>Coincidências em outros casos</h4>
          <p>
            A correspondência por documento ou nome é um alerta de revisão, não
            uma conclusão de conflito.
          </p>
          {!detail.conflicts.length && (
            <p>Nenhuma coincidência exata nesta consulta.</p>
          )}
          {detail.conflicts.map((p) => (
            <p key={p.id}>
              <a href={`/crm/hub?case_id=${p.case_id}`}>
                {p.full_name} · {p.party_role} → conferir caso
              </a>
            </p>
          ))}
        </>
      )}
    </section>
  );
}
