import { expect, test } from "@playwright/test";
import { api, lead, login, user } from "./fixtures";
const caseId = "30000000-0000-0000-0000-000000000001",
  clientId = "20000000-0000-0000-0000-000000000001";

test("Minha Conta exibe perfil e valida senha mínima/confirmada antes de updateUser", async ({
  page,
}) => {
  const calls = await api(page);
  await login(page);
  await page.getByRole("link", { name: /Minha Conta/ }).click();
  await expect(
    page.getByRole("heading", { name: "Equipe Teste" }),
  ).toBeVisible();
  await expect(page.getByText("123456/SP", { exact: true })).toBeVisible();
  const password = page.getByLabel("Nova senha", { exact: true }),
    confirm = page.getByLabel("Confirmar nova senha");
  await password.fill("1234567");
  await confirm.fill("1234567");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("alert")).toContainText("pelo menos 8");
  await password.fill("SenhaNova123!");
  await confirm.fill("Diferente123!");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("alert")).toContainText("não corresponde");
  expect(
    calls.filter((c) => c.path.endsWith("/user") && c.method === "PUT"),
  ).toHaveLength(0);
  await confirm.fill("SenhaNova123!");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Senha alterada com sucesso" }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.path.endsWith("/user") && c.method === "PUT")?.body,
  ).toMatchObject({ password: "SenhaNova123!" });
  await expect(password).toHaveValue("");
  await expect(confirm).toHaveValue("");
  expect(
    calls.some((c) => c.path.endsWith("/profiles") && c.method !== "GET"),
  ).toBe(false);
});

test("erro da política de senha e reautenticação aparecem sem simular sucesso", async ({
  page,
}) => {
  await api(page);
  await login(page);
  await page.getByRole("link", { name: /Minha Conta/ }).click();
  await page.route("https://crm-test.supabase.co/auth/v1/user", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 422,
          json: {
            code: "reauthentication_needed",
            error_code: "reauthentication_needed",
            msg: "Reauthentication required",
          },
        })
      : route.fulfill({ json: user }),
  );
  await page.getByLabel("Nova senha", { exact: true }).fill("SenhaNova123!");
  await page.getByLabel("Confirmar nova senha").fill("SenhaNova123!");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Reautenticação necessária",
  );
  await page.getByText("Reautenticação e senha atual", { exact: true }).click();
  await page
    .getByRole("button", { name: "Solicitar código de segurança" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Código solicitado" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Código de segurança", { exact: true }),
  ).toBeVisible();
});

test("agenda cria/edita por Edge, interpreta São Paulo e calculadora usa vencimento conferido", async ({
  page,
}) => {
  await api(page);
  const records: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route(
    "https://crm-test.supabase.co/rest/v1/appointments*",
    (route) => route.fulfill({ json: records }),
  );
  await page.route(
    "https://crm-test.supabase.co/functions/v1/appointments",
    async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      const saved = {
        id: body.id,
        ...body.appointment,
        updated_at: "2030-03-01T00:00:00Z",
      };
      const index = records.findIndex((a) => a.id === body.id);
      if (index >= 0) records[index] = saved;
      else records.push(saved);
      await route.fulfill({ json: { appointment: saved } });
    },
  );
  await login(page);
  await page.getByRole("link", { name: /Agenda/ }).click();
  await page.getByLabel("Mês da agenda").fill("2030-03");
  await page
    .getByRole("button", { name: "Novo compromisso", exact: true })
    .click();
  await page.getByLabel("Título do compromisso").fill("Consulta de teste");
  await page.getByLabel("Início (São Paulo)").fill("2030-03-01T09:00");
  await page.getByLabel("Fim (São Paulo)").fill("2030-03-01T10:00");
  await page.getByRole("button", { name: "Salvar compromisso" }).click();
  await expect(
    page.getByRole("heading", { name: "Consulta de teste" }),
  ).toBeVisible();
  expect(writes[0]).toMatchObject({
    appointment: {
      starts_at: "2030-03-01T12:00:00.000Z",
      ends_at: "2030-03-01T13:00:00.000Z",
    },
    expected_updated_at: null,
  });
  await page
    .getByRole("button", { name: "Editar compromisso", exact: true })
    .click();
  await page.getByLabel("Título do compromisso").fill("Consulta revisada");
  await page.getByRole("button", { name: "Salvar compromisso" }).click();
  expect(writes[1]).toMatchObject({
    expected_updated_at: "2030-03-01T00:00:00Z",
  });
  await expect(
    page.getByRole("heading", { name: "Consulta revisada" }),
  ).toBeVisible();
  await page
    .getByText("Calculadora auxiliar de prazos · CPC", { exact: true })
    .click();
  await page.getByLabel("Data de referência").fill("2030-03-01");
  await page.getByLabel("Dias úteis", { exact: true }).fill("1");
  await page.getByRole("checkbox", { name: /Conferi o termo inicial/ }).check();
  await page.getByRole("button", { name: "Calcular vencimento" }).click();
  await expect(
    page.getByRole("heading", { name: "Vencimento auxiliar: 04/03/2030" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Usar data em novo prazo" }).click();
  await expect(page.getByLabel("Tipo de compromisso")).toHaveValue("prazo");
  await expect(page.getByLabel("Início (São Paulo)")).toHaveValue(
    "2030-03-04T09:00",
  );
  await page.getByLabel("Dias úteis", { exact: true }).fill("2");
  await expect(
    page.getByRole("heading", { name: /Vencimento auxiliar/ }),
  ).toHaveCount(0);
});

test("agenda apresenta conflito e preserva edição quando a Edge rejeita", async ({
  page,
}) => {
  await api(page);
  await page.route(
    "https://crm-test.supabase.co/functions/v1/appointments",
    (route) =>
      route.fulfill({
        status: 409,
        json: { error: "Conflito de horário na agenda do escritório." },
      }),
  );
  await login(page);
  await page.getByRole("link", { name: /Agenda/ }).click();
  await page
    .getByRole("button", { name: "Novo compromisso", exact: true })
    .click();
  await page.getByLabel("Título do compromisso").fill("Conflito de teste");
  await page.getByRole("button", { name: "Salvar compromisso" }).click();
  await expect(page.getByRole("alert")).toContainText("Conflito de horário");
  await expect(page.getByLabel("Título do compromisso")).toHaveValue(
    "Conflito de teste",
  );
});

test("financeiro cria cobrança com UUID estável, vincula consulta e confere no provedor", async ({
  page,
}) => {
  const calls = await api(page);
  let payments: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  await page.route("https://crm-test.supabase.co/rest/v1/clients*", (route) =>
    route.fulfill({
      json: [
        {
          id: clientId,
          full_name: "Cliente Financeiro",
          document_type: "cpf",
          document_number: "52998224725",
          phone: lead.phone,
          email: null,
          address_json: {},
        },
      ],
    }),
  );
  await page.route("https://crm-test.supabase.co/rest/v1/cases*", (route) =>
    route.fulfill({
      json: [
        {
          id: caseId,
          client_id: clientId,
          title: "Caso Financeiro",
          status: "ativo",
          practice_area: "contratos",
        },
      ],
    }),
  );
  await page.route(
    "https://crm-test.supabase.co/rest/v1/appointments*",
    (route) =>
      route.fulfill({
        json: [
          {
            id: caseId,
            title: "Consulta paga",
            case_id: caseId,
            lead_id: null,
            starts_at: "2030-03-01T12:00:00Z",
          },
        ],
      }),
  );
  await page.route("https://crm-test.supabase.co/rest/v1/payments*", (route) =>
    route.fulfill({ json: payments }),
  );
  await page.route(
    "https://crm-test.supabase.co/functions/v1/infinitepay-checkout",
    async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (body.operation === "verify") {
        payments = payments.map((p) => ({ ...p, status: "paid" }));
        await route.fulfill({ json: { duplicate: false } });
        return;
      }
      const payment = {
        id: body.id,
        order_nsu: body.id,
        ...body.payment,
        status: "pending",
        checkout_url: "https://checkout.infinitepay.io/test",
        checkout_state: "ready",
        review_required: false,
        created_at: "2030-03-01T12:00:00Z",
      };
      payments = [payment];
      await route.fulfill({ status: 201, json: { payment } });
    },
  );
  await login(page);
  await page.getByRole("link", { name: /Financeiro/ }).click();
  await page.getByText("Nova cobrança InfinitePay", { exact: true }).click();
  await page.getByLabel("Cliente da cobrança").selectOption(clientId);
  await page.getByLabel("Consulta vinculada").selectOption(caseId);
  await page.getByLabel("Descrição interna").fill("Consulta inicial");
  await page.getByLabel("Valor em reais").fill("150,00");
  await page.getByRole("button", { name: "Criar link de pagamento" }).click();
  await expect(
    page.getByRole("link", { name: "Abrir checkout ↗" }),
  ).toBeVisible();
  expect(requests[0]).toMatchObject({
    payment: {
      amount_cents: 15000,
      appointment_id: caseId,
      case_id: caseId,
      client_id: clientId,
    },
  });
  expect(requests[0].id).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Conferir no provedor" }).click();
  await page.getByLabel("Identificador da transação").fill("transaction-test");
  await page.getByLabel("Código da fatura (slug)").fill("slug-test");
  await page.getByRole("button", { name: "Consultar confirmação" }).click();
  await expect(page.getByRole("cell", { name: /^Pago/ })).toBeVisible();
  expect(requests[1]).toMatchObject({
    id: requests[0].id,
    operation: "verify",
    transaction_nsu: "transaction-test",
    slug: "slug-test",
  });
  expect(
    calls.some(
      (call) =>
        ["/payments", "/appointments"].some((table) =>
          call.path.endsWith(table),
        ) && call.method !== "GET",
    ),
  ).toBe(false);
});

test("retorno público não confirma por parâmetros e remove identificadores da URL", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://crm-test.supabase.co/**", (route) => {
    requests++;
    return route.fulfill({ json: {} });
  });
  await page.goto(
    "/pagamento/retorno?order_nsu=forjado&status=paid&receipt_url=https://attacker.test",
  );
  await expect(
    page.getByRole("heading", { name: "Retorno do pagamento" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/pagamento\/retorno$/);
  expect(requests).toBe(0);
});

test('agenda e segurança continuam utilizáveis no celular', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api(page); await login(page);
  await page.getByRole('link', { name: /Agenda/ }).click();
  await expect(page.getByLabel('Calendário mensal')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('agenda-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: /Minha Conta/ }).click();
  await expect(page.getByLabel('Nova senha', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
