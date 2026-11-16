import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

const source = (await readFile('supabase/functions/leads-intake/index.ts','utf8')).replace(/^import .*?;\n/, '');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const payload = { name: 'Cliente Teste', phone: '(13) 99999-9999', practice_area: 'contratos', summary: 'Resumo para testar o atendimento.', lgpd_consent: true, turnstile_token: 'valid-test-token' };
function runtime(options = {}) {
  const calls = { verify: 0, rpc: [], insert: [] };
  const env = { INTAKE_ENABLED: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-test', APP_ORIGIN: 'https://portal.example.test', INTAKE_HASH_SECRET: 'x'.repeat(64), TURNSTILE_SECRET_KEY: 'secret-test', ...options.env };
  let handler;
  vm.runInNewContext(code, {
    Request, Response, URL, URLSearchParams, TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    console: { error() {} },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    fetch: async (url, init) => {
      calls.verify++;
      assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.equal(init.body.get('secret'),'secret-test'); assert.equal(init.body.get('response'),'valid-test-token');
      if (options.verifyThrows) throw new Error('Network failure');
      return Response.json({ success: true, action: 'leads_intake', hostname: 'portal.example.test', ...options.verification });
    },
    createClient: () => ({
      rpc: async (name, input) => { calls.rpc.push({ name, input }); return options.rateResponse ?? { data: true, error: null }; },
      from: table => ({ insert: async input => { calls.insert.push({ table, input }); return { error: null }; } }),
    }),
  });
  return { calls, run: (body = payload) => handler(new Request('https://test.supabase.co/functions/v1/leads-intake', { method: 'POST', headers: { 'Content-Type':'application/json', Origin:'https://portal.example.test', 'x-forwarded-for':'203.0.113.10' }, body: JSON.stringify(body) })) };
}

test('intake desabilitado ou sem secrets falha fechado antes de CAPTCHA/banco', async () => {
  for (const env of [{ INTAKE_ENABLED: 'false' }, { TURNSTILE_SECRET_KEY: '' }, { INTAKE_HASH_SECRET: '' }, { INTAKE_HASH_SECRET: 'short' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    const {calls,run}=runtime({env}); assert.equal((await run()).status,503);
    assert.equal(calls.verify,0); assert.equal(calls.rpc.length,0); assert.equal(calls.insert.length,0);
  }
});
test('token vazio, expirado/repetido, origem/action divergente ou erro Cloudflare não inserem lead', async () => {
  for (const options of [{verification:{success:false,'error-codes':['timeout-or-duplicate']}},{verification:{action:'another-action'}},{verification:{hostname:'attacker.example.test'}},{verifyThrows:true}]) {
    const {calls,run}=runtime(options); assert.equal((await run()).status,403); assert.equal(calls.insert.length,0);
  }
  for (const token of ['', 'x'.repeat(2049)]) {
    const {calls,run}=runtime(); assert.equal((await run({...payload,turnstile_token:token})).status,403); assert.equal(calls.verify,0); assert.equal(calls.insert.length,0);
  }
});
test('limite excedido retorna 429; RPC com erro/resultado inesperado retorna 503 sem INSERT', async () => {
  for (const [rateResponse,status] of [[{data:false,error:null},429],[{data:null,error:{message:'RPC failed'}},503],[{data:null,error:null},503],[{data:'true',error:null},503]]) {
    const {calls,run}=runtime({rateResponse}); assert.equal((await run()).status,status); assert.equal(calls.insert.length,0);
  }
});
test('token validado chama a RPC pública, hash sem IP bruto e insere lead normalizado', async () => {
  const {calls,run}=runtime(); const response=await run(); assert.equal(response.status,201);
  assert.equal(calls.rpc.length,1); assert.equal(calls.rpc[0].name,'check_intake_rate_limit');
  assert.equal(calls.rpc[0].input.p_limit,8); assert.match(calls.rpc[0].input.p_ip_hash,/^[0-9a-f]{64}$/);
  assert.equal(calls.insert.length,1); assert.equal(calls.insert[0].table,'leads_intake');
  assert.equal(calls.insert[0].input.phone,'+5513999999999'); assert.equal(calls.insert[0].input.stage,'novo');
  assert.ok(!JSON.stringify(calls.insert).includes('valid-test-token'));
});
