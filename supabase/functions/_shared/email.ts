import { HttpError } from "./office.ts";
import { external } from "./phase5.ts";
import { requireEnv } from "./phase6.ts";
export function emailConfig() {
  const provider = requireEnv("EMAIL_PROVIDER"),
    from = requireEnv("EMAIL_FROM");
  if (!/^[^\r\n<>]+@[^\r\n<>]+\.[^\r\n<>]+$/.test(from))
    throw new HttpError(503, "Remetente precisa ser endereço verificado.");
  if (provider === "resend") requireEnv("RESEND_API_KEY");
  else if (provider === "smtp") {
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"])
      requireEnv(key);
    if (!/^[a-z0-9.-]+$/i.test(requireEnv("SMTP_HOST")))
      throw new HttpError(503, "Servidor SMTP inválido.");
  } else throw new HttpError(503, "Provedor de e-mail inválido.");
  return { provider, from };
}
type Email = {
  id: string;
  recipient: string;
  subject: string;
  content: string;
};
// SMTPS explícito na porta 465; a plataforma bloqueia portas SMTP sem TLS.
async function smtp(from: string, email: Email) {
  const connection = await Deno.connectTls({
    hostname: requireEnv("SMTP_HOST"),
    port: 465,
  });
  const reader = connection.readable.getReader(),
    writer = connection.writable.getWriter();
  let buffer = "";
  const timer = setTimeout(() => {
    try {
      connection.close();
    } catch {
      /* já encerrado */
    }
  }, 15000);
  async function readReply(expected: number[]) {
    let lines = 0;
    while (true) {
      let end = buffer.indexOf("\r\n");
      while (end < 0) {
        const { value, done } = await reader.read();
        if (done) throw new HttpError(502, "SMTP encerrou a conexão.");
        buffer += new TextDecoder().decode(value);
        if (buffer.length > 65536)
          throw new HttpError(502, "Resposta SMTP inválida.");
        end = buffer.indexOf("\r\n");
      }
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (++lines > 100 || !/^\d{3}[- ]/.test(line))
        throw new HttpError(502, "Resposta SMTP inválida.");
      if (line[3] === " ") {
        if (!expected.includes(Number(line.slice(0, 3))))
          throw new HttpError(502, "SMTP recusou a mensagem.");
        return;
      }
    }
  }
  async function command(value: string, expected: number[]) {
    await writer.write(new TextEncoder().encode(value + "\r\n"));
    await readReply(expected);
  }
  try {
    await readReply([220]);
    await command("EHLO m14advocacia", [250]);
    await command("AUTH LOGIN", [334]);
    const b64 = (v: string) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(v)));
    await command(b64(requireEnv("SMTP_USER")), [334]);
    await command(b64(requireEnv("SMTP_PASSWORD")), [235]);
    if (/[\r\n<>]/.test(email.recipient))
      throw new HttpError(400, "Destinatário inválido.");
    await command(`MAIL FROM:<${from}>`, [250]);
    await command(`RCPT TO:<${email.recipient}>`, [250, 251]);
    await command("DATA", [354]);
    const content =
      b64(email.content)
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "";
    const message = `From: ${from}\r\nTo: ${email.recipient}\r\nSubject: =?UTF-8?B?${b64(email.subject)}?=\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${email.id}@${from.split("@")[1]}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${content}\r\n.`;
    await command(message, [250]);
    return email.id;
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
      writer.releaseLock();
      connection.close();
    } catch {
      /* conexão encerrada */
    }
  }
}
export async function sendEmail(email: Email) {
  const { provider, from } = emailConfig();
  if (provider === "smtp") return smtp(from, email);
  const result = await external("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.id,
    },
    body: JSON.stringify({
      from,
      to: [email.recipient],
      subject: email.subject,
      text: email.content,
    }),
  });
  const data = await result.json();
  if (typeof data.id !== "string" || !data.id)
    throw new HttpError(502, "Provedor não confirmou o envio.");
  return data.id;
}
