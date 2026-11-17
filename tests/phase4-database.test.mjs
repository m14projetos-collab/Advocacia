import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const actor = "10000000-0000-0000-0000-000000000001",
  inactive = "10000000-0000-0000-0000-000000000002";
const client = "20000000-0000-0000-0000-000000000001",
  other = "20000000-0000-0000-0000-000000000002";
const caseId = "30000000-0000-0000-0000-000000000001";
let sequence = 0;
const id = () =>
  `40000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`;
async function role(value, who = "") {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [who]);
  await db.exec(`SET ROLE ${value}`);
}
const schedule = (overrides = {}) => ({
  title: "Consulta jurídica",
  type: "consulta",
  starts_at: "2030-03-04T12:00:00Z",
  ends_at: "2030-03-04T13:00:00Z",
  lead_id: null,
  case_id: caseId,
  meeting_url: null,
  payment_required: true,
  status: "pendente",
  ...overrides,
});
async function save(appointment, data, version = null, who = actor) {
  return (
    await db.query(
      "SELECT public.office_save_appointment($1,$2,$3,$4) result",
      [who, appointment, JSON.stringify(data), version],
    )
  ).rows[0].result;
}
const charge = (appointment, overrides = {}) => ({
  client_id: client,
  case_id: caseId,
  appointment_id: appointment,
  description: "Consulta jurídica",
  fee_type: "consulta",
  amount_cents: 15000,
  due_date: null,
  ...overrides,
});
async function prepare(payment, data) {
  return (
    await db.query("SELECT public.office_prepare_checkout($1,$2,$3) result", [
      actor,
      payment,
      JSON.stringify(data),
    ])
  ).rows[0].result;
}
async function confirm(
  payment,
  transaction = "transaction-test",
  amount = 15000,
) {
  return (
    await db.query(
      "SELECT public.office_confirm_payment($1,$2,$3,$4,$5,$6) result",
      [payment, transaction, "slug-test", amount, "pix", "a".repeat(64)],
    )
  ).rows[0].result;
}
async function row(table, value) {
  return (await db.query(`SELECT * FROM public.${table} WHERE id=$1`, [value]))
    .rows[0];
}
async function count(table) {
  return Number(
    (await db.query(`SELECT count(*) n FROM public.${table}`)).rows[0].n,
  );
}

test("Fase 4: SQL transacional, RLS e invariantes da agenda/financeiro", async (t) => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;`);
  for (const phase of [
    "phase1-schema.sql",
    "phase2-intake.sql",
    "phase3-crm.sql",
    "phase4-agenda-finance.sql",
  ])
    await db.exec(await readFile(`supabase/review/${phase}`, "utf8"));
  await db.query("INSERT INTO auth.users VALUES($1),($2)", [actor, inactive]);
  await db.query(
    "INSERT INTO public.profiles(id,full_name,is_active) VALUES($1,'Equipe Teste',true),($2,'Inativo Teste',false)",
    [actor, inactive],
  );
  await db.query(
    "INSERT INTO public.clients(id,full_name) VALUES($1,'Cliente Teste'),($2,'Outro Cliente')",
    [client, other],
  );
  await db.query(
    "INSERT INTO public.cases(id,client_id,title,practice_area) VALUES($1,$2,'Caso Teste','contratos')",
    [caseId, client],
  );
  await t.test(
    "browser não grava agenda/financeiro nem executa RPCs de serviço",
    async () => {
      for (const who of ["anon", "authenticated"]) {
        await role(who, actor);
        for (const table of ["appointments", "payments", "payment_events"]) {
          await assert.rejects(
            db.query(`INSERT INTO public.${table}(id) VALUES($1)`, [id()]),
            /permission denied/,
          );
          await assert.rejects(
            db.query(`UPDATE public.${table} SET id=id`),
            /permission denied/,
          );
        }
        await assert.rejects(save(id(), schedule()), /permission denied/);
        await assert.rejects(prepare(id(), charge(null)), /permission denied/);
        await assert.rejects(confirm(id()), /permission denied/);
      }
    },
  );
  let appointment, payment, original;
  await t.test(
    "serviço verifica ator ativo e cria consulta pendente com auditoria",
    async () => {
      await role("service_role");
      await assert.rejects(
        save(id(), schedule(), null, inactive),
        /Membro ativo/,
      );
      appointment = id();
      original = await save(appointment, schedule());
      assert.equal(original.status, "pendente");
      await role("postgres");
      const audit = (
        await db.query(
          "SELECT actor_id FROM public.audit_logs WHERE entity='appointments' AND entity_id=$1",
          [appointment],
        )
      ).rows[0];
      assert.equal(audit.actor_id, actor);
      await role("service_role");
    },
  );
  await t.test(
    "conflito de horário, prazo simultâneo, limites adjacentes e versão otimista",
    async () => {
      await assert.rejects(save(id(), schedule()), /Conflito de horário/);
      const deadline = await save(
        id(),
        schedule({ type: "prazo", payment_required: false }),
      );
      assert.equal(deadline.type, "prazo");
      const adjacent = await save(
        id(),
        schedule({
          starts_at: "2030-03-04T13:00:00Z",
          ends_at: "2030-03-04T14:00:00Z",
          payment_required: false,
        }),
      );
      assert.ok(adjacent.id);
      await assert.rejects(
        save(appointment, schedule({ title: "Edição sem versão" })),
        /Atualize a agenda/,
      );
      const edited = await save(
        appointment,
        schedule({ title: "Consulta revisada" }),
        original.updated_at,
      );
      assert.equal(edited.title, "Consulta revisada");
      await assert.rejects(
        save(appointment, schedule(), original.updated_at),
        /Atualize a agenda/,
      );
      original = edited;
    },
  );
  await t.test(
    "não confirma consulta paga antes do pagamento; não aceita valor/cliente/caso divergentes",
    async () => {
      await assert.rejects(
        save(
          appointment,
          schedule({ status: "confirmado" }),
          original.updated_at,
        ),
        /depende de pagamento/,
      );
      await assert.rejects(
        prepare(id(), charge(appointment, { amount_cents: 99 })),
        /mínimo/,
      );
      await assert.rejects(
        prepare(id(), charge(appointment, { client_id: other })),
        /Caso não pertence/,
      );
      await assert.rejects(
        prepare(id(), charge(appointment, { case_id: null })),
        /Caso diverge/,
      );
    },
  );
  await t.test(
    "ordem é durável, UUID=order_nsu, reutilização e dados imutáveis",
    async () => {
      payment = id();
      const first = await prepare(payment, charge(appointment));
      assert.equal(first.create_link, true);
      assert.equal(first.payment.id, first.payment.order_nsu);
      assert.equal(
        (await prepare(payment, charge(appointment))).create_link,
        false,
      );
      await assert.rejects(
        prepare(payment, charge(appointment, { amount_cents: 16000 })),
        /outros dados/,
      );
      await assert.rejects(prepare(id(), charge(appointment)), /duplicate key/);
      await assert.rejects(
        save(
          appointment,
          schedule({ payment_required: false }),
          original.updated_at,
        ),
        /Não altere vínculos/,
      );
      await db.query("SELECT public.office_store_checkout($1,$2,NULL)", [
        actor,
        payment,
      ]);
      assert.equal((await row("payments", payment)).checkout_state, "unknown");
      assert.equal(
        (await prepare(payment, charge(appointment))).create_link,
        false,
      );
      await assert.rejects(
        db.query("SELECT public.office_store_checkout($1,$2,$3)", [
          actor,
          payment,
          "https://attacker.test/x",
        ]),
        /URL/,
      );
      await db.query("SELECT public.office_store_checkout($1,$2,$3)", [
        actor,
        payment,
        "https://checkout.infinitepay.io/test",
      ]);
      assert.equal((await row("payments", payment)).checkout_state, "ready");
    },
  );
  await t.test(
    "valor divergente não gera evento; aprovação confirma consulta e processa evento uma vez",
    async () => {
      await assert.rejects(
        confirm(payment, "transaction-test", 14999),
        /divergente/,
      );
      assert.equal(await count("payment_events"), 0);
      assert.equal((await confirm(payment)).duplicate, false);
      assert.equal((await row("payments", payment)).status, "paid");
      assert.equal(
        (await row("appointments", appointment)).status,
        "confirmado",
      );
      assert.equal((await confirm(payment)).duplicate, true);
      assert.equal(await count("payment_events"), 1);
      assert.ok(
        (await db.query("SELECT processed_at FROM public.payment_events"))
          .rows[0].processed_at,
      );
      const extra = await confirm(payment, "transaction-extra");
      assert.equal(extra.review_required, true);
      assert.equal(
        (await row("payments", payment)).transaction_nsu,
        "transaction-test",
      );
    },
  );
  await t.test(
    "pagamento tardio não reabre consulta cancelada e sinaliza revisão",
    async () => {
      const slot = id();
      const a = await save(
        slot,
        schedule({
          starts_at: "2030-03-05T12:00:00Z",
          ends_at: "2030-03-05T13:00:00Z",
        }),
      );
      const p = id();
      await prepare(p, charge(slot));
      await save(
        slot,
        schedule({
          starts_at: a.starts_at,
          ends_at: a.ends_at,
          status: "cancelado",
        }),
        a.updated_at,
      );
      await confirm(p, "transaction-late");
      assert.equal((await row("appointments", slot)).status, "cancelado");
      assert.equal((await row("payments", p)).review_required, true);
    },
  );
  await t.test(
    "erro na confirmação do agendamento desfaz pagamento e evento na mesma transação",
    async () => {
      const slot = id();
      await save(
        slot,
        schedule({
          starts_at: "2030-03-06T12:00:00Z",
          ends_at: "2030-03-06T13:00:00Z",
        }),
      );
      const p = id();
      await prepare(p, charge(slot));
      await role("postgres");
      await db.exec(`CREATE FUNCTION m14_private.test_reject_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='confirmado' THEN RAISE EXCEPTION 'test reject'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION m14_private.test_reject_confirmation();`);
      await role("service_role");
      const before = await count("payment_events");
      await assert.rejects(confirm(p, "transaction-rollback"), /test reject/);
      assert.equal(await count("payment_events"), before);
      assert.equal((await row("payments", p)).status, "pending");
      assert.equal((await row("appointments", slot)).status, "pendente");
      await role("postgres");
      await db.exec(
        "DROP TRIGGER test_reject ON public.appointments; DROP FUNCTION m14_private.test_reject_confirmation()",
      );
    },
  );
  await t.test(
    "reexecução da revisão preserva registros e privilégios",
    async () => {
      const before = await count("payments");
      await db.exec(
        await readFile("supabase/review/phase4-agenda-finance.sql", "utf8"),
      );
      assert.equal(await count("payments"), before);
      await role("authenticated", inactive);
      assert.equal(await count("payments"), 0);
      assert.equal(await count("appointments"), 0);
    },
  );
  await db.close();
});
