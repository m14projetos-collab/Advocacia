import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
export const actor = "10000000-0000-0000-0000-000000000001",
  clientId = "20000000-0000-0000-0000-000000000001",
  caseId = "30000000-0000-0000-0000-000000000001",
  requestId = "40000000-0000-0000-0000-000000000001";
export function cnj() {
  const first = "1234567",
    tail = "20268260000";
  let rest = 0;
  for (const d of first + tail + "00") rest = (rest * 10 + Number(d)) % 97;
  return first + String(98 - rest).padStart(2, "0") + tail;
}
export function runtime(endpoint, options = {}) {
  const calls = {
    rpc: [],
    fetch: [],
    upload: [],
    signed: [],
    smtp: [],
    model: [],
    queries: [],
  };
  let handler;
  const env = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    APP_ORIGIN: "https://portal.example.test",
    WHATSAPP_ENABLED: "true",
    WHATSAPP_PROVIDER: "meta",
    WHATSAPP_PHONE_NUMBER_ID: "123456",
    WHATSAPP_ACCESS_TOKEN: "meta-test-token",
    META_GRAPH_VERSION: "v24.0",
    META_APP_SECRET: "meta-secret",
    WHATSAPP_VERIFY_TOKEN: "verify-test",
    EVOLUTION_INSTANCE: "office",
    EVOLUTION_API_URL: "https://evolution.example.test",
    EVOLUTION_API_KEY: "evolution-test-key",
    EVOLUTION_WEBHOOK_TOKEN: "i".repeat(40),
    WHATSAPP_RELAY_SECRET: "r".repeat(40),
    LEGAL_AI_ENABLED: "true",
    AI_GATEWAY_API_KEY: "gateway-secret",
    LEGAL_AI_MODEL: "test/model",
    DATAJUD_API_KEY: "cnj-test-key",
    ...options.env,
  };
  const snapshot = {
    client_id: clientId,
    case_id: caseId,
    lead_id: null,
    client: { id: clientId, full_name: "Cliente de Teste" },
    case: {
      id: caseId,
      title: "Caso",
      cnj_number: cnj(),
      is_confidential: options.confidential === true,
    },
    messages: [
      { case_id: caseId, content: "Dado do caso", direction: "inbound" },
    ],
    appointments: [],
    ...options.snapshot,
  };
  const config = {
    id: 1,
    oab_guardrails_enabled: true,
    tone_examples_json: [{ input: "Exemplo", output: "Tom real" }],
    practice_knowledge_json: { contratos: "Orientação interna" },
    document_ai_enabled: options.documentAI === true,
  };
  let doc = options.existingDoc ?? null;
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: options.invalid ? null : { id: actor } },
        error: options.invalid ? { message: "invalid" } : null,
      }),
    },
    from(table) {
      const filters = {};
      const chain = {
        select() {
          return chain;
        },
        eq(key, value) {
          filters[key] = value;
          return chain;
        },
        async maybeSingle() {
          calls.queries.push({ table, filters });
          return {
            data:
              table === "profiles"
                ? options.inactive
                  ? null
                  : { id: actor, role: options.role ?? "staff" }
                : table === "email_triage"
                  ? (options.existingEmail??null)
                : table === "case_documents"
                  ? doc
                  : null,
            error: null,
          };
        },
        async single() {
          return { data: table === "agent_config" ? config : doc, error: null };
        },
      };
      return chain;
    },
    storage: {
      from(bucket) {
        return {
          async upload(file, bytes, args) {
            calls.upload.push({ bucket, file, bytes, args });
            return { data: { path: file }, error: null };
          },
          async download() {
            return {
              data: new Blob(["%PDF-1.7\nTest"], { type: "application/pdf" }),
              error: null,
            };
          },
          async createSignedUrl(file, expires, args) {
            calls.signed.push({ bucket, file, expires, args });
            return {
              data: {
                signedUrl:
                  "https://test.supabase.co/storage/v1/object/sign/case-files/test?token=temporary",
              },
              error: null,
            };
          },
        };
      },
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if(options.rpc){const override=await options.rpc(name,args);if(override!==undefined)return override;}
      let result = { ok: true };
      if (name === "office_phase5_action") {
        if (args.p_action === "snapshot") result = snapshot;
        if (args.p_action.startsWith("config_")) {
          if (options.role !== "admin")
            return {
              error: { code: "42501", message: "Somente administrador." },
              data: null,
            };
          result = config;
        }
        if (args.p_action === "outbox")
          result = {
            send: !options.replay,
            phone: "+5513999999999",
            message: {
              content: args.p_data.content,
              send_state: options.replay ? "unknown" : "pending",
            },
          };
        if (args.p_action === "sent")
          result = {
            id: requestId,
            send_state: args.p_data.external_id ? "sent" : "unknown",
          };
        if (args.p_action === "file_add") {
          doc = { ...args.p_data, case_id: caseId };
          result = doc;
        }
        if (args.p_action === "file_access")
          result = {
            id: requestId,
            case_id: caseId,
            size_bytes: 100,
            mime_type: "application/pdf",
            storage_path: caseId + "/document.pdf",
            original_name: "document.pdf",
          };
        if (args.p_action === "ai_start")
          result = {
            generate: true,
            run: { id: requestId, status: "pending" },
          };
        if (args.p_action === "ai_finish")
          result = {
            id: requestId,
            status: args.p_data.content ? "draft" : "failed",
            content: args.p_data.content,
          };
        if (args.p_action === "datajud_store") result = args.p_data;
      }
      return { data: result, error: null };
    },
  };
  const context = vm.createContext({
    Request,
    Response,
    Headers,
    URL,
    Blob,
    File,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,atob,Intl,ReadableStream,WritableStream,
    AbortController,
    AbortSignal,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console,
    Deno: {
      env: { get: (key) => env[key] },
      connectTls: options.connectTls,
      serve: (fn) => {
        handler = fn;
      },
    },
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, init });
      if(options.fetch)return options.fetch(url,init);
      if (options.fetchThrows) throw new Error("provider unavailable");
      if (url.includes("graph.facebook.com"))
        return Response.json({ messages: [{ id: "wamid.confirmed" }] });
      if (url.includes("evolution.example.test"))
        return Response.json({ key: { id: "evo-confirmed" } });
      if (url.includes("datajud.cnj.jus.br"))
        return Response.json({
          hits: {
            hits: options.notFound
              ? []
              : [
                  {
                    _source: {
                      numeroProcesso: cnj(),
                      nivelSigilo: 0,
                      tribunal: "TJSP",
                      classe: { nome: "Classe pública" },
                      movimentos: [],
                    },
                  },
                ],
          },
        });
      return Response.json({ ok: true });
    },
  });
  const cache = new Map();
  function load(filename) {
    if (filename.startsWith("npm:@supabase")) return { createClient: () => db };
    if (filename.startsWith("npm:ai@"))
      return {
        createGateway:
          ({ apiKey }) =>
          (model) => ({ model, apiKey }),
        generateText: async (args) => {
          calls.model.push(args);
          return { text: options.aiText??"Fatos disponíveis e lacunas para revisão humana." };
        },
      };
    const full = path.resolve(filename);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} };
    cache.set(full, module);
    const source = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(
      (name) =>
        load(
          name.startsWith("npm:")
            ? name
            : path.resolve(path.dirname(full), name),
        ),
      module,
      module.exports,
    );
    return module.exports;
  }
  load(`supabase/functions/${endpoint}/index.ts`);
  return {
    calls,
    env,
    snapshot,
    run: (data = {}, opts = {}) => {
      const raw = typeof data === "string" ? data : JSON.stringify(data);
      const multipart = data instanceof FormData;
      return handler(
        new Request(
          opts.url ?? `https://test.supabase.co/functions/v1/${endpoint}`,
          {
            method: opts.method ?? "POST",
            headers: {
              ...(multipart ? {} : { "Content-Type": "application/json" }),
              Origin: "https://portal.example.test",
              ...(opts.auth === false
                ? {}
                : { Authorization: "Bearer user-token" }),
              ...opts.headers,
            },
            ...((opts.method ?? "POST") === "GET"
              ? {}
              : { body: multipart ? data : raw }),
          },
        ),
      );
    },
  };
}
