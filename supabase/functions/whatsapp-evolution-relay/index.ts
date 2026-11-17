// Evolution: autenticação de ingresso por header configurado; HMAC interno sobre o corpo.
// Não afirma existir assinatura HMAC nativa na versão do Evolution instalada.
import { HttpError, response } from "../_shared/office.ts";
import { bounded, enabled, equal, external, hmac } from "../_shared/phase5.ts";
Deno.serve(async (req: Request) => {
  try {
    enabled("WHATSAPP_ENABLED");
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const ingress = Deno.env.get("EVOLUTION_WEBHOOK_TOKEN"),
      secret = Deno.env.get("WHATSAPP_RELAY_SECRET"),
      base = Deno.env.get("SUPABASE_URL");
    if (
      !ingress ||
      ingress.length < 32 ||
      !secret ||
      secret.length < 32 ||
      !base ||
      !equal(req.headers.get("authorization") ?? "", `Bearer ${ingress}`)
    )
      throw new HttpError(403, "Ingresso recusado.");
    const bytes = await bounded(req);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await hmac(
      secret,
      new TextEncoder().encode(
        timestamp + "." + new TextDecoder().decode(bytes),
      ),
    );
    await external(`${base}/functions/v1/whatsapp-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-m14-provider": "evolution",
        "x-m14-timestamp": timestamp,
        "x-m14-signature": signature,
      },
      body: bytes,
    });
    return response({ ok: true });
  } catch (error) {
    return response(
      { error: "Evento não encaminhado." },
      error instanceof HttpError ? error.status : 503,
    );
  }
});
