import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
let sequence = 0;
const id = () =>
  `60000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`;
const admin = id(),
  staff = id(),
  inactive = id(),
  client = id(),
  other = id(),
  lead = id(),
  caseId = id();
async function role(name, user = "") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${name}`);
}
async function action(op, ctx = {}, data = {}, actor = staff) {
  return (
    await db.query("SELECT public.office_phase6_action($1,$2,$3,$4) result", [
      actor,
      op,
      JSON.stringify(ctx),
      JSON.stringify(data),
    ])
  ).rows[0].result;
}
const query = (sql, args = []) => db.query(sql, args);
test("Fase 6: RLS, perfil próprio, eventos reais, e-mail, kit e base oficial", async (t) => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
 CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;GRANT ALL ON storage.objects TO anon,authenticated,service_role;`);
  for (const phase of [
    "phase1-schema",
    "phase2-intake",
    "phase3-crm",
    "phase4-agenda-finance",
    "phase5-whatsapp-ai",
    "phase6-refinement-and-legal-hub",
  ])
    await db.exec(await readFile(`supabase/review/${phase}.sql`, "utf8"));
  await query("INSERT INTO auth.users VALUES($1),($2),($3)", [
    admin,
    staff,
    inactive,
  ]);
  await query(
    "INSERT INTO public.profiles(id,full_name,role,is_active)VALUES($1,'Admin Teste','admin',true),($2,'Equipe Teste','staff',true),($3,'Inativo Teste','staff',false)",
    [admin, staff, inactive],
  );
  await query(
    "INSERT INTO public.clients(id,full_name,email,phone)VALUES($1,'Cliente Teste','cliente@example.test','+5513999999999'),($2,'Outro Cliente','outro@example.test','+5513888888888')",
    [client, other],
  );
  await query(
    "INSERT INTO public.leads_intake(id,name,phone,practice_area,summary,consent_version)VALUES($1,'Lead Teste','+5513999999999','contratos','Resumo','privacy-v1')",
    [lead],
  );
  await query(
    "INSERT INTO public.cases(id,client_id,source_lead_id,title,practice_area,cnj_number,ai_summary)VALUES($1,$2,$3,'Caso de Teste','contratos','12345678901234567890','Resumo revisado pelo advogado')",
    [caseId, client, lead],
  );
  const tables = [
    "email_outbox",
    "email_triage",
    "document_kits",
    "legal_knowledge_sources",
    "legal_knowledge_updates",
    "copilot_turns",
  ];
  await t.test(
    "anon, inativo e browser não acessam RPC de serviço ou escrita sensível",
    async () => {
      for (const [r, u] of [
        ["anon", ""],
        ["authenticated", inactive],
        ["authenticated", staff],
        ["authenticated", admin],
      ]) {
        await role(r, u);
        await assert.rejects(action("dashboard"), /permission denied/);
        for (const table of tables)
          await assert.rejects(
            db.exec(`DELETE FROM public.${table}`),
            /permission denied/,
          );
        for (const table of tables) {
          if(r==='anon')await assert.rejects(db.exec(`SELECT * FROM public.${table}`),/permission denied/);
          else if(u===inactive)assert.equal(Number((await query(`SELECT count(*) n FROM public.${table}`)).rows[0].n),0);
        }
        if(r==='authenticated'&&u!==inactive)assert.ok(Number((await query('SELECT count(*) n FROM public.legal_knowledge_sources')).rows[0].n)>=13);

      }
      await role("service_role");
      await assert.rejects(
        action("dashboard", {}, {}, inactive),
        /Membro ativo/,
      );
    },
  );
  await t.test(
    "perfil edita somente campos permitidos, não promove papel e verifica versão",
    async () => {
      const before = (
        await query("SELECT * FROM public.profiles WHERE id=$1", [staff])
      ).rows[0];
      const saved = await action(
        "profile_save",
        {},
        {
          full_name: "Nome Atualizado",
          oab_number: "123456",
          oab_uf: "SP",
          phone: "+5513999999999",
          bio: "Bio Teste",
          role: "admin",
          is_active: false,
          id: admin,
          expected_updated_at: before.updated_at,
        },
      );
      assert.equal(saved.role, "staff");
      assert.equal(saved.is_active, true);
      assert.equal(saved.id, staff);
      assert.equal(saved.oab_uf, "SP");
      await assert.rejects(
        action(
          "profile_save",
          {},
          { full_name: "Outro Nome", expected_updated_at: before.updated_at },
        ),
        /Perfil alterado/,
      );
      assert.equal(
        (
          await query("SELECT full_name FROM public.profiles WHERE id=$1", [
            admin,
          ])
        ).rows[0].full_name,
        "Admin Teste",
      );
    },
  );
  let appointment, payment;
  await t.test(
    "agenda e checkout reais avançam funil sem regressão; estados incertos não contam",
    async () => {
      appointment = id();
      await query(
        "INSERT INTO public.appointments(id,title,type,starts_at,ends_at,lead_id,status)VALUES($1,'Reunião','consulta',now(),now()+interval '1 hour',$2,'pendente')",
        [appointment, lead],
      );
      assert.equal(
        (
          await query("SELECT stage FROM public.leads_intake WHERE id=$1", [
            lead,
          ])
        ).rows[0].stage,
        "reuniao_agendada",
      );
      payment = id();
      await query(
        "INSERT INTO public.payments(id,order_nsu,client_id,case_id,description,amount_cents)VALUES($1,$1,$2,$3,'Consulta',15000)",
        [payment, client, caseId],
      );
      assert.equal(
        (
          await query("SELECT stage FROM public.leads_intake WHERE id=$1", [
            lead,
          ])
        ).rows[0].stage,
        "reuniao_agendada",
      );
      await query(
        "UPDATE public.payments SET checkout_state='ready',checkout_url='https://pay.infinitepay.io/test' WHERE id=$1",
        [payment],
      );
      assert.equal(
        (
          await query("SELECT stage FROM public.leads_intake WHERE id=$1", [
            lead,
          ])
        ).rows[0].stage,
        "proposta",
      );
      await query(
        "UPDATE public.appointments SET title='Reunião atualizada' WHERE id=$1",
        [appointment],
      );
      assert.equal(
        (
          await query("SELECT stage FROM public.leads_intake WHERE id=$1", [
            lead,
          ])
        ).rows[0].stage,
        "proposta",
      );
    },
  );
  await role("postgres");
  await query(
    "UPDATE public.leads_intake SET converted_client_id=$2,stage='fechado' WHERE id=$1",
    [lead, client],
  );
  await role("service_role");
  let preview, mailId;
  await t.test(
    "e-mail usa cadastro e registro correto, exige revisão e conteúdo atual e deduplica",
    async () => {
      preview = await action(
        "email_preview",
        { case_id: caseId },
        { template: "payment", reference_id: payment },
      );
      assert.equal(preview.recipient, "cliente@example.test");
      assert.match(preview.content, /infinitepay/);
      await assert.rejects(
        action(
          "email_prepare",
          { case_id: caseId },
          {
            id: id(),
            template: "payment",
            reference_id: payment,
            provider: "resend",
          },
        ),
        /Revisão/,
      );
      await assert.rejects(
        action(
          "email_prepare",
          { case_id: caseId },
          {
            id: id(),
            template: "payment",
            reference_id: payment,
            provider: "resend",
            reviewed: true,
            preview_token: "stale",
          },
        ),
        /Conteúdo alterado/,
      );
      await assert.rejects(
        action(
          "email_preview",
          { client_id: other },
          { template: "payment", reference_id: payment },
        ),
        /no rows/,
      );
      mailId = id();
      const payload = {
        id: mailId,
        template: "payment",
        reference_id: payment,
        provider: "resend",
        reviewed: true,
        preview_token: preview.preview_token,
      };
      assert.equal(
        (await action("email_prepare", { case_id: caseId }, payload)).send,
        true,
      );
      assert.equal(
        (await action("email_prepare", { case_id: caseId }, payload)).send,
        false,
      );
      await action(
        "email_finish",
        { case_id: caseId },
        { id: mailId, external_id: "resend-test" },
      );
      assert.ok(
        (
          await query(
            "SELECT last_contact_at FROM public.leads_intake WHERE id=$1",
            [lead],
          )
        ).rows[0].last_contact_at,
      );
    },
  );
  await t.test(
    "triagem sugere CNJ sem vincular nem criar prazo; decisão humana é otimista",
    async () => {
      const data = {
        sender: "tribunal@example.test",
        subject: "Intimação Teste",
        content: "Conteúdo de teste",
        priority: "prazo",
        classification_method: "rules",
        cnj_numbers_json: ["12345678901234567890"],
      };
      const receive = () =>
        query(
          "SELECT public.office_receive_email('relay','external-1',$1) result",
          [JSON.stringify(data)],
        );
      const received = (await receive()).rows[0].result;
      assert.deepEqual(received.suggested_case_ids, [caseId]);
      assert.equal(received.case_id, null);
      assert.equal((await receive()).rows[0].result.duplicate, true);
      const before = Number(
        (await query("SELECT count(*) n FROM public.appointments")).rows[0].n,
      );
      const reviewed = await action(
        "triage_review",
        { case_id: caseId },
        {
          id: received.id,
          status: "linked",
          expected_updated_at: received.updated_at,
        },
      );
      assert.equal(reviewed.reviewed_by, staff);
      assert.equal(reviewed.case_id, caseId);
      await assert.rejects(
        action(
          "triage_review",
          { case_id: caseId },
          {
            id: received.id,
            status: "dismissed",
            expected_updated_at: received.updated_at,
          },
        ),
        /alterado/,
      );
      assert.equal(
        Number(
          (await query("SELECT count(*) n FROM public.appointments")).rows[0].n,
        ),
        before,
      );
    },
  );
  await t.test(
    "kit preserva contexto, versão e histórico imutável",
    async () => {
      const kitId = id(),
        data = {
          id: kitId,
          inputs: { scope: "Atuação específica" },
          documents: [{ title: "Minuta", content: "Teste" }],
        };
      const first = await action("kit_save", { case_id: caseId }, data);
      const replay = await action("kit_save", { case_id: caseId }, data);
      assert.equal(replay.id, first.id);
      await assert.rejects(
        action("kit_save", { case_id: caseId, client_id: other }, data),
        /outro cliente/,
      );
      await assert.rejects(
        query("UPDATE public.document_kits SET documents='[]'"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "contato é corrigível sem alterar identidade e kit revisado cria nova versão",
    async () => {
      const before = await action("details", { case_id: caseId });
      const saved = await action(
        "client_save",
        { case_id: caseId },
        {
          phone: "+5513988887777",
          email: "atualizado@example.test",
          address_json: { street: "Rua Atualizada", city: "Santos" },
          expected_updated_at: before.client.updated_at,
          document_number: "forged",
        },
      );
      assert.equal(saved.full_name, before.client.full_name);
      assert.equal(saved.document_number, before.client.document_number);
      assert.equal(
        (await action("details", { case_id: caseId })).phone,
        "+5513988887777",
      );
      await assert.rejects(
        action(
          "client_save",
          { case_id: caseId },
          {
            phone: "+5513999999999",
            email: "old@example.test",
            address_json: {},
            expected_updated_at: before.client.updated_at,
          },
        ),
        /Cliente alterado/,
      );
      const base = (await action("details", { case_id: caseId })).kits[0],
        reviewId = id(),
        documents = [
          {
            title: "Minuta revisada",
            content: "Cláusula editada e revisada pelo advogado.",
          },
        ];
      await assert.rejects(
        action(
          "kit_review",
          { case_id: caseId },
          { id: reviewId, base_kit_id: base.id, documents, reviewed: false },
        ),
        /revisão ausente/,
      );
      const revised = await action(
        "kit_review",
        { case_id: caseId },
        { id: reviewId, base_kit_id: base.id, documents, reviewed: true },
      );
      assert.equal(revised.inputs.base_kit_id, base.id);
      assert.equal(revised.created_by, staff);
      assert.equal(
        (await action("details", { case_id: caseId })).kits.length,
        2,
      );
      assert.equal(
        (await action("details", { case_id: caseId })).inbound_emails.length,
        1,
      );
    },
  );
  await t.test(
    "fontes oficiais são admin-only na mutação; falha preserva atualização anterior",
    async () => {
      await assert.rejects(action("sync_reserve"), /administrador/);
      await action("sync_reserve", {}, {}, admin);
      await assert.rejects(action("sync_reserve", {}, {}, admin), /5 minutos/);
      const knowledge = await action("knowledge");
      assert.ok(knowledge.sources.length >= 13);
      const source = knowledge.sources.find((s) => s.id === "stf");
      await action(
        "sync_result",
        {},
        {
          source_id: source.id,
          official_url: source.official_url,
          title: source.title,
          summary: "Trecho oficial de teste",
          content_hash: "a".repeat(64),
        },
        admin,
      );
      await action(
        "sync_result",
        {},
        {
          source_id: source.id,
          official_url: source.official_url,
          error: "Indisponível",
        },
        admin,
      );
      assert.equal((await action("knowledge")).updates.length, 1);
      await assert.rejects(
        action(
          "sync_result",
          {},
          {
            source_id: source.id,
            official_url: "https://evil.example/",
            title: "Falso",
            summary: "Falso",
            content_hash: "b".repeat(64),
          },
          admin,
        ),
        /Fonte oficial/,
      );
    },
  );
  await t.test(
    "chat é idempotente, isolado por autor, limitado e nunca envia nada",
    async () => {
      const turnId = id();
      assert.equal(
        (
          await action(
            "chat_start",
            { case_id: caseId },
            { id: turnId, question: "Pergunta interna" },
          )
        ).generate,
        true,
      );
      assert.equal(
        (
          await action(
            "chat_start",
            { case_id: caseId },
            { id: turnId, question: "Pergunta interna" },
          )
        ).generate,
        false,
      );
      await action(
        "chat_finish",
        { case_id: caseId },
        {
          id: turnId,
          answer: "Trecho com fonte",
          citations_json: [{ url: "https://noticias.stf.jus.br/" }],
        },
      );
      await role("authenticated", admin);
      assert.equal(
        Number(
          (await query("SELECT count(*) n FROM public.copilot_turns")).rows[0]
            .n,
        ),
        1,
      );
      await role("authenticated", inactive);
      assert.equal(
        Number(
          (await query("SELECT count(*) n FROM public.copilot_turns")).rows[0]
            .n,
        ),
        0,
      );
      await role("service_role");
      for (let i = 0; i < 4; i++)
        await action("chat_start", {}, { id: id(), question: "Pergunta " + i });
      await assert.rejects(
        action("chat_start", {}, { id: id(), question: "Limite" }),
        /Limite/,
      );
    },
  );
  await t.test(
    "dashboard calcula pendências e script reaplica sem destruir dados",
    async () => {
      const dashboard = await action("dashboard");
      assert.equal(dashboard.payments.length, 1);
      assert.equal(dashboard.unanswered.length, 0);
      assert.ok(dashboard.today);
      await role("postgres");
      await db.exec(
        await readFile(
          "supabase/review/phase6-refinement-and-legal-hub.sql",
          "utf8",
        ),
      );
      assert.equal(
        Number(
          (await query("SELECT count(*) n FROM public.email_outbox")).rows[0].n,
        ),
        1,
      );
    },
  );
  await db.close();
});
