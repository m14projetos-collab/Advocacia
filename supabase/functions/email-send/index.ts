import {
  body,
  cors,
  failure,
  HttpError,
  member,
  response,
  uuid,
} from "../_shared/office.ts";
import { context, enabled } from "../_shared/phase5.ts";
import { product } from "../_shared/phase6.ts";
import { emailConfig, sendEmail } from "../_shared/email.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    const input = await body(req),
      ctx = context(input.context);
    if (input.operation === "preview")
      return response(
        await product(db, actor, "email_preview", ctx, {
          template: input.template,
          reference_id: input.reference_id ? uuid(input.reference_id) : null,
        }),
        200,
        headers,
      );
    enabled("EMAIL_ENABLED");
    const id = uuid(input.id),
      { provider } = emailConfig();
    const prepared = await product(db, actor, "email_prepare", ctx, {
      id,
      template: input.template,
      reference_id: input.reference_id ? uuid(input.reference_id) : null,
      reviewed: input.reviewed === true,
      preview_token: input.preview_token,
      provider,
    });
    if (!prepared.send)
      return response(
        { email: prepared.email, pending: prepared.email.status !== "sent" },
        200,
        headers,
      );
    let externalId: string | null = null;
    try {
      externalId = await sendEmail(prepared.email);
    } catch {
      /* incerto: preservar outbox sem reenvio automático */
    }
    const email = await product(db, actor, "email_finish", ctx, {
      id,
      external_id: externalId,
    });
    return response({ email, pending: email.status !== "sent" }, 200, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
