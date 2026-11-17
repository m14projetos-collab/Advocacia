import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
const actor = "10000000-0000-0000-0000-000000000001",
  paymentId = "40000000-0000-0000-0000-000000000001";
const payment = {
  id: paymentId,
  order_nsu: paymentId,
  amount_cents: 15000,
  fee_type: "consulta",
  status: "pending",
  checkout_url: null,
};
function runtime(endpoint, options = {}) {
  const calls = { rpc: [], provider: [], auth: [] };
  let handler;
  const env = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    APP_ORIGIN: "https://portal.example.test",
    PUBLIC_APP_URL: "https://portal.example.test",
    INFINITEPAY_ENABLED: "true",
    INFINITEPAY_HANDLE: "matheus-moraes-tsd",
    ...options.env,
  };
  const db = {
    auth: {
      getUser: async (token) => {
        calls.auth.push(token);
        return {
          data: { user: options.invalid ? null : { id: actor } },
          error: options.invalid ? { message: "invalid" } : null,
        };
      },
    },
    from: (table) => {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle: async () => ({
          data:
            table === "profiles"
              ? options.inactive
                ? null
                : { id: actor }
              : options.noPayment
                ? null
                : payment,
          error: null,
        }),
      };
      return chain;
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (options.rpcError)
        return { data: null, error: { message: "DB failure", code: "40001" } };
      if (name === "office_prepare_checkout")
        return {
          data: { payment, create_link: options.existing !== true },
          error: null,
        };
      if (name === "office_store_checkout")
        return {
          data: {
            ...payment,
            checkout_url: args.p_url,
            checkout_state: args.p_url ? "ready" : "unknown",
          },
          error: null,
        };
      return {
        data:
          name === "office_save_appointment"
            ? { id: args.p_id, ...args.p_data }
            : { duplicate: false },
        error: null,
      };
    },
  };
  const context = vm.createContext({
    Request,
    Response,
    URL,
    Headers,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
    console,
    Deno: {
      env: { get: (key) => env[key] },
      serve: (fn) => {
        handler = fn;
      },
    },
    fetch: async (url, init) => {
      const data = JSON.parse(init.body);
      calls.provider.push({ url, data, headers: init.headers });
      if (options.providerThrows) throw new Error("network");
      return Response.json(
        url.endsWith("/links")
          ? {
              url: options.badUrl
                ? "https://attacker.test/link"
                : "https://checkout.infinitepay.io/test",
            }
          : {
              success: true,
              paid: true,
              amount: 15000,
              paid_amount: 15100,
              capture_method: "pix",
              ...options.verified,
            },
      );
    },
  });
  const cache = new Map();
  function load(filename) {
    if (filename.startsWith("npm:")) return { createClient: () => db };
    const full = path.resolve(filename);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} };
    cache.set(full, module);
    const code = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const fn = vm.runInContext(
      `(function(require,module,exports){${code}\n})`,
      context,
    );
    fn(
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
    run: (data = {}, auth = true) =>
      handler(
        new Request(`https://test.supabase.co/functions/v1/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://portal.example.test",
            ...(auth ? { Authorization: "Bearer validated-token" } : {}),
          },
          body: JSON.stringify(data),
        }),
      ),
  };
}
const booking = {
  id: paymentId,
  actor: "forged",
  appointment: {
    title: "Consulta jurídica",
    type: "consulta",
    status: "pendente",
    starts_at: "2030-03-04T12:00:00Z",
    ends_at: "2030-03-04T13:00:00Z",
    payment_required: true,
  },
};
const order = {
  id: paymentId,
  operation: "create",
  actor: "forged",
  payment: {
    client_id: actor,
    description: "Resumo jurídico confidencial",
    amount_cents: 15000,
    fee_type: "consulta",
  },
};
const notice = {
  order_nsu: paymentId,
  transaction_nsu: "transaction-test",
  invoice_slug: "invoice-test",
  status: "paid",
  amount: 1,
};

test("Edge agenda exige JWT e membro ativo; ignora ator forjado e valida URL", async () => {
  for (const [options, auth, status] of [
    [{}, false, 401],
    [{ invalid: true }, true, 401],
    [{ inactive: true }, true, 403],
  ]) {
    const app = runtime("appointments", options);
    assert.equal((await app.run(booking, auth)).status, status);
    assert.equal(app.calls.rpc.length, 0);
  }
  const app = runtime("appointments");
  assert.equal((await app.run(booking)).status, 200);
  assert.equal(app.calls.rpc[0].args.p_actor, actor);
  assert.equal(app.calls.auth[0], "validated-token");
  assert.equal(
    (
      await app.run({
        ...booking,
        appointment: {
          ...booking.appointment,
          meeting_url: "javascript:alert(1)",
        },
      })
    ).status,
    400,
  );
});
test("checkout usa valor persistido, handle e order_nsu=UUID, sem enviar descrição jurídica", async () => {
  const app = runtime("infinitepay-checkout", {
    env: { INFINITEPAY_API_KEY: "test-key" },
  });
  assert.equal((await app.run(order)).status, 201);
  const request = app.calls.provider[0];
  assert.equal(request.url, "https://api.checkout.infinitepay.io/links");
  assert.equal(request.data.handle, "matheus-moraes-tsd");
  assert.equal(request.data.order_nsu, paymentId);
  assert.equal(request.data.items[0].price, 15000);
  assert.equal(request.data.options.single_payment, true);
  assert.equal(request.headers["X-Api-Key"], "test-key");
  assert.equal(
    request.data.webhook_url,
    "https://test.supabase.co/functions/v1/infinitepay-webhook",
  );
  assert.equal(
    request.data.redirect_url,
    "https://portal.example.test/pagamento/retorno",
  );
  assert.ok(!JSON.stringify(request.data).includes("confidencial"));
});
test("checkout bloqueia inativo/configuração/valor incorreto e não recria ordem existente", async () => {
  for (const [options, status] of [
    [{ inactive: true }, 403],
    [{ env: { INFINITEPAY_ENABLED: "false" } }, 503],
    [{ env: { INFINITEPAY_HANDLE: "another-account" } }, 503],
  ]) {
    const app = runtime("infinitepay-checkout", options);
    assert.equal((await app.run(order)).status, status);
    assert.equal(app.calls.provider.length, 0);
  }
  const invalid = runtime("infinitepay-checkout");
  assert.equal(
    (
      await invalid.run({
        ...order,
        payment: { ...order.payment, amount_cents: 99 },
      })
    ).status,
    400,
  );
  assert.equal(invalid.calls.provider.length, 0);
  const retry = runtime("infinitepay-checkout", { existing: true });
  assert.equal((await retry.run(order)).status, 202);
  assert.equal(retry.calls.provider.length, 0);
});
test("falha/URL externa na criação preserva ordem para conferência sem confirmar pagamento", async () => {
  for (const options of [{ providerThrows: true }, { badUrl: true }]) {
    const app = runtime("infinitepay-checkout", options);
    assert.equal((await app.run(order)).status, 502);
    assert.equal(app.calls.rpc.at(-1).name, "office_store_checkout");
    assert.equal(app.calls.rpc.at(-1).args.p_url, null);
    assert.ok(!app.calls.rpc.some((c) => c.name === "office_confirm_payment"));
  }
});
test("webhook sem assinatura só baixa após consulta fixa ao provedor; valor do aviso não é confiável", async () => {
  const app = runtime("infinitepay-webhook");
  assert.equal((await app.run(notice, false)).status, 200);
  assert.equal(
    app.calls.provider[0].url,
    "https://api.checkout.infinitepay.io/payment_check",
  );
  assert.equal(app.calls.provider[0].data.order_nsu, paymentId);
  assert.equal(app.calls.provider[0].data.slug, "invoice-test");
  assert.equal(app.calls.rpc[0].name, "office_confirm_payment");
  assert.equal(app.calls.rpc[0].args.p_amount, 15000);
  assert.match(app.calls.rpc[0].args.p_payload_hash, /^[0-9a-f]{64}$/);
});
test("webhook falso, não pago, valor divergente ou provedor indisponível não baixa nem libera agenda", async () => {
  for (const options of [
    { verified: { paid: false } },
    { verified: { success: false } },
    { verified: { amount: 14999 } },
    { providerThrows: true },
  ]) {
    const app = runtime("infinitepay-webhook", options);
    assert.ok((await app.run(notice, false)).status >= 400);
    assert.equal(app.calls.rpc.length, 0);
  }
  const ignored = runtime("infinitepay-webhook");
  assert.equal(
    (await ignored.run({ ...notice, event: "refunded" }, false)).status,
    200,
  );
  assert.equal(ignored.calls.provider.length, 0);
  assert.equal(ignored.calls.rpc.length, 0);
});
test("conferência manual autenticada usa o mesmo caminho de validação do webhook", async () => {
  const app = runtime("infinitepay-checkout");
  assert.equal(
    (
      await app.run({
        id: paymentId,
        operation: "verify",
        transaction_nsu: "transaction-test",
        slug: "invoice-test",
      })
    ).status,
    200,
  );
  assert.equal(
    app.calls.provider[0].url,
    "https://api.checkout.infinitepay.io/payment_check",
  );
  assert.equal(app.calls.rpc[0].name, "office_confirm_payment");
});
