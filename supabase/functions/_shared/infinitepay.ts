import { HttpError, object, rpc, Service } from "./office.ts";
export function handle() {
  const value = Deno.env.get("INFINITEPAY_HANDLE") ?? "matheus-moraes-tsd";
  if (value !== "matheus-moraes-tsd")
    throw new HttpError(503, "Confira a conta InfinitePay configurada.");
  return value;
}
export function enabled() {
  if (Deno.env.get("INFINITEPAY_ENABLED") !== "true")
    throw new HttpError(503, "Integração InfinitePay ainda não habilitada.");
}
export async function provider(
  path: "links" | "payment_check",
  payload: unknown,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = Deno.env.get("INFINITEPAY_API_KEY");
  if (apiKey) headers["X-Api-Key"] = apiKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await fetch(`https://api.checkout.infinitepay.io/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "error",
    });
    if (!result.ok)
      throw new HttpError(
        502,
        "InfinitePay indisponível ou requisição recusada.",
      );
    return object(await result.json());
  } finally {
    clearTimeout(timer);
  }
}
export function checkoutUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 1024)
    throw new HttpError(502, "URL de checkout ausente.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "infinitepay.io" ||
      url.hostname.endsWith(".infinitepay.io")
    )
  )
    throw new HttpError(502, "URL de checkout inválida.");
  return url.href;
}
export async function confirm(
  db: Service,
  payment: Record<string, unknown>,
  transaction: string,
  slug: string,
) {
  const verified = await provider("payment_check", {
    handle: handle(),
    order_nsu: payment.id,
    transaction_nsu: transaction,
    slug,
  });
  if (verified.success !== true || verified.paid !== true)
    throw new HttpError(400, "Pagamento ainda não confirmado pelo provedor.");
  if (
    !Number.isSafeInteger(verified.amount) ||
    verified.amount !== Number(payment.amount_cents) ||
    !["pix", "credit_card"].includes(String(verified.capture_method))
  )
    throw new HttpError(409, "Valor ou método divergente da cobrança.");
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      order_nsu: payment.id,
      transaction_nsu: transaction,
      slug,
      ...verified,
    }),
  );
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return await rpc(db, "office_confirm_payment", {
    p_id: payment.id,
    p_transaction: transaction,
    p_slug: slug,
    p_amount: verified.amount,
    p_capture_method: verified.capture_method,
    p_payload_hash: hash,
  });
}
