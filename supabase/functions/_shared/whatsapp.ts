import { HttpError, object, text } from "./office.ts";
import { external } from "./phase5.ts";
export type Provider = "meta" | "evolution";
export function provider(): Provider {
  const value = Deno.env.get("WHATSAPP_PROVIDER") ?? "meta";
  if (value !== "meta" && value !== "evolution")
    throw new HttpError(503, "Provedor WhatsApp inválido.");
  return value;
}
export async function send(provider: Provider, phone: string, content: string) {
  if (provider === "meta") {
    const version = Deno.env.get("META_GRAPH_VERSION");
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const id = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (
      !version ||
      !/^v\d+\.\d+$/.test(version) ||
      !token ||
      !id ||
      !/^\d+$/.test(id)
    )
      throw new HttpError(503, "Meta Cloud API não configurada.");
    const r = await external(
      `https://graph.facebook.com/${version}/${id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone.slice(1),
          type: "text",
          text: { body: content, preview_url: false },
        }),
      },
    );
    const data = object(await r.json());
    const messages = data.messages as { id?: string }[] | undefined;
    return text(messages?.[0]?.id, 200, "Identificador do provedor");
  }
  const base = Deno.env.get("EVOLUTION_API_URL");
  const key = Deno.env.get("EVOLUTION_API_KEY");
  const instance = Deno.env.get("EVOLUTION_INSTANCE");
  if (!base || !key || !instance || !/^[a-zA-Z0-9_-]+$/.test(instance))
    throw new HttpError(503, "Evolution API não configurada.");
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(503, "URL Evolution inválida.");
  const r = await external(
    `${url.href.replace(/\/$/, "")}/message/sendText/${instance}`,
    {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ number: phone.slice(1), text: content }),
    },
  );
  const data = object(await r.json());
  return text(object(data.key).id, 200, "Identificador do provedor");
}
export interface Incoming {
  id: string;
  phone: string;
  name: string;
  content: string;
  time: string;
  media_id: string | null;
}
export function normalizeMeta(input: Record<string, unknown>) {
  if (input.object !== "whatsapp_business_account")
    throw new HttpError(400, "Evento Meta inválido.");
  const messages: Incoming[] = [];
  const statuses: { id: string; status: string }[] = [];
  for (const entry of (input.entry ?? []) as Record<string, unknown>[])
    for (const change of (entry.changes ?? []) as Record<string, unknown>[]) {
      const value = object(change.value);
      if (
        object(value.metadata).phone_number_id !==
        Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")
      )
        throw new HttpError(403, "Número do escritório divergente.");
      const contacts = (value.contacts ?? []) as {
        wa_id?: string;
        profile?: { name?: string };
      }[];
      for (const raw of (value.messages ?? []) as Record<string, unknown>[]) {
        const type = String(raw.type);
        const item = typeof raw[type] === "object" ? object(raw[type]) : {};
        const timestamp = Number(raw.timestamp) * 1000;
        if (!Number.isFinite(timestamp))
          throw new HttpError(400, "Data inválida.");
        messages.push({
          id: text(raw.id, 200, "Mensagem"),
          phone: "+" + text(raw.from, 15, "Telefone"),
          name: contacts.find((c) => c.wa_id === raw.from)?.profile?.name ?? "",
          content:
            type === "text"
              ? text(item.body, 30000, "Texto")
              : `[Mídia recebida: ${type}. Anexe o documento ao caso pelo fluxo privado.]`,
          time: new Date(timestamp).toISOString(),
          media_id: typeof item.id === "string" ? item.id : null,
        });
      }
      for (const s of (value.statuses ?? []) as {
        id: string;
        status: string;
      }[])
        statuses.push({ id: s.id, status: s.status });
    }
  return { messages, statuses };
}
export function normalizeEvolution(input: Record<string, unknown>) {
  if (input.instance !== Deno.env.get("EVOLUTION_INSTANCE"))
    throw new HttpError(403, "Instância divergente.");
  const messages: Incoming[] = [];
  const statuses: { id: string; status: string }[] = [];
  if (input.event !== "messages.upsert") return { messages, statuses };
  const data = object(input.data),
    key = object(data.key);
  if (key.fromMe === true) return { messages, statuses };
  const original = String(key.remoteJid ?? "");
  if (original.endsWith("@g.us") || original === "status@broadcast")
    return { messages, statuses };
  const remote = /^\d+@s\.whatsapp\.net$/.test(original)
    ? original
    : String(key.remoteJidAlt ?? "");
  if (!/^\d+@s\.whatsapp\.net$/.test(remote))
    throw new HttpError(
      400,
      "Contato sem telefone resolvido no provedor. Configure o mapeamento LID/telefone antes de confirmar o evento.",
    );
  const msg = object(data.message);
  const extended =
    typeof msg.extendedTextMessage === "object"
      ? object(msg.extendedTextMessage)
      : {};
  const content =
    typeof msg.conversation === "string"
      ? msg.conversation
      : typeof extended.text === "string"
        ? extended.text
        : "[Mídia recebida. Anexe o documento ao caso pelo fluxo privado.]";
  const rawTime =
    typeof data.messageTimestamp === "object"
      ? Number(object(data.messageTimestamp).low)
      : Number(data.messageTimestamp);
  if (!Number.isFinite(rawTime)) throw new HttpError(400, "Data inválida.");
  messages.push({
    id: text(key.id, 200, "Mensagem"),
    phone: "+" + remote.split("@")[0],
    name: typeof data.pushName === "string" ? data.pushName : "",
    content: text(content, 30000, "Texto"),
    time: new Date(rawTime * 1000).toISOString(),
    media_id: null,
  });
  return { messages, statuses };
}
