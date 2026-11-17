import { expect, test, Page } from "@playwright/test";
import { api, lead, login, user } from "./fixtures";
const clientId = "20000000-0000-0000-0000-000000000001",
  caseId = "30000000-0000-0000-0000-000000000001",
  docId = "40000000-0000-0000-0000-000000000001";
async function setup(page: Page, role = "staff") {
  await api(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  const client = {
    id: clientId,
    full_name: "Cliente do Hub",
    phone: lead.phone,
    email: null,
    document_type: "cpf",
    document_number: "52998224725",
    address_json: {},
  };
  const record = { ...lead, stage: "fechado", converted_client_id: clientId };
  const matter = {
    id: caseId,
    client_id: clientId,
    source_lead_id: lead.id,
    title: "Caso integrado",
    practice_area: "contratos",
    status: "ativo",
    cnj_number: null,
    is_confidential: true,
    ai_summary: null,
    updated_at: "2030-03-01T00:00:00Z",
  };
  const snapshot = {
    lead_id: lead.id,
    client_id: clientId,
    case_id: caseId,
    lead: record,
    client,
    case: matter,
    cases: [matter],
    phone: lead.phone,
    actor: { role, full_name: "Equipe Teste" },
    messages: [
      {
        id: docId,
        lead_id: lead.id,
        client_id: clientId,
        case_id: null,
        direction: "inbound",
        content: "Mensagem recebida no cliente",
        send_state: "received",
        provider: "meta",
        created_at: "2030-03-01T12:00:00Z",
      },
    ],
    calls: [] as Record<string, unknown>[],
    documents: [
      {
        id: docId,
        original_name: "autos-privados.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        created_at: "2030-03-01T12:00:00Z",
      },
    ],
    ai_runs: [] as Record<string, unknown>[],
    appointments: [],
    payments: [],
    lookups: [],
    has_more: false,
  };
  const calls: {
    name: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  await page.route("https://crm-test.supabase.co/rest/v1/profiles*", (route) =>
    route.fulfill({
      json: { id: user.id, full_name: "Equipe Teste", role, is_active: true },
    }),
  );
  for (const [table, data] of [
    ["clients", [client]],
    ["cases", [matter]],
    ["leads_intake", [record]],
  ] as const)
    await page.route(
      `https://crm-test.supabase.co/rest/v1/${table}*`,
      (route) => route.fulfill({ json: data }),
    );
  await page.route(
    "https://crm-test.supabase.co/functions/v1/**",
    async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!;
      if (
        name === "case-files" &&
        route
          .request()
          .headers()
          ["content-type"]?.includes("multipart/form-data")
      ) {
        calls.push({
          name,
          body: { multipart: true },
          headers: route.request().headers(),
        });
        await route.fulfill({ status: 201, json: { id: docId } });
        return;
      }
      const body = route.request().postDataJSON();
      calls.push({ name, body, headers: route.request().headers() });
      let result: unknown = {};
      if (name === "case-hub") {
        if (body.operation === "message_case")
          snapshot.messages[0].case_id = caseId;
        if (body.operation === "case_update") {
          matter.cnj_number = body.cnj_number;
          matter.is_confidential = body.is_confidential;
        }
        result = snapshot;
      } else if (name === "whatsapp-send") {
        if (body.operation === "call")
          snapshot.calls.push({
            id: docId,
            notes: body.notes,
            direction: body.direction,
            outcome: body.outcome,
            created_at: "2030-03-01T12:00:00Z",
          });
        result = { id: docId, send_state: "sent" };
      } else if (name === "case-files")
        result = {
          url: "https://crm-test.supabase.co/storage/v1/object/sign/case-files/autos.pdf?token=short",
          expires_in: 60,
        };
      else if (name === "legal-agent") {
        if (body.operation === "config_get" || body.operation === "config_save")
          result = {
            tone_examples_json: [],
            practice_knowledge_json: {},
            document_ai_enabled: false,
            oab_guardrails_enabled: true,
            updated_at: "2030-03-01T00:00:00Z",
          };
        else {
          result = {
            id: docId,
            task: body.task,
            status: "draft",
            content:
              "RASCUNHO INTERNO — Mensagem preparada para revisão humana.",
          };
          snapshot.ai_runs = [result as Record<string, unknown>];
        }
      }
      await route.fulfill({ json: result });
    },
  );
  return { snapshot, calls, errors };
}
async function hub(page: Page) {
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Funil de atendimento", exact: true }),
  ).toBeVisible();
  await page.goto(`/crm/hub?case_id=${caseId}`);
  await expect(
    page.getByRole("heading", { name: "Caso integrado", exact: true }),
  ).toBeVisible();
}

test("ficha preserva contexto, vincula mensagem, envia resposta revisada e registra ligação", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await hub(page);
  await expect(
    page.getByText("Mensagem recebida no cliente", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Vincular esta mensagem ao caso atual" })
    .click();
  await expect(
    page.getByRole("button", { name: "Vincular esta mensagem ao caso atual" }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Resposta no WhatsApp", exact: true })
    .fill("Resposta conferida pela equipe.");
  await expect(
    page.getByRole("button", { name: "Enviar resposta revisada" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "Revisei o destinatário, o sigilo e o conteúdo da resposta.",
    })
    .check();
  await page.getByRole("button", { name: "Enviar resposta revisada" }).click();
  expect(
    calls.find((c) => c.name === "whatsapp-send" && !c.body.operation)?.body,
  ).toMatchObject({
    context: { case_id: caseId },
    content: "Resposta conferida pela equipe.",
    reviewed: true,
  });
  await page.getByText("Registrar ligação no card", { exact: true }).click();
  await page
    .getByLabel("Registro da ligação", { exact: true })
    .fill("Cliente pediu retorno amanhã.");
  await page
    .getByRole("button", { name: "Salvar registro da ligação" })
    .click();
  await expect(
    page.getByText("Cliente pediu retorno amanhã.", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("documento e IA ficam no caso; gerar rascunho não envia WhatsApp automaticamente", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await hub(page);
  await page.getByRole("tab", { name: "Documentos privados" }).click();
  await page.getByRole("button", { name: "Gerar acesso de 60s" }).click();
  await expect(
    page.getByRole("link", { name: "Baixar autos-privados.pdf ↗" }),
  ).toHaveAttribute("href", /\/object\/sign\/case-files/);
  await page
    .getByLabel("Arquivo do caso")
    .setInputFiles({
      name: "teste.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nTest"),
    });
  await page.getByRole("button", { name: "Enviar documento privado" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Documento armazenado" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Agente IA", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Gerar rascunho interno" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /Autorizo o processamento/ })
    .check();
  await page.getByRole("button", { name: "Gerar rascunho interno" }).click();
  await expect(page.getByLabel("Texto para revisão")).toHaveValue(
    /RASCUNHO INTERNO/,
  );
  expect(calls.filter((c) => c.name === "whatsapp-send")).toHaveLength(0);
  await page
    .getByRole("checkbox", {
      name: "Revisei fatos, sigilo e conteúdo jurídico deste texto.",
    })
    .check();
  await page
    .getByRole("button", {
      name: "Usar texto revisado no compositor de resposta",
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Resposta no WhatsApp", exact: true }),
  ).toHaveValue(/RASCUNHO INTERNO/);
  await expect(
    page.getByRole("button", { name: "Enviar resposta revisada" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("admin configura estilo; staff não recebe o menu de administração", async ({
  page,
}) => {
  await setup(page);
  await hub(page);
  await expect(
    page.getByRole("link", { name: /Configuração do Agente/ }),
  ).toHaveCount(0);
  await page.goto("/crm/agente");
  await expect(page.getByRole("alert")).toContainText(
    "reservada ao administrador",
  );
});
test("admin tem configuração com exemplos reais e trava OAB sem opção de desligar", async ({
  page,
}) => {
  const { calls, errors } = await setup(page, "admin");
  await login(page);
  await page.getByRole("link", { name: /Configuração do Agente/ }).click();
  await page.getByRole("button", { name: "Adicionar exemplo real" }).click();
  await page
    .getByLabel("Entrada do exemplo 1")
    .fill("Como organizamos uma reunião?");
  await page
    .getByLabel("Resposta do Matheus 1")
    .fill("Vamos reunir os documentos e confirmar o horário com a equipe.");
  await expect(
    page.getByRole("checkbox", { name: "Trava ética OAB sempre ativa" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Trava ética OAB sempre ativa" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Salvar configuração do agente" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Estilo e base" }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.body.operation === "config_save")?.body.config,
  ).toMatchObject({ oab_guardrails_enabled: true });
  expect(errors).toEqual([]);
});
test("atalho do caso preenche agenda e cobrança sem recadastrar cliente", async ({
  page,
}) => {
  await setup(page);
  await hub(page);
  await page.getByRole("link", { name: "Agendar neste contexto →" }).click();
  await page
    .getByRole("button", { name: "Novo compromisso", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Caso vinculado", exact: true }),
  ).toHaveValue(caseId);
  await expect(
    page.getByRole("combobox", { name: "Atendimento vinculado", exact: true }),
  ).toHaveValue(lead.id);
  await page.goto(`/crm/hub?case_id=${caseId}`);
  await page.getByRole("link", { name: "Cobrar deste cliente →" }).click();
  await expect(page.getByLabel("Cliente da cobrança")).toHaveValue(clientId);
  await expect(page.getByLabel("Caso da cobrança")).toHaveValue(caseId);
});
test("desktop e mobile não possuem links internos vazios, âncoras inexistentes ou erros de console", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await hub(page);
  const hrefs = await page
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(
    hrefs.every(
      (href) =>
        Boolean(href) && href !== "#" && !href!.startsWith("javascript:"),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Caso integrado", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/");
  for (const href of await page
    .locator('a[href^="#"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!)))
    await expect(page.locator(href)).toHaveCount(1);
  expect(errors).toEqual([]);
});
