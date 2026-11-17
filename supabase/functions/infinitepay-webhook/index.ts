import {
  body,
  HttpError,
  response,
  service,
  text,
  uuid,
} from "../_shared/office.ts";
import { confirm, enabled } from "../_shared/infinitepay.ts";
Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST")
      return response({ error: "Método não permitido." }, 405);
    enabled();
    const input = await body(req);
    // A URL simples webhook_url notifica aprovação. Outros eventos não têm semântica autenticada aqui.
    if (input.event && input.event !== "paid")
      return response({ ignored: true });
    const id = uuid(input.order_nsu);
    const transaction = text(input.transaction_nsu, 120, "Transação");
    const slug = text(input.invoice_slug ?? input.slug, 160, "Slug");
    const db = service();
    const { data: payment, error } = await db
      .from("payments")
      .select("id,amount_cents")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new HttpError(503, "Banco indisponível.");
    if (!payment) return response({ ignored: true });
    const result = await confirm(db, payment, transaction, slug);
    return response({ ok: true, ...result });
  } catch (error) {
    return response(
      { error: "Notificação não confirmada; nenhuma baixa foi realizada." },
      error instanceof HttpError && error.status < 500 ? 400 : 503,
    );
  }
});
