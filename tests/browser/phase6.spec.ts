import { expect, test, Page } from "@playwright/test";
import { api, lead, login, user } from "./fixtures";
const clientId = "61000000-0000-0000-0000-000000000001",
  caseId = "62000000-0000-0000-0000-000000000001",
  paymentId = "63000000-0000-0000-0000-000000000001",
  appointmentId = "64000000-0000-0000-0000-000000000001",
  emailId = "65000000-0000-0000-0000-000000000001";
async function setup(page: Page, role = "admin") {
  await api(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  const calls: { name: string; body: Record<string, any> }[] = [],
    profile = {
      id: user.id,
      full_name: "Matheus Teste",
      oab_number: "123456",
      oab_uf: "SP",
      phone: lead.phone,
      bio: "Bio Teste",
      role,
      is_active: true,
      updated_at: "2026-11-17T00:00:00Z",
    },
    client = {
      id: clientId,
      full_name: "Joana da Silva",
      document_type: "cpf",
      document_number: "52998224725",
      phone: lead.phone,
      email: "joana@example.test",
      address_json: { street: "Rua Teste", city: "Santos" },
      created_at: "2026-11-16T10:00:00Z",
      updated_at: "2026-11-17T00:00:00Z",
    },
    matter = {
      id: caseId,
      client_id: clientId,
      source_lead_id: lead.id,
      title: "Acompanhamento familiar",
      practice_area: "familia_sucessoes",
      status: "ativo",
      cnj_number: "12345678920268260000",
      is_confidential: true,
      ai_summary: "Resumo já revisado.",
      updated_at: "2026-11-17T00:00:00Z",
    },
    appointment = {
      id: appointmentId,
      title: "Reunião com Joana",
      type: "consulta",
      starts_at: "2026-11-17T12:00:00Z",
      ends_at: "2026-11-17T13:00:00Z",
      status: "confirmado",
      case_id: caseId,
      lead_id: lead.id,
    },
    payment = {
      id: paymentId,
      client_id: clientId,
      case_id: caseId,
      description: "Honorários acordados",
      amount_cents: 15000,
      status: "pending",
      due_date: "2026-11-16",
      checkout_url: "https://pay.infinitepay.io/test",
      checkout_state: "ready",
      created_at: "2026-11-16T10:00:00Z",
    };
  const email = {
    id: emailId,
    sender: "tribunal@example.test",
    subject: "Intimação recebida",
    content: "Confira a intimação e a data de ciência na fonte oficial.",
    priority: "prazo",
    classification_method: "ai",
    cnj_numbers_json: [matter.cnj_number],
    suggested_case_ids: [caseId],
    case_id: null as string | null,
    status: "pending",
    updated_at: "2026-11-17T00:00:00Z",
    received_at: "2026-11-17T10:00:00Z",
  };
  const source = {
    id: "stf",
    title: "Fonte STF",
    area: "geral",
    jurisdiction: "STF",
    official_url: "https://noticias.stf.jus.br/",
    last_checked_at: "2026-11-17T12:00:00Z",
    last_error: null,
  };
  let kits: any[] = [],
    turns: any[] = [],
    history: any[] = [];
  for (const [table, data] of [
    ["profiles", profile],
    ["clients", [client]],
    ["cases", [matter]],
    ["leads_intake", [lead]],
    ["appointments", [appointment]],
    ["payments", [payment]],
  ] as const)
    await page.route(`https://crm-test.supabase.co/rest/v1/${table}*`, (r) =>
      r.fulfill({ json: data }),
    );
  await page.route(
    "https://crm-test.supabase.co/functions/v1/**",
    async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!,
        body = route.request().postDataJSON();
      calls.push({ name, body });
      let data: any = {};
      if (name === "product-hub") {
        if (body.operation === "dashboard")
          data = {
            today: "2026-11-17",
            appointments: [
              appointment,
              {
                ...appointment,
                id: "deadline",
                title: "Prazo de manifestação",
                type: "prazo",
              },
            ],
            unanswered: [lead],
            payments: [payment],
          };
        if (body.operation === "details")
          data = {
            parties: [
              {
                id: "party1",
                full_name: client.full_name,
                party_role: "cliente",
                document_number: client.document_number,
              },
            ],
            conflicts: [],
            emails: history,
            kits,
          };
        if (body.operation === "client_save") {
          Object.assign(client, {
            phone: body.client.phone,
            email: body.client.email,
            address_json: body.client.address_json,
            updated_at: "2026-11-17T13:00:00Z",
          });
          data = client;
        }
        if (body.operation === "profile_save")
          data = {
            ...profile,
            ...body.profile,
            role,
            is_active: true,
            updated_at: "2026-11-17T13:00:00Z",
          };
        if (body.operation === "triage_list")
          data = { items: [email], has_more: false };
        if (body.operation === "triage_review") {
          email.case_id = body.context?.case_id ?? null;
          email.status = body.status;
          data = email;
        }
        if (body.operation === "knowledge")
          data = {
            sources: [source],
            updates: [
              {
                id: "update-1",
                source_id: source.id,
                title: source.title,
                summary: "Trecho oficial de teste para consulta interna.",
                official_url: source.official_url,
                fetched_at: "2026-11-17T12:00:00Z",
              },
            ],
          };
        if (body.operation === "chat_history") data = turns;
      } else if (name === "case-hub")
        data = {
          client_id: clientId,
          lead_id: lead.id,
          case_id: caseId,
          client,
          lead,
          matter,
          case: matter,
          cases: [matter],
          phone: client.phone,
          actor: profile,
          messages: [],
          calls: [],
          documents: [],
          ai_runs: [],
          appointments: [appointment],
          payments: [payment],
          lookups: [],
          has_more: false,
        };
      else if (name === "initial-kit" && body.operation === "review") {
        data = {
          id: body.id,
          created_at: "2026-11-17T12:30:00Z",
          documents: body.documents,
        };
        kits = [data, ...kits];
      } else if (name === "initial-kit") {
        data = {
          id: body.id,
          created_at: "2026-11-17T12:00:00Z",
          documents: [
            "Procuração",
            "Contrato de Honorários",
            "Declaração de Hipossuficiência",
          ].map((title) => ({
            title,
            content: `${title}\n${client.full_name}\nCPF ${client.document_number}\nOAB/SP ${profile.oab_number}\n${body.fields.scope}`,
          })),
        };
        kits = [data, ...kits];
      } else if (name === "email-send") {
        if (body.operation === "preview")
          data = {
            recipient: client.email,
            subject: "Resumo do atendimento",
            content: matter.ai_summary,
            preview_token: "test-hash",
          };
        else {
          data = { pending: false };
          history = [
            {
              id: body.id,
              template: body.template,
              recipient: client.email,
              status: "sent",
              created_at: "2026-11-17T12:00:00Z",
            },
          ];
        }
      } else if (name === "sync-legal-updates")
        data = { results: [{ ok: true }, { ok: false }] };
      else if (name === "legal-copilot") {
        data = {
          id: body.id,
          question: body.question,
          answer: "SUBSÍDIOS OFICIAIS — REVISÃO HUMANA OBRIGATÓRIA",
          status: "draft",
          citations_json: [{ url: source.official_url, title: source.title }],
        };
        turns = [...turns, data];
      }
      await route.fulfill({ json: data });
    },
  );
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Hoje no Escritório", exact: true }),
  ).toBeVisible();
  return { calls, errors, client, matter, profile, email };
}
test("Hoje reúne prazo, reunião, SLA e cobrança vencida; funil mantém indicador", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await expect(
    page.getByRole("heading", { name: "Prazos dos próximos 5 dias" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Prazo de manifestação" }),
  ).toBeVisible();
  await expect(page.getByText(/Vencida 2026-11-16/)).toBeVisible();
  await expect(page.getByText(/SLA excedido/)).toBeVisible();
  await page.getByRole("link", { name: /Funil de atendimento/ }).click();
  await expect(
    page.getByRole("heading", { name: "Funil de atendimento", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/SLA excedido/)).toBeVisible();
  expect(errors).toEqual([]);
});
test("combobox abre registros, pesquisa documento/telefone/CNJ e seleciona por teclado", async ({
  page,
}) => {
  const { errors, client, matter } = await setup(page);
  await page
    .getByRole("link", { name: /Financeiro$/, exact: false })
    .first()
    .click();
  await page.getByText("Nova cobrança InfinitePay", { exact: true }).click();
  const combo = page.getByRole("combobox", {
    name: "Cliente da cobrança",
    exact: true,
  });
  await page
    .getByRole("button", {
      name: "Mostrar opções de Cliente da cobrança",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("option", { name: /Joana da Silva/ }),
  ).toBeVisible();
  await combo.fill("529.982.247-25");
  await expect(
    page.getByRole("option", { name: /Joana da Silva/ }),
  ).toBeVisible();
  await combo.press("Enter");
  await expect(combo).toHaveValue(client.full_name);
  const cases = page.getByRole("combobox", {
    name: "Caso da cobrança",
    exact: true,
  });
  await cases.fill(matter.cnj_number);
  await cases.press("Enter");
  await expect(cases).toHaveValue(matter.title);
  await combo.click();
  await combo.fill("(13) 99999-9999");
  await expect(
    page.getByRole("option", { name: /Joana da Silva/ }),
  ).toBeVisible();
  await combo.press("Escape");
  expect(errors).toEqual([]);
});
test("perfil editável preserva dados somente leitura e envia versão e telefone normalizado", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await page.getByRole("link", { name: /Minha Conta/ }).click();
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Matheus Moraes Teste");
  await page
    .getByLabel("Telefone / WhatsApp profissional")
    .fill("(13) 98888-7777");
  await page.getByLabel("Bio profissional").fill("Bio profissional revisada.");
  await page
    .getByRole("button", { name: "Salvar perfil profissional" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Perfil profissional atualizado",
  );
  const update = calls.find((c) => c.body.operation === "profile_save")!.body
    .profile;
  expect(update.phone).toBe("+5513988887777");
  expect(update.role).toBeUndefined();
  expect(update.is_active).toBeUndefined();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("ficha 360 gera kit com histórico e exige revisão antes de imprimir", async ({
  page,
}) => {
  const { calls, errors, client } = await setup(page);
  await page.goto(`/crm/hub?case_id=${caseId}`);
  await expect(
    page.getByRole("heading", { name: "Resumo & Partes / Conflito" }),
  ).toBeVisible();
  await expect(
    page.getByText(client.document_number, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Kit Inicial", exact: true }).click();
  await page
    .getByLabel("Qualificação complementar do cliente")
    .fill("brasileira, profissão informada");
  await page
    .getByLabel("Objeto e limites da atuação")
    .fill("Acompanhamento jurídico conforme contrato.");
  await page
    .getByLabel("Honorários e condições acordadas")
    .fill("Condições específicas acertadas entre as partes.");
  await page
    .getByRole("button", { name: "Gerar três minutas pré-preenchidas" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Procuração", exact: true }),
  ).toBeVisible();
  const print = page.getByRole("button", {
    name: "Imprimir / Salvar PDF do kit revisado",
  });
  await expect(print).toBeDisabled();
  await page.getByRole("checkbox", { name: /Conferi dados/ }).check();
  await expect(print).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Revisar Procuração", exact: true })
    .fill("PROCURAÇÃO revisada com limites e poderes conferidos.");
  await expect(print).toBeDisabled();
  await page.getByRole("checkbox", { name: /Conferi dados/ }).check();
  await page
    .getByRole("button", { name: "Salvar versão revisada do kit" })
    .click();
  await expect(print).toBeEnabled();
  await page.evaluate(() => {
    window.print = () => {
      (window as any).__printed = true;
    };
  });
  await print.click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(true);
  expect(
    calls.find((c) => c.name === "initial-kit")?.body.context,
  ).toMatchObject({ case_id: caseId });
  expect(errors).toEqual([]);
});
test("e-mail exibe destinatário e conteúdo, exige revisão e registra envio no caso", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await page.goto(`/crm/hub?case_id=${caseId}`);
  await page.getByRole("tab", { name: "E-mail", exact: true }).click();
  await page.getByRole("button", { name: "Pré-visualizar e-mail" }).click();
  await expect(
    page.getByText("joana@example.test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar e-mail revisado" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Revisei o conteúdo/ }).check();
  await page.getByRole("button", { name: "Enviar e-mail revisado" }).click();
  await expect(page.getByRole("status")).toContainText("E-mail enviado");
  const sent = calls.find(
    (c) => c.name === "email-send" && !c.body.operation,
  )!.body;
  expect(sent.reviewed).toBe(true);
  expect(sent.preview_token).toBe("test-hash");
  expect(sent.recipient).toBeUndefined();
  expect(errors).toEqual([]);
});
test("triagem sugere caso mas só vincula depois da revisão e não cria prazo", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await page.getByRole("link", { name: /Triagem de E-mails/ }).click();
  await page
    .getByRole("button", { name: "Intimação recebida", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirmar vínculo após revisão" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Selecionar sugestão/ }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Caso da intimação ou e-mail",
      exact: true,
    }),
  ).toHaveValue("Acompanhamento familiar");
  expect(
    calls.filter((c) => c.body.operation === "triage_review"),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirmar vínculo após revisão" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Nenhum prazo foi criado automaticamente",
  );
  expect(calls.some((c) => c.name === "appointments")).toBe(false);
  expect(errors).toEqual([]);
});
test("copiloto usa fontes oficiais, controla autorização e mantém falhas de atualização visíveis", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await page.getByRole("link", { name: /Agente Jurídico IA$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Base jurídica oficial" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Atualizar Base Jurídica" }).click();
  await expect(page.getByRole("status")).toContainText(
    "1 fontes consultadas; 1 indisponíveis",
  );
  await page
    .getByLabel("Pergunta ao copiloto")
    .fill("Quais fontes oficiais apoiam esta análise?");
  await expect(
    page.getByRole("button", { name: "Consultar fontes com o copiloto" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Autorizo processar/ }).check();
  await page
    .getByRole("button", { name: "Consultar fontes com o copiloto" })
    .click();
  await expect(
    page.getByText("SUBSÍDIOS OFICIAIS — REVISÃO HUMANA OBRIGATÓRIA", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Fonte oficial: Fonte STF ↗" }),
  ).toHaveAttribute("href", "https://noticias.stf.jus.br/");
  expect(calls.find((c) => c.name === "legal-copilot")?.body.authorized).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test("staff e mobile mantêm acesso operacional sem controles admin, links vazios ou overflow", async ({
  page,
}) => {
  const { errors } = await setup(page, "staff");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: /Agente Jurídico IA$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Chat copiloto interno", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atualizar Base Jurídica" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Configuração do Agente/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("a")
      .evaluateAll((links) =>
        links.every(
          (a) => a.getAttribute("href") && a.getAttribute("href") !== "#",
        ),
      ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase6-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("contato e endereço são editados na própria ficha sem repetir formalização", async ({
  page,
}) => {
  const { calls, errors } = await setup(page);
  await page.goto(`/crm/hub?case_id=${caseId}`);
  await page
    .getByRole("button", { name: "Editar contato e endereço do cliente" })
    .click();
  await page
    .getByLabel("Telefone do cliente", { exact: true })
    .fill("(13) 98888-7777");
  await page
    .getByLabel("E-mail do cliente", { exact: true })
    .fill("novo@example.test");
  await page.getByLabel("Logradouro", { exact: true }).fill("Rua Atualizada");
  await page.getByRole("button", { name: "Salvar contato e endereço" }).click();
  await expect(
    page.getByText("novo@example.test", { exact: true }),
  ).toBeVisible();
  const patch = calls.find((c) => c.body.operation === "client_save")?.body
    .client;
  expect(patch.phone).toBe("+5513988887777");
  expect(patch.document_number).toBeUndefined();
  expect(errors).toEqual([]);
});
