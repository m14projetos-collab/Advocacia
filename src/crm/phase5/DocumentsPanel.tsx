import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { invoke } from "../phase4/api";
import { message } from "../types";
import { Context, Document } from "./types";
export function DocumentsPanel({
  context,
  documents,
  onChanged,
}: {
  context: Context;
  documents: Document[];
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [access, setAccess] = useState<{ id: string; url: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!access) return;
    const timer = setTimeout(() => setAccess(null), 60000);
    return () => clearTimeout(timer);
  }, [access]);
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Use arquivo de até 20 MB.");
      const form = new FormData();
      form.set("context", JSON.stringify(context));
      form.set("id", id);
      form.set("file", file);
      const { data, error: edgeError } = await supabase!.functions.invoke(
        "case-files",
        { body: form },
      );
      if (edgeError) {
        const payload =
          edgeError.context instanceof Response
            ? await edgeError.context.json().catch(() => null)
            : null;
        throw new Error(
          payload?.error ??
            "Upload não confirmado. Tente novamente com o mesmo arquivo.",
        );
      }
      if (!data?.id) throw new Error("Upload não confirmado.");
      setNotice("Documento armazenado no caso, com acesso privado.");
      setId(crypto.randomUUID());
      setFile(null);
      if (input.current) input.current.value = "";
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    setBusy(true);
    setError("");
    setAccess(null);
    try {
      const result = await invoke<{ url: string }>("case-files", {
        context,
        id,
      });
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== new URL(import.meta.env.VITE_SUPABASE_URL).hostname
      )
        throw new Error("URL de arquivo inválida.");
      setAccess({ id, url: result.url });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  if (!context.case_id)
    return (
      <p>Selecione um caso do cliente para armazenar documentos privados.</p>
    );
  return (
    <section className="crm-hub-box">
      <h3>Documentos privados do caso</h3>
      <p className="crm-muted">
        PDF, TXT UTF-8, JPEG ou PNG, até 20 MB. O arquivo fica protegido no
        caso; o acesso de download expira em 60 segundos. Não há link público
        permanente.
      </p>
      <form className="crm-stack" onSubmit={upload}>
        <label>
          Arquivo do caso
          <input
            ref={input}
            type="file"
            accept="application/pdf,text/plain,image/jpeg,image/png"
            required
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setId(crypto.randomUUID());
            }}
          />
        </label>
        <button disabled={busy || !file}>Enviar documento privado</button>
      </form>
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
      {documents.length === 0 && <p>Nenhum documento neste caso.</p>}
      <ul className="crm-document-list">
        {documents.map((doc) => (
          <li key={doc.id}>
            <span>
              {doc.original_name} · {Math.ceil(doc.size_bytes / 1024)} KB
            </span>
            <button disabled={busy} onClick={() => void download(doc.id)}>
              Gerar acesso de 60s
            </button>
            {access?.id === doc.id && (
              <a href={access.url} target="_blank" rel="noopener noreferrer">
                Baixar {doc.original_name} ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
