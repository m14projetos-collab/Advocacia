import {
  HttpError,
  object,
  response,
  rpc,
  service,
} from "../_shared/office.ts";
import { bounded, enabled, equal, hmac } from "../_shared/phase5.ts";
import {
  provider,
  normalizeEvolution,
  normalizeMeta,
} from "../_shared/whatsapp.ts";
Deno.serve(async (req: Request) => {
  try {
    enabled("WHATSAPP_ENABLED");
    const url = new URL(req.url);
    if (req.method === "GET") {
      const token = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
      if (
        !token ||
        url.searchParams.get("hub.mode") !== "subscribe" ||
        !equal(url.searchParams.get("hub.verify_token") ?? "", token)
      )
        throw new HttpError(403, "Verificação recusada.");
      return new Response(url.searchParams.get("hub.challenge") ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const bytes = await bounded(req);
    const evolution = req.headers.get("x-m14-provider") === "evolution";
    if (provider() !== (evolution ? "evolution" : "meta"))
      throw new HttpError(403, "Provedor inativo.");
    if (evolution) {
      const timestamp = req.headers.get("x-m14-timestamp") ?? "";
      const secret = Deno.env.get("WHATSAPP_RELAY_SECRET");
      if (
        !secret ||
        secret.length < 32 ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      )
        throw new HttpError(403, "Relay inválido.");
      const signed = new TextEncoder().encode(
        timestamp + "." + new TextDecoder().decode(bytes),
      );
      if (
        !equal(
          req.headers.get("x-m14-signature") ?? "",
          await hmac(secret, signed),
        )
      )
        throw new HttpError(403, "Assinatura inválida.");
    } else {
      const secret = Deno.env.get("META_APP_SECRET");
      if (
        !secret ||
        !equal(
          req.headers.get("x-hub-signature-256") ?? "",
          "sha256=" + (await hmac(secret, bytes)),
        )
      )
        throw new HttpError(403, "Assinatura inválida.");
    }
    const input = object(JSON.parse(new TextDecoder().decode(bytes)));
    const normalized = evolution
      ? normalizeEvolution(input)
      : normalizeMeta(input);
    const db = service();
    for (const msg of normalized.messages)
      await rpc(db, "office_receive_whatsapp", {
        p_provider: evolution ? "evolution" : "meta",
        p_external_id: msg.id,
        p_phone: msg.phone,
        p_name: msg.name,
        p_content: msg.content,
        p_time: msg.time,
        p_media_id: msg.media_id,
      });
    for (const status of normalized.statuses)
      await rpc(db, "office_whatsapp_status", {
        p_provider: evolution ? "evolution" : "meta",
        p_external_id: status.id,
        p_status: status.status,
      });
    return response({ ok: true });
  } catch (error) {
    return response(
      { error: "Notificação recusada ou não processada." },
      error instanceof HttpError ? error.status : 503,
    );
  }
});
