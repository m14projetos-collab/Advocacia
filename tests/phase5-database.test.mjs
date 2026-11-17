import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
let n = 0;
const id = () => `50000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
const staff = id(),
  admin = id(),
  inactive = id(),
  client = id(),
  otherClient = id(),
  caseId = id();
const phone = "+5513999999999";
async function role(name, user = "") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${name}`);
}
async function action(op, ctx = {}, data = {}, actor = staff) {
  return (
    await db.query("SELECT public.office_phase5_action($1,$2,$3,$4) result", [
      actor,
      op,
      JSON.stringify(ctx),
      JSON.stringify(data),
    ])
  ).rows[0].result;
}
async function receive(external, remote = phone) {
  return (
    await db.query(
      "SELECT public.office_receive_whatsapp($1,$2,$3,$4,$5,$6,NULL) result",
      [
        "meta",
        external,
        remote,
        "Contato Teste",
        "Mensagem recebida de teste",
        new Date().toISOString(),
      ],
    )
  ).rows[0].result;
}
async function count(table) {
  return Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
}

test("Fase 5: vínculos, perfis, Storage privado, outbox e IA", async (t) => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;GRANT ALL ON storage.objects TO anon,authenticated,service_role;
 CREATE POLICY unsafe_global ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);`);
  for (const phase of [
    "phase1-schema.sql",
    "phase2-intake.sql",
    "phase3-crm.sql",
    "phase4-agenda-finance.sql",
    "phase5-whatsapp-ai.sql",
  ])
    await db.exec(await readFile(`supabase/review/${phase}`, "utf8"));
  await db.query("INSERT INTO auth.users VALUES($1),($2),($3)", [
    staff,
    admin,
    inactive,
  ]);
  await db.query(
    "INSERT INTO public.profiles(id,full_name,role,is_active) VALUES($1,'Equipe Teste','staff',true),($2,'Admin Teste','admin',true),($3,'Inativo Teste','staff',false)",
    [staff, admin, inactive],
  );
  await db.query(
    "INSERT INTO public.clients(id,full_name,phone)VALUES($1,'Cliente Principal',$3),($2,'Outro Cliente','+5513888888888')",
    [client, otherClient, phone],
  );
  await db.query(
    "INSERT INTO public.cases(id,client_id,title,practice_area)VALUES($1,$2,'Caso de Teste','contratos')",
    [caseId, client],
  );
  await t.test(
    "anon/staff não executam RPCs de serviço nem escrevem tabelas sensíveis",
    async () => {
      for (const who of ["anon", "authenticated"]) {
        await role(who, staff);
        await assert.rejects(
          action("snapshot", { client_id: client }),
          /permission denied/,
        );
        await assert.rejects(receive("invalid"), /permission denied/);
        for (const table of [
          "whatsapp_messages",
          "agent_config",
          "case_documents",
          "call_logs",
          "ai_runs",
        ])
          await assert.rejects(
            db.query(`INSERT INTO public.${table}(id)VALUES($1)`, [
              table === "agent_config" ? 1 : id(),
            ]),
            /permission denied/,
          );
      }
      await role("service_role");
      await assert.rejects(
        action("snapshot", { client_id: client }, {}, inactive),
        /Membro ativo/,
      );
    },
  );
  let known, unknown;
  await t.test(
    "webhook deduplica no cliente e cria lead para novo número sem inventar consentimento",
    async () => {
      known = await receive("inbound-1");
      assert.equal(known.client_id, client);
      assert.equal(known.lead_id, null);
      assert.equal((await receive("inbound-1")).duplicate, true);
      assert.equal(await count("public.whatsapp_messages"), 1);
      unknown = await receive("inbound-new", "+5513777777777");
      assert.ok(unknown.lead_id);
      const lead = (
        await db.query("SELECT * FROM public.leads_intake WHERE id=$1", [
          unknown.lead_id,
        ])
      ).rows[0];
      assert.equal(lead.lgpd_consent_at, null);
      assert.equal(lead.source, "whatsapp");
      assert.equal(
        (
          await db.query(
            "SELECT lead_id FROM public.whatsapp_messages WHERE id=$1",
            [unknown.id],
          )
        ).rows[0].lead_id,
        unknown.lead_id,
      );
    },
  );
  await t.test(
    "cadastro ambíguo não escolhe um cliente pelo telefone compartilhado",
    async () => {
      await role("postgres");
      await db.query("UPDATE public.clients SET phone=$1 WHERE id=$2", [
        "+5513888888888",
        client,
      ]);
      await role("service_role");
      const result = await receive("ambiguous", "+5513888888888");
      assert.ok(result.lead_id);
      assert.equal(result.client_id, null);
      assert.equal(
        (
          await db.query(
            "SELECT identity_review_required FROM public.leads_intake WHERE id=$1",
            [result.lead_id],
          )
        ).rows[0].identity_review_required,
        true,
      );
      await role("postgres");
      await db.query("UPDATE public.clients SET phone=$1 WHERE id=$2", [
        phone,
        client,
      ]);
      await role("service_role");
    },
  );
  await t.test(
    "snapshot não aceita vínculos divergentes; mensagem é vinculável somente ao mesmo cliente",
    async () => {
      await assert.rejects(
        action("snapshot", { case_id: caseId, client_id: otherClient }),
        /outro cliente/,
      );
      await action("message_case", { case_id: caseId }, { id: known.id });
      const snapshot = await action("snapshot", { case_id: caseId });
      assert.equal(snapshot.messages[0].case_id, caseId);
      await assert.rejects(
        action("message_case", { case_id: caseId }, { id: unknown.id }),
        /outro cliente/,
      );
    },
  );
  await t.test(
    "outbox exige revisão e janela do mesmo número; replay não envia novamente",
    async () => {
      const request = id();
      await assert.rejects(
        action(
          "outbox",
          { client_id: client },
          {
            id: request,
            content: "Resposta",
            provider: "meta",
            reviewed: false,
          },
        ),
        /Revise/,
      );
      const result = await action(
        "outbox",
        { client_id: client },
        { id: request, content: "Resposta", provider: "meta", reviewed: true },
      );
      assert.equal(result.send, true);
      assert.equal(
        (
          await action(
            "outbox",
            { client_id: client },
            {
              id: request,
              content: "Resposta",
              provider: "meta",
              reviewed: true,
            },
          )
        ).send,
        false,
      );
      await assert.rejects(
        action(
          "outbox",
          { client_id: client },
          {
            id: request,
            content: "Outro texto",
            provider: "meta",
            reviewed: true,
          },
        ),
        /outro contexto/,
      );
      await action("sent", { client_id: client }, { id: request });
      assert.equal(
        (
          await db.query(
            "SELECT send_state FROM public.whatsapp_messages WHERE request_id=$1",
            [request],
          )
        ).rows[0].send_state,
        "unknown",
      );
      await assert.rejects(
        action(
          "outbox",
          { client_id: otherClient },
          { id: id(), content: "Resposta", provider: "meta", reviewed: true },
        ),
        /Janela/,
      );
    },
  );
  await t.test(
    "conversão Fase 3 leva mensagens, chamadas e novos eventos ao cliente correto",
    async () => {
      await action(
        "call",
        { lead_id: unknown.lead_id },
        {
          id: id(),
          direction: "outbound",
          outcome: "atendida",
          notes: "Ligação de teste",
          duration_seconds: 60,
        },
      );
      await role("authenticated", staff);
      const args = [
        unknown.lead_id,
        "Contato Convertido",
        "cpf",
        "52998224725",
        "Novo caso",
        "{}",
        "",
        "cpf",
        "",
      ];
      const review = (
        await db.query(
          "SELECT public.review_lead_conversion($1,$2,$3,$4,$5,$6,$7,$8,$9) result",
          args,
        )
      ).rows[0].result;
      const converted = (
        await db.query(
          "SELECT public.convert_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result",
          [...args, review.token],
        )
      ).rows[0].result;
      await role("service_role");
      const next = await receive("after-conversion", "+5513777777777");
      assert.equal(next.client_id, converted.client_id);
      const snapshot = await action("snapshot", { case_id: converted.case_id });
      assert.equal(snapshot.calls[0].client_id, converted.client_id);
      assert.equal(snapshot.calls[0].case_id, converted.case_id);
      assert.ok(snapshot.messages.some((m) => m.case_id === converted.case_id));
    },
  );
  let docId;
  await t.test(
    "bucket é privado e política restritiva nega acesso direto mesmo com política global permissiva",
    async () => {
      await role("postgres");
      assert.equal(
        (
          await db.query(
            "SELECT public FROM storage.buckets WHERE id='case-files'",
          )
        ).rows[0].public,
        false,
      );
      await db.exec(
        "INSERT INTO storage.objects(bucket_id,name)VALUES('case-files','private.pdf'),('other','public.txt')",
      );
      await role("authenticated", staff);
      assert.equal(await count("storage.objects"), 1);
      await assert.rejects(
        db.exec(
          "INSERT INTO storage.objects(bucket_id,name)VALUES('case-files','attack.pdf')",
        ),
        /row-level security/,
      );
      await role("service_role");
      docId = id();
      await action(
        "file_add",
        { case_id: caseId },
        {
          id: docId,
          storage_path: caseId + "/" + docId + ".pdf",
          original_name: "arquivo.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          sha256: "a".repeat(64),
        },
      );
      await assert.rejects(
        action(
          "file_access",
          { client_id: client },
          { id: docId, purpose: "download" },
        ),
        /no rows/,
      );
      assert.equal(
        (
          await action(
            "file_access",
            { case_id: caseId },
            { id: docId, purpose: "download" },
          )
        ).id,
        docId,
      );
      assert.equal(await count("public.document_access_logs"), 1);
    },
  );
  await t.test(
    "staff não altera configuração; admin preserva trava ética e controle de versão",
    async () => {
      await assert.rejects(action("config_get", {}), /administrador/);
      const config = await action("config_get", {}, {}, admin);
      await assert.rejects(
        action(
          "config_save",
          {},
          {
            ...config,
            expected_updated_at: config.updated_at,
            oab_guardrails_enabled: false,
          },
          admin,
        ),
        /trava OAB/,
      );
      const saved = await action(
        "config_save",
        {},
        {
          ...config,
          expected_updated_at: config.updated_at,
          tone_examples_json: [
            { input: "Exemplo real", output: "Resposta revisada" },
          ],
          document_ai_enabled: true,
        },
        admin,
      );
      assert.equal(saved.oab_guardrails_enabled, true);
    },
  );
  await t.test(
    "IA é vinculada, rascunhos precisam de aprovação e resumo/pauta não são públicos",
    async () => {
      await assert.rejects(
        action(
          "ai_start",
          { client_id: client },
          { id: id(), task: "summary", model: "test/model" },
        ),
        /exigem caso/,
      );
      const runId = id();
      assert.equal(
        (
          await action(
            "ai_start",
            { case_id: caseId },
            {
              id: runId,
              task: "summary",
              model: "test/model",
              document_id: docId,
            },
          )
        ).generate,
        true,
      );
      assert.equal(
        (
          await action(
            "ai_start",
            { case_id: caseId },
            {
              id: runId,
              task: "summary",
              model: "test/model",
              document_id: docId,
            },
          )
        ).generate,
        false,
      );
      await assert.rejects(
        action(
          "ai_start",
          { client_id: otherClient },
          { id: runId, task: "summary", model: "test/model" },
        ),
        /outro contexto/,
      );
      await action(
        "ai_finish",
        { case_id: caseId },
        { id: runId, content: "Rascunho de teste" },
      );
      await assert.rejects(
        action(
          "ai_approve",
          { case_id: caseId },
          { id: runId, content: "Resumo revisado", reviewed: false },
        ),
        /Revisão/,
      );
      await action(
        "ai_approve",
        { case_id: caseId },
        { id: runId, content: "Resumo revisado", reviewed: true },
      );
      assert.equal(
        (
          await db.query("SELECT ai_summary FROM public.cases WHERE id=$1", [
            caseId,
          ])
        ).rows[0].ai_summary,
        "Resumo revisado",
      );
    },
  );
  await t.test(
    "staff/admin ativos leem o necessário; inativo/anon não leem dados; script é reaplicável",
    async () => {
      for (const who of [staff, admin]) {
        await role("authenticated", who);
        assert.ok((await count("public.whatsapp_messages")) > 0);
        assert.ok((await count("public.call_logs")) > 0);
      }
      await role("authenticated", staff);
      assert.equal(await count("public.agent_config"), 0);
      assert.equal(await count("public.document_access_logs"), 0);
      await role("authenticated", inactive);
      for (const table of [
        "whatsapp_messages",
        "case_documents",
        "call_logs",
        "ai_runs",
      ])
        assert.equal(await count("public." + table), 0);
      await role("anon");
      await assert.rejects(
        db.exec("SELECT * FROM public.whatsapp_messages"),
        /permission denied/,
      );
      await role("postgres");
      const before = await count("public.whatsapp_messages");
      await db.exec(
        await readFile("supabase/review/phase5-whatsapp-ai.sql", "utf8"),
      );
      assert.equal(await count("public.whatsapp_messages"), before);
    },
  );
  await db.close();
});
