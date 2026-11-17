import {
  body,
  cors,
  failure,
  HttpError,
  member,
  object,
  response,
  rpc,
  text,
  uuid,
} from "../_shared/office.ts";
import {
  checkoutUrl,
  confirm,
  enabled,
  handle,
  provider,
} from "../_shared/infinitepay.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    enabled();
    handle();
    const input = await body(req);
    const id = uuid(input.id);
    if (input.operation === "verify") {
      const { data: payment, error } = await db
        .from("payments")
        .select("id,amount_cents")
        .eq("id", id)
        .maybeSingle();
      if (error || !payment)
        throw new HttpError(404, "Cobrança não encontrada.");
      const result = await confirm(
        db,
        payment,
        text(input.transaction_nsu, 120, "Transação"),
        text(input.slug, 160, "Slug"),
      );
      return response(result, 200, headers);
    }
    if (input.operation && input.operation !== "create")
      throw new HttpError(400, "Operação inválida.");
    const data = object(input.payment);
    if (
      !Number.isSafeInteger(data.amount_cents) ||
      Number(data.amount_cents) < 100
    )
      throw new HttpError(400, "Informe valor em centavos, mínimo de R$ 1,00.");
    const origin = new URL(Deno.env.get("PUBLIC_APP_URL") ?? "");
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new HttpError(503, "URL pública do portal não configurada.");
    const prepared = object(
      await rpc(db, "office_prepare_checkout", {
        p_actor: actor,
        p_id: id,
        p_data: {
          client_id: uuid(data.client_id),
          case_id: data.case_id ? uuid(data.case_id) : null,
          appointment_id: data.appointment_id
            ? uuid(data.appointment_id)
            : null,
          description: text(data.description, 500, "Descrição"),
          fee_type: text(data.fee_type, 20, "Tipo de honorário"),
          amount_cents: data.amount_cents,
          due_date: data.due_date || null,
        },
      }),
    );
    const payment = object(prepared.payment);
    if (prepared.create_link !== true)
      return response(
        { payment, pending: !payment.checkout_url },
        payment.checkout_url ? 200 : 202,
        headers,
      );
    try {
      const result = await provider("links", {
        handle: handle(),
        order_nsu: payment.id,
        items: [
          {
            quantity: 1,
            price: Number(payment.amount_cents),
            description:
              payment.fee_type === "consulta"
                ? "Consulta jurídica"
                : "Honorários advocatícios",
          },
        ],
        redirect_url: new URL("/pagamento/retorno", origin).href,
        webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/infinitepay-webhook`,
        ...(Deno.env.get("INFINITEPAY_API_KEY")
          ? { options: { single_payment: true } }
          : {}),
      });
      const saved = await rpc(db, "office_store_checkout", {
        p_actor: actor,
        p_id: id,
        p_url: checkoutUrl(result.url),
      });
      return response({ payment: saved }, 201, headers);
    } catch {
      // Não recriar automaticamente: timeout não comprova que o provedor deixou de gerar o link.
      await rpc(db, "office_store_checkout", {
        p_actor: actor,
        p_id: id,
        p_url: null,
      });
      return response(
        {
          error:
            "Não foi possível obter o link. A cobrança foi preservada para conferência, sem repetir a criação.",
          payment_id: id,
        },
        502,
        headers,
      );
    }
  } catch (error) {
    return failure(error, headers);
  }
});
