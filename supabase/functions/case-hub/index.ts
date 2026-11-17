import {
  body,
  cors,
  failure,
  HttpError,
  member,
  response,
  text,
  uuid,
} from "../_shared/office.ts";
import { validCnj } from "../_shared/cnj.ts";
import { action, context } from "../_shared/phase5.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    const input = await body(req);
    const ctx = context(input.context);
    const op = input.operation ?? "snapshot";
    if (op === "snapshot")
      return response(
        await action(db, actor, "snapshot", ctx, { offset: input.offset ?? 0 }),
        200,
        headers,
      );
    if (op === "message_case")
      return response(
        await action(db, actor, "message_case", ctx, { id: uuid(input.id) }),
        200,
        headers,
      );
    if (op === "case_update") {
      const number =
        typeof input.cnj_number === "string"
          ? input.cnj_number.replace(/\D/g, "")
          : "";
      if (number) validCnj(number);
      if (typeof input.is_confidential !== "boolean")
        throw new HttpError(400, "Informe a classificação de sigilo.");
      return response(
        await action(db, actor, "case_update", ctx, {
          cnj_number: number,
          is_confidential: input.is_confidential,
          expected_updated_at: text(input.expected_updated_at, 40, "Versão"),
        }),
        200,
        headers,
      );
    }
    throw new HttpError(400, "Operação inválida.");
  } catch (error) {
    return failure(error, headers);
  }
});
