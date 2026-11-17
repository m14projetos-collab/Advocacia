import {
  body,
  cors,
  failure,
  HttpError,
  member,
  object,
  response,
  text,
  uuid,
} from "../_shared/office.ts";
import { product, optionalContext } from "../_shared/phase6.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req),
      input = await body(req),
      op = String(input.operation),
      ctx = optionalContext(input.context);
    let data: Record<string, unknown> = {};
    if (
      ![
        "client_save",
        "profile_save",
        "dashboard",
        "knowledge",
        "details",
        "triage_list",
        "triage_review",
        "chat_history",
      ].includes(op)
    )
      throw new HttpError(400, "Operação inválida.");
    if (op === "client_save") {
      const p = object(input.client),
        address = object(p.address_json),
        allowed = [
          "street",
          "number",
          "complement",
          "neighborhood",
          "city",
          "state",
          "cep",
        ];
      for (const [key, value] of Object.entries(address))
        if (
          !allowed.includes(key) ||
          typeof value !== "string" ||
          value.length > 300
        )
          throw new HttpError(400, "Endereço inválido.");
      const phone = String(p.phone ?? ""),
        email = String(p.email ?? "").trim();
      if (
        (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      )
        throw new HttpError(400, "Contato inválido.");
      data = {
        phone,
        email,
        address_json: address,
        expected_updated_at: p.expected_updated_at,
      };
    } else if (op === "profile_save") {
      const p = object(input.profile);
      data = {
        full_name: text(p.full_name, 160, "Nome"),
        oab_number: String(p.oab_number ?? "").trim(),
        oab_uf: String(p.oab_uf ?? ""),
        phone: String(p.phone ?? "").trim(),
        bio: String(p.bio ?? "").trim(),
        expected_updated_at: p.expected_updated_at,
      };
      if (
        String(data.oab_number).length > 30 ||
        String(data.bio).length > 3000 ||
        !/^$|^\+[1-9][0-9]{7,14}$/.test(String(data.phone))
      )
        throw new HttpError(
          400,
          "Perfil inválido; use telefone internacional, como +5513999999999.",
        );
    } else if (op === "triage_list") data = { offset: input.offset ?? 0 };
    else if (op === "triage_review")
      data = {
        id: uuid(input.id),
        status: input.status,
        expected_updated_at: input.expected_updated_at,
      };
    return response(await product(db, actor, op, ctx, data), 200, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
