import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Postgres local em WASM; nenhum acesso ao projeto hospedado.
const db = new PGlite();
const actor = '10000000-0000-0000-0000-000000000001';
const inactive = '10000000-0000-0000-0000-000000000002';
const noProfile = '10000000-0000-0000-0000-000000000003';
let serial = 0;
const uuid = () => `20000000-0000-0000-0000-${String(++serial).padStart(12, '0')}`;
async function asRole(role, id = '') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`SET ROLE ${role}`);
}
async function lead(name = 'Maria de Teste') {
  await asRole('postgres');
  const id = uuid();
  await db.query(`INSERT INTO public.leads_intake(id,name,phone,practice_area,summary,consent_version)
    VALUES($1,$2,'+5513999999999','contratos','Resumo de teste jurídico','privacy-v1')`, [id, name]);
  await asRole('authenticated', actor);
  return id;
}
const params = (id, overrides = {}) => ({ id, name: 'Maria de Teste', type: 'cpf', doc: '529.982.247-25', title: 'Revisão contratual', address: {}, other: '', otherType: 'cpf', otherDoc: '', ...overrides });
async function rpc(action, p, token = null) {
  const values = [p.id, p.name, p.type, p.doc, p.title, JSON.stringify(p.address), p.other, p.otherType, p.otherDoc];
  if (action === 'convert_lead') values.push(token);
  const sql = `SELECT public.${action}(${values.map((_, i) => `$${i+1}`).join(',')}) AS result`;
  return (await db.query(sql, values)).rows[0].result;
}
async function count(table) { return Number((await db.query(`SELECT count(*) n FROM public.${table}`)).rows[0].n); }

test('Fases 1–3: autorização, conversão, conflitos e rollback no Postgres', async t => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;`);
  for (const file of ['phase1-schema.sql', 'phase2-intake.sql', 'phase3-crm.sql']) await db.exec(await readFile(`supabase/review/${file}`, 'utf8'));
  // A revisão deve poder ser reaplicada sem duplicar funções, triggers ou privilégios.
  await db.exec(await readFile('supabase/review/phase3-crm.sql', 'utf8'));
  await db.query('INSERT INTO auth.users VALUES ($1),($2),($3)', [actor, inactive, noProfile]);
  await db.query(`INSERT INTO public.profiles(id, full_name, is_active) VALUES ($1,'Equipe Teste',true),($2,'Inativo Teste',false)`, [actor,inactive]);

  await t.test('valida CPF, CNPJ e rejeita dígitos/adulterações', async () => {
    await asRole('authenticated', actor);
    for (const [type, doc, valid] of [['cpf','52998224725',true],['cpf','11111111111',false],['cpf','52998224724',false],['cnpj','62575046000196',true],['cnpj','00000000000000',false],['cnpj','12ABC34501DE35',true],['cpf','52998224725x',false]]) {
      const result = (await db.query('SELECT m14_private.valid_document($1,$2) valid', [type,doc])).rows[0];
      assert.equal(result.valid,valid,doc);
    }
  });
  await t.test('anon não pode consultar/converter nem inserir intake direto', async () => {
    const id = await lead(); await asRole('anon');
    await assert.rejects(rpc('review_lead_conversion', params(id)), /permission denied/);
    await assert.rejects(rpc('convert_lead', params(id)), /permission denied/);
    await assert.rejects(db.query("INSERT INTO public.leads_intake(name) VALUES('Anônimo')"), /permission denied/);
  });
  await t.test('inativo e usuário sem profile são bloqueados pelo banco', async () => {
    const id = await lead();
    for (const user of [inactive, noProfile]) {
      await asRole('authenticated',user);
      assert.equal(await count('leads_intake'),0);
      await assert.rejects(rpc('review_lead_conversion',params(id)), /membros ativos/);
      await assert.rejects(rpc('convert_lead',params(id)), /membros ativos/);
    }
  });
  let first;
  await t.test('conversão cria cliente, caso, parte e vincula mensagem sem duplicá-la', async () => {
    const id = await lead(); const p = params(id);
    await asRole('postgres');
    await db.query("INSERT INTO public.whatsapp_messages(lead_id,direction,sender_type,content) VALUES($1,'inbound','client','Mensagem teste')", [id]);
    await asRole('authenticated',actor);
    const review = await rpc('review_lead_conversion',p); assert.deepEqual(review.conflicts,[]);
    await assert.rejects(rpc('convert_lead',p), /Refaça a checagem/);
    first = await rpc('convert_lead',p,review.token);
    assert.equal(first.already_converted,false);
    const converted = (await db.query('SELECT stage,converted_client_id FROM public.leads_intake WHERE id=$1',[id])).rows[0];
    assert.equal(converted.stage,'fechado'); assert.equal(converted.converted_client_id,first.client_id);
    assert.equal(await count('clients'),1); assert.equal(await count('cases'),1); assert.equal(await count('whatsapp_messages'),1);
    assert.equal((await db.query('SELECT client_id FROM public.whatsapp_messages WHERE lead_id=$1',[id])).rows[0].client_id,first.client_id);
    const retry = await rpc('convert_lead',p,review.token);
    assert.equal(retry.already_converted,true); assert.equal(retry.case_id,first.case_id);
    assert.equal(await count('cases'),1);
    await asRole('postgres');
    assert.ok((await db.query("SELECT count(*)::int n FROM public.audit_logs WHERE actor_id=$1 AND entity IN ('clients','cases','leads_intake','whatsapp_messages')",[actor])).rows[0].n >= 4);
  });
  await t.test('reutiliza CPF validado em outro lead e preserva cadastro existente', async () => {
    const p = params(await lead(),{name:'Outro nome recebido',address:{city:'São Paulo'}});
    const review = await rpc('review_lead_conversion',p);
    assert.deepEqual(review.conflicts,[]);
    const result = await rpc('convert_lead',p,review.token);
    assert.equal(result.client_id,first.client_id); assert.notEqual(result.case_id,first.case_id);
    assert.equal(await count('clients'),1); assert.equal(await count('cases'),2);
    assert.equal((await db.query('SELECT full_name FROM public.clients WHERE id=$1',[first.client_id])).rows[0].full_name,'Maria de Teste');
  });
  await t.test('não contorna RPC por escrita direta de clientes/casos/partes/vínculo ou WhatsApp', async () => {
    await asRole('authenticated',actor);
    for (const table of ['clients','cases','case_parties','whatsapp_messages']) await assert.rejects(db.query(`INSERT INTO public.${table}(id) VALUES($1)`,[uuid()]), /permission denied/);
    await assert.rejects(db.query('UPDATE public.leads_intake SET converted_client_id=$1',[first.client_id]), /permission denied/);
    await assert.rejects(db.query('UPDATE public.leads_intake SET stage=\'triagem\' WHERE converted_client_id=$1',[first.client_id]), /convertido/);
    const id=await lead();
    await db.query("UPDATE public.leads_intake SET stage='triagem' WHERE id=$1",[id]);
    await assert.rejects(db.query("UPDATE public.leads_intake SET stage='fechado' WHERE id=$1",[id]), /fechamento exige conversão/);
  });
  await t.test('bloqueia CPF inválido, lead arquivado e parte adversa igual ao cliente', async () => {
    const p=params(await lead(),{name:'Cliente Igual',doc:'11144477735'});
    await assert.rejects(rpc('review_lead_conversion',{...p,doc:'52998224724'}),/inválido/);
    await db.query("UPDATE public.leads_intake SET stage='arquivado' WHERE id=$1",[p.id]);
    await assert.rejects(rpc('review_lead_conversion',p),/Reabra/);
    await db.query("UPDATE public.leads_intake SET stage='triagem' WHERE id=$1",[p.id]);
    const same={...p,other:p.name}; const review=await rpc('review_lead_conversion',same);
    await assert.rejects(rpc('convert_lead',same,review.token),/coincidem/);
  });
  await t.test('nome com acento e documento detectam conflitos; dados alterados invalidam revisão', async () => {
    const p=params(await lead(),{name:'José de Teste',type:'cnpj',doc:'62575046000196'});
    const review=await rpc('review_lead_conversion',p); assert.deepEqual(review.conflicts,[]);
    await assert.rejects(rpc('convert_lead',{...p,title:'Título alterado'},review.token),/Refaça/);
    await asRole('postgres');
    await db.query("INSERT INTO public.case_parties(case_id,full_name,party_role) VALUES($1,'  JOSE  DE TESTE  ','adversa')",[first.case_id]);
    await asRole('authenticated',actor);
    await assert.rejects(rpc('convert_lead',p,review.token),/Refaça/);
    const changed=await rpc('review_lead_conversion',p); assert.equal(changed.conflicts.length,1); assert.equal(changed.conflicts[0].match_by,'nome');
    await assert.rejects(rpc('convert_lead',p,changed.token),/conflito de interesses/);
    const other=params(await lead(),{name:'Empresa Teste',type:'cnpj',doc:'62575046000196',other:'Maria de Teste',otherDoc:'52998224725'});
    const hits=await rpc('review_lead_conversion',other); assert.ok(hits.conflicts.length>=1);
    await assert.rejects(rpc('convert_lead',other,hits.token),/conflito/);
  });
  await t.test('não ignora nome sem documento e consulta o nome canônico do cliente reutilizado', async () => {
    await asRole('postgres');
    await db.query("INSERT INTO public.case_parties(case_id,full_name,party_role) VALUES($1,'Nome Sem Documento','cliente')",[first.case_id]);
    await db.query("INSERT INTO public.case_parties(case_id,full_name,party_role) VALUES($1,'Maria de Teste','adversa')",[first.case_id]);
    const p=params(await lead(),{name:'Nome Sem Documento',doc:'11144477735'});
    const review=await rpc('review_lead_conversion',p); assert.ok(review.conflicts.length>0);
    const canonical=params(await lead(),{name:'Nome alterado na entrada'});
    const changed=await rpc('review_lead_conversion',canonical); assert.ok(changed.conflicts.some(hit=>hit.party_role==='adversa'));
  });
  await t.test('falha no vínculo de WhatsApp desfaz cliente/caso/partes/etapa e auditoria', async () => {
    const p=params(await lead(),{name:'Empresa Sem Conflito',type:'cnpj',doc:'62575046000196'});
    await asRole('postgres');
    await db.query("INSERT INTO public.whatsapp_messages(lead_id,client_id,direction,sender_type,content) VALUES($1,$2,'inbound','client','Outro cadastro')",[p.id,first.client_id]);
    const before={clients:await count('clients'),cases:await count('cases'),parties:await count('case_parties'),audit:await count('audit_logs')};
    await asRole('authenticated',actor);
    const review=await rpc('review_lead_conversion',p); assert.deepEqual(review.conflicts,[]);
    await assert.rejects(rpc('convert_lead',p,review.token),/outro cliente/);
    await asRole('postgres');
    assert.equal(await count('clients'),before.clients);assert.equal(await count('cases'),before.cases);assert.equal(await count('case_parties'),before.parties);assert.equal(await count('audit_logs'),before.audit);
    assert.equal((await db.query('SELECT stage FROM public.leads_intake WHERE id=$1',[p.id])).rows[0].stage,'novo');
  });
  await db.close();
});
