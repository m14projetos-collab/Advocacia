import { rpc, Service, HttpError } from "./office.ts";
export function product(
  db: Service,
  actor: string,
  operation: string,
  ctx: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
) {
  return rpc(db, "office_phase6_action", {
    p_actor: actor,
    p_action: operation,
    p_context: ctx,
    p_data: data,
  });
}
export function optionalContext(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}
export function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, "Configuração do serviço pendente.");
  return value;
}
export function cleanText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
