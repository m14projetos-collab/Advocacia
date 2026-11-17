import { HttpError, object, rpc, Service, uuid } from "./office.ts";
export function context(value: unknown) {
  const input = object(value);
  const result: Record<string, string> = {};
  for (const key of ["lead_id", "client_id", "case_id"])
    if (input[key]) result[key] = uuid(input[key]);
  if (!Object.keys(result).length)
    throw new HttpError(400, "Selecione um contato ou caso.");
  return result;
}
export function action(
  db: Service,
  actor: string,
  name: string,
  ctx: Record<string, unknown>,
  data: Record<string, unknown> = {},
) {
  return rpc(db, "office_phase5_action", {
    p_actor: actor,
    p_action: name,
    p_context: ctx,
    p_data: data,
  });
}
export async function bounded(req: Request, max = 262144) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Corpo obrigatório.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Arquivo/requisição excede o limite.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function hmac(secret: string, data: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array(data))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function equal(a: string, b: string) {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  let mismatch = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    mismatch |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return mismatch === 0;
}
export async function external(
  url: string,
  init: RequestInit = {},
  timeout = 15000,
) {
  const r = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok)
    throw new HttpError(502, "Provedor indisponível ou requisição recusada.");
  return r;
}
export function enabled(name: string) {
  if (Deno.env.get(name) !== "true")
    throw new HttpError(
      503,
      "Integração ainda não habilitada pelo escritório.",
    );
}
