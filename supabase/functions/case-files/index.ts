import {
  body,
  cors,
  failure,
  HttpError,
  member,
  response,
  uuid,
} from "../_shared/office.ts";
import { action, bounded, context } from "../_shared/phase5.ts";
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
function mime(bytes: Uint8Array, declared: string) {
  const prefix = new TextDecoder().decode(bytes.slice(0, 5));
  let detected = "";
  if (prefix === "%PDF-") detected = "application/pdf";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    detected = "image/jpeg";
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    detected = "image/png";
  else if (declared === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!text.includes("\0")) detected = "text/plain";
    } catch {
      /* invalid */
    }
  }
  if (!detected || declared !== detected)
    throw new HttpError(
      400,
      "Formato não permitido ou conteúdo diferente do MIME. Use PDF, TXT UTF-8, JPEG ou PNG.",
    );
  return detected;
}
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const bytes = await bounded(req, 21 * 1024 * 1024);
      const form = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type")! },
      }).formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 20 * 1024 * 1024
      )
        throw new HttpError(400, "Arquivo deve ter de 1 byte a 20 MB.");
      const ctx = context(JSON.parse(String(form.get("context")))),
        id = uuid(form.get("id"));
      if (!ctx.case_id) throw new HttpError(400, "Selecione um caso.");
      await action(db, actor, "snapshot", ctx);
      const raw = new Uint8Array(await file.arrayBuffer()),
        type = mime(raw, file.type),
        hash = await digest(raw);
      const path = `${ctx.case_id}/${id}.${{ "application/pdf": "pdf", "text/plain": "txt", "image/jpeg": "jpg", "image/png": "png" }[type]}`;
      const { data: previous, error: previousError } = await db
        .from("case_documents")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (previousError)
        throw new HttpError(503, "Não foi possível conferir o arquivo.");
      if (previous) {
        if (previous.case_id !== ctx.case_id || previous.sha256 !== hash)
          throw new HttpError(
            409,
            "Identificador já utilizado em outro arquivo.",
          );
        return response(previous, 200, headers);
      }
      const store = db.storage.from("case-files");
      const { error: uploadError } = await store.upload(path, raw, {
        contentType: type,
        upsert: false,
      });
      if (uploadError) {
        const { data: existing, error: downloadError } =
          await store.download(path);
        if (
          downloadError ||
          !existing ||
          (await digest(new Uint8Array(await existing.arrayBuffer()))) !== hash
        )
          throw new HttpError(
            502,
            "Upload não confirmado. Tente novamente com o mesmo arquivo.",
          );
      }
      // Nunca apagar em erro ambíguo do banco: o commit pode ter ocorrido. Retry usa mesmo UUID/hash.
      return response(
        await action(db, actor, "file_add", ctx, {
          id,
          storage_path: path,
          original_name:
            file.name.replace(/[\/\\\u0000-\u001f]/g, "_").slice(0, 255) ||
            "documento",
          mime_type: type,
          size_bytes: file.size,
          sha256: hash,
        }),
        201,
        headers,
      );
    }
    const input = await body(req),
      ctx = context(input.context);
    const doc = await action(db, actor, "file_access", ctx, {
      id: uuid(input.id),
      purpose: "download",
    });
    const { data, error } = await db.storage
      .from("case-files")
      .createSignedUrl(doc.storage_path, 60, { download: doc.original_name });
    if (error || !data)
      throw new HttpError(503, "Não foi possível emitir o acesso ao arquivo.");
    return response({ url: data.signedUrl, expires_in: 60 }, 200, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
