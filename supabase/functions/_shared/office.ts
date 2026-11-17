import { createClient } from "npm:@supabase/supabase-js@2.119.0";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
export function cors(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = (
    Deno.env.get("APP_ORIGIN") ??
    Deno.env.get("ALLOWED_ORIGINS") ??
    ""
  )
    .split(",")
    .map((s) => s.trim());
  if (origin && !allowed.includes(origin))
    throw new HttpError(403, "Origem não autorizada.");
  return {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
export function service() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(503, "Serviço não configurado.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export type Service = ReturnType<typeof service>;
export async function member(req: Request) {
  const jwt = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!jwt) throw new HttpError(401, "Entre novamente para continuar.");
  const db = service();
  const {
    data: { user },
    error,
  } = await db.auth.getUser(jwt);
  if (error || !user) throw new HttpError(401, "Sessão inválida ou expirada.");
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError || !profile)
    throw new HttpError(403, "Acesso restrito a membros ativos.");
  return { db, actor: user.id };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Objeto inválido.");
  return value as Record<string, unknown>;
}
export async function body(req: Request) {
  if (Number(req.headers.get("content-length")) > 32_768)
    throw new HttpError(413, "Requisição muito grande.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Corpo obrigatório.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32_768) {
      await reader.cancel();
      throw new HttpError(413, "Requisição muito grande.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
export function uuid(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(400, "Identificador inválido.");
  return value;
}
export function text(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `${label} inválido.`);
  return value.trim();
}
export async function rpc(
  db: Service,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw new HttpError(
      error.code === "42501"
        ? 403
        : ["40001", "23P01", "23505"].includes(error.code)
          ? 409
          : 400,
      error.message,
    );
  return data;
}
export function failure(error: unknown, headers: Record<string, string> = {}) {
  return response(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "Serviço indisponível. Tente novamente.",
    },
    error instanceof HttpError ? error.status : 503,
    headers,
  );
}
