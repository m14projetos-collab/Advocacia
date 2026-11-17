import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  runtime,
  actor,
  caseId,
  clientId,
  requestId,
  cnj,
} from "./helpers/phase5-runtime.mjs";
const ctx = { case_id: caseId };
const mailEnv = {
  EMAIL_ENABLED: "true",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "office@example.test",
  RESEND_API_KEY: "test-resend-secret",
};
const baseDetails = {
  case: { id: caseId, title: "Caso de Teste" },
  client: {
    full_name: "Cliente do Cadastro",
    document_type: "cpf",
    document_number: "52998224725",
    address_json: { street: "Rua de Teste", city: "Santos" },
  },
  profile: {
    full_name: "Advogado do Perfil",
    oab_number: "123456",
    oab_uf: "SP",
  },
  kits: [],
};
const source = {
  id: "official-1",
  source_id: "stf",
  title: "Fonte STF",
  summary:
    "Trecho literal oficial para revisão da situação e análise individual do advogado.",
  official_url: "https://noticias.stf.jus.br/",
  fetched_at: "2026-11-17T00:00:00Z",
};
function rpcBase(name, args) {
  if (name === "office_phase6_action") {
    const op = args.p_action;
    if (op === "details") return { data: baseDetails, error: null };
    if (op === "knowledge")
      return {
        data: {
          sources: [
            {
              id: "stf",
              area: "geral",
              jurisdiction: "STF",
              official_url: source.official_url,
              title: source.title,
              enabled: true,
            },
          ],
          updates: [source],
        },
        error: null,
      };
    if (op === "chat_start")
      return { data: { generate: true, turn: { id: requestId } }, error: null };
    if (op === "chat_finish") return { data: args.p_data, error: null };
    if (op === "kit_save")
      return {
        data: { ...args.p_data, created_at: new Date().toISOString() },
        error: null,
      };
  }
  return undefined;
}
test("Fase 6: todas as rotas humanas negam anon, JWT inválido e inativo antes de side effects", async () => {
  for (const endpoint of [
    "product-hub",
    "initial-kit",
    "email-send",
    "sync-legal-updates",
    "legal-copilot",
  ])
    for (const mode of ["anon", "invalid", "inactive"]) {
      const app = runtime(endpoint, { [mode]: true });
      const r = await app.run(
        { context: ctx, id: requestId },
        { auth: mode !== "anon" },
      );
      assert.equal(r.status, mode === "inactive" ? 403 : 401, endpoint);
      assert.equal(app.calls.rpc.length, 0);
      assert.equal(app.calls.fetch.length, 0);
      assert.equal(app.calls.model.length, 0);
    }
});
test("perfil encaminha somente campos permitidos, ator de JWT e telefone validado", async () => {
  const app = runtime("product-hub", {
    rpc: (name, args) => ({ data: args, error: null }),
  });
  const r = await app.run({
    operation: "profile_save",
    actor: "forged",
    profile: {
      full_name: "Equipe Atualizada",
      role: "admin",
      is_active: false,
      phone: "+5513999999999",
      oab_uf: "SP",
      expected_updated_at: "2026-11-17",
    },
  });
  assert.equal(r.status, 200);
  const call = app.calls.rpc[0].args;
  assert.equal(call.p_actor, actor);
  assert.equal(call.p_data.role, undefined);
  assert.equal(call.p_data.is_active, undefined);
  assert.equal(
    (
      await app.run({
        operation: "profile_save",
        profile: { full_name: "Teste", phone: "bad" },
      })
    ).status,
    400,
  );
});
test("e-mail usa outbox persistida e Resend com idempotência; replay não chama provedor", async () => {
  const app = runtime("email-send", {
    env: mailEnv,
    rpc: (name, args) => {
      if (args.p_action === "email_prepare")
        return {
          data: {
            send: true,
            email: {
              id: requestId,
              recipient: "canonical@example.test",
              subject: "Confirmação",
              content: "Conteúdo do banco",
            },
          },
          error: null,
        };
      if (args.p_action === "email_finish")
        return { data: { status: "sent", ...args.p_data }, error: null };
    },
    fetch: async () => Response.json({ id: "provider-id" }),
  });
  const r = await app.run({
    context: ctx,
    id: requestId,
    template: "appointment",
    reviewed: true,
    recipient: "forged@example.test",
  });
  assert.equal(r.status, 200);
  const outbound = app.calls.fetch[0];
  assert.equal(outbound.url, "https://api.resend.com/emails");
  assert.equal(outbound.init.headers["Idempotency-Key"], requestId);
  assert.deepEqual(JSON.parse(outbound.init.body).to, [
    "canonical@example.test",
  ]);
  const replay = runtime("email-send", {
    env: mailEnv,
    rpc: () => ({
      data: { send: false, email: { status: "unknown" } },
      error: null,
    }),
  });
  assert.equal(
    (
      await replay.run({
        context: ctx,
        id: requestId,
        template: "appointment",
        reviewed: true,
      })
    ).status,
    200,
  );
  assert.equal(replay.calls.fetch.length, 0);
  const failed = runtime("email-send", {
    env: mailEnv,
    rpc: appArgs,
    fetchThrows: true,
  });
  function appArgs(name, args) {
    return {
      data:
        args.p_action === "email_prepare"
          ? {
              send: true,
              email: {
                id: requestId,
                recipient: "canonical@example.test",
                subject: "Teste",
                content: "Texto",
              },
            }
          : { status: "unknown" },
      error: null,
    };
  }
  const result = await failed.run({
    context: ctx,
    id: requestId,
    template: "summary",
    reviewed: true,
  });
  assert.equal((await result.json()).pending, true);
  assert.equal(failed.calls.rpc.at(-1).args.p_data.external_id, null);
});
test("adaptador SMTPS usa TLS 465, servidor fixo, autenticação e texto MIME sem injeção", async () => {
  const sent = [];
  let controller,
    position = 0;
  const replies = [
    "250 SMTP\r\n",
    "334 user\r\n",
    "334 pass\r\n",
    "235 ok\r\n",
    "250 ok\r\n",
    "250 ok\r\n",
    "354 data\r\n",
    "250 accepted\r\n",
  ];
  const connection = {
    readable: new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode("220 ready\r\n"));
      },
    }),
    writable: new WritableStream({
      write(data) {
        sent.push(new TextDecoder().decode(data));
        controller.enqueue(new TextEncoder().encode(replies[position++]));
      },
    }),
    close() {},
  };
  const app = runtime("email-send", {
    env: {
      ...mailEnv,
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "test-user",
      SMTP_PASSWORD: "test-pass",
    },
    connectTls: async (input) => {
      assert.equal(input.hostname, "smtp.example.test");
      assert.equal(input.port, 465);
      return connection;
    },
    rpc: (name, args) => ({
      data:
        args.p_action === "email_prepare"
          ? {
              send: true,
              email: {
                id: requestId,
                recipient: "canonical@example.test",
                subject: "Título",
                content: "Texto em português",
              },
            }
          : { status: "sent" },
      error: null,
    }),
  });
  const r = await app.run({
    context: ctx,
    id: requestId,
    template: "summary",
    reviewed: true,
  });
  assert.equal(r.status, 200);
  assert.ok(sent.some((s) => s.startsWith("AUTH LOGIN")));
  assert.match(sent.at(-1), /Content-Transfer-Encoding: base64/);
  assert.equal(app.calls.fetch.length, 0);
});
test("kit usa cliente e advogado canônicos, três minutas e nenhuma assinatura presumida", async () => {
  const app = runtime("initial-kit", { rpc: rpcBase });
  const r = await app.run({
    context: ctx,
    id: requestId,
    client_name: "forged",
    fields: {
      qualification: "brasileiro, profissão informada",
      scope: "Atuação no caso",
      fees: "Condições ajustadas",
    },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.documents.length, 3);
  assert.match(data.documents[0].content, /Cliente do Cadastro/);
  assert.match(data.documents[0].content, /OAB\/SP 123456/);
  assert.match(data.documents[0].content, /não são incluídos automaticamente/);
  assert.doesNotMatch(JSON.stringify(data), /forged/);
  assert.equal(app.calls.fetch.length, 0);
});
async function relayRun(
  app,
  payload,
  signature = true,
  stamp = String(Math.floor(Date.now() / 1000)),
) {
  const raw = JSON.stringify(payload),
    hash = createHmac("sha256", "r".repeat(40))
      .update(stamp + "." + raw)
      .digest("hex");
  return app.run(raw, {
    auth: false,
    headers: {
      "x-email-timestamp": stamp,
      "x-email-signature": signature ? "sha256=" + hash : "bad",
    },
  });
}
test("recepção relay exige HMAC/timestamp, extrai CNJ válido e registra sugestão sem vincular", async () => {
  const env = {
    EMAIL_INBOUND_ENABLED: "true",
    EMAIL_INBOUND_PROVIDER: "relay",
    EMAIL_RELAY_SECRET: "r".repeat(40),
    EMAIL_INBOUND_TO: "triage@example.test",
    LEGAL_AI_ENABLED: "false",
  };
  const payload = {
    id: "inbound-1",
    email: {
      to: ["triage@example.test"],
      from: "sender@example.test",
      subject: "Intimação",
      text: "Número CNJ " + cnj(),
    },
  };
  const app = runtime("email-inbound-webhook", {
    env,
    rpc: (name, args) => ({ data: args, error: null }),
  });
  assert.equal((await relayRun(app, payload, false)).status, 401);
  assert.equal(app.calls.rpc.length, 0);
  assert.equal((await relayRun(app, payload, true, "1")).status, 401);
  const result = await relayRun(app, payload);
  assert.equal(result.status, 200);
  const args = app.calls.rpc[0].args;
  assert.equal(args.p_data.priority, "prazo");
  assert.equal(args.p_data.classification_method, "rules");
  assert.deepEqual([...args.p_data.cnj_numbers_json], [cnj()]);
  assert.equal(args.p_data.case_id, undefined);
  const wrong = runtime("email-inbound-webhook", { env });
  payload.email.to = ["other@example.test"];
  assert.equal((await relayRun(wrong, payload)).status, 403);
});
test("Resend valida Svix, consulta corpo em URL fixa e respeita dedupe antes da IA", async () => {
  const secret = Buffer.from("secret-for-svix-test"),
    stamp = String(Math.floor(Date.now() / 1000)),
    eventId = "evt_123",
    raw = JSON.stringify({
      type: "email.received",
      data: { email_id: requestId },
    }),
    signature = createHmac("sha256", secret)
      .update(`${eventId}.${stamp}.${raw}`)
      .digest("base64");
  const app = runtime("email-inbound-webhook", {
    env: {
      EMAIL_INBOUND_ENABLED: "true",
      EMAIL_INBOUND_PROVIDER: "resend",
      RESEND_WEBHOOK_SECRET: "whsec_" + secret.toString("base64"),
      RESEND_API_KEY: "resend-test",
      EMAIL_INBOUND_TO: "triage@example.test",
    },
    existingEmail: { id: requestId },
    fetch: async () =>
      Response.json({
        to: ["triage@example.test"],
        from: "sender@example.test",
        subject: "Teste",
        text: "Texto",
      }),
  });
  const r = await app.run(raw, {
    auth: false,
    headers: {
      "svix-id": eventId,
      "svix-timestamp": stamp,
      "svix-signature": "v1," + signature,
    },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).duplicate, true);
  assert.equal(app.calls.model.length, 0);
  assert.equal(
    app.calls.fetch[0].url,
    `https://api.resend.com/emails/receiving/${requestId}`,
  );
});
test("atualização é admin-only, URLs são allowlist e falha externa preserva histórico", async () => {
  const denied = runtime("sync-legal-updates", {
    rpc: (name, args) =>
      args.p_action === "sync_reserve"
        ? {
            data: null,
            error: { code: "42501", message: "Somente administrador." },
          }
        : undefined,
  });
  assert.equal((await denied.run({})).status, 403);
  assert.equal(denied.calls.fetch.length, 0);
  const app = runtime("sync-legal-updates", {
    rpc: rpcBase,
    fetch: async () =>
      new Response(
        "<main>Trecho oficial para consulta. ".repeat(30) + "</main>",
      ),
  });
  assert.equal((await app.run({})).status, 200);
  assert.equal(app.calls.fetch[0].url, "https://noticias.stf.jus.br/");
  assert.equal(
    app.calls.rpc.some(
      (c) =>
        c.args.p_action === "sync_result" &&
        c.args.p_data.content_hash?.length === 64,
    ),
    true,
  );
  const failed = runtime("sync-legal-updates", {
    rpc: rpcBase,
    fetchThrows: true,
  });
  assert.equal((await failed.run({})).status, 200);
  assert.ok(
    failed.calls.rpc.find((c) => c.args.p_action === "sync_result").args.p_data
      .error,
  );
});
test("copiloto rejeita citação inventada, aceita só trecho literal e preserva URL oficial do banco", async () => {
  const good = runtime("legal-copilot", {
    rpc: rpcBase,
    aiText: JSON.stringify({
      passages: [{ source_id: source.id, quote: source.summary }],
    }),
  });
  const r = await good.run({
    context: ctx,
    id: requestId,
    question: "Quais subsídios oficiais estão disponíveis?",
    authorized: true,
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.citations_json[0].url, source.official_url);
  assert.match(data.answer, /REVISÃO HUMANA/);
  assert.equal(good.calls.fetch.length, 0);
  const bad = runtime("legal-copilot", {
    rpc: rpcBase,
    aiText: JSON.stringify({
      passages: [
        {
          source_id: source.id,
          quote: "Súmula inventada com regra jurídica inexistente.",
        },
      ],
    }),
  });
  assert.equal(
    (
      await bad.run({
        id: requestId,
        question: "Quais regras?",
        authorized: true,
      })
    ).status,
    502,
  );
  assert.equal(bad.calls.rpc.at(-1).args.p_data.answer, undefined);
  const noConsent = runtime("legal-copilot", { rpc: rpcBase });
  assert.equal(
    (await noConsent.run({ id: requestId, question: "Teste" })).status,
    400,
  );
  assert.equal(noConsent.calls.model.length, 0);
});
