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
import { action, context, enabled } from "../_shared/phase5.ts";
import { provider, send } from "../_shared/whatsapp.ts";
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
    if (input.operation === "call")
      return response(
        await action(db, actor, "call", ctx, {
          id: uuid(input.id),
          notes: text(input.notes, 3000, "Registro"),
          direction: input.direction,
          outcome: input.outcome,
          duration_seconds: input.duration_seconds ?? null,
        }),
        200,
        headers,
      );
    enabled("WHATSAPP_ENABLED");
    const name = provider();
    const prepared = await action(db, actor, "outbox", ctx, {
      id: uuid(input.id),
      content: text(input.content, 4000, "Resposta"),
      provider: name,
      reviewed: input.reviewed === true,
    });
    if (prepared.send !== true)
      return response(
        {
          ...prepared,
          pending:
            prepared.message.send_state === "pending" ||
            prepared.message.send_state === "unknown",
        },
        200,
        headers,
      );
    try {
      const externalId = await send(
        name,
        prepared.phone,
        prepared.message.content,
      );
      return response(
        await action(db, actor, "sent", ctx, {
          id: input.id,
          external_id: externalId,
        }),
        200,
        headers,
      );
    } catch {
      await action(db, actor, "sent", ctx, { id: input.id });
      return response(
        {
          error:
            "Envio sem confirmação. Confira o provedor antes de reenviar; o histórico foi preservado.",
        },
        502,
        headers,
      );
    }
  } catch (error) {
    return failure(error, headers);
  }
});
