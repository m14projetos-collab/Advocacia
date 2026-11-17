import { Page } from "@playwright/test";
export const user = {
  id: "10000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "equipe@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-11-16T00:00:00Z",
};
export const lead = {
  id: "20000000-0000-0000-0000-000000000001",
  name: "Maria Teste",
  phone: "+5513999999999",
  email: null,
  summary: "Revisão de contrato de prestação de serviços.",
  practice_area: "contratos",
  stage: "novo",
  urgency: "normal",
  created_at: "2026-11-16T00:00:00Z",
  converted_client_id: null,
};

// Contratos HTTP simulados; a autorização e a transação reais são testadas no PGlite.
export async function api(page: Page, active = true) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  await page.route("https://crm-test.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push({
      path: url.pathname,
      method: req.method(),
      body: req.postDataJSON(),
    });
    let body: unknown = {};
    if (url.pathname.endsWith("/token"))
      body = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      };
    else if (url.pathname.endsWith("/user")) body = user;
    else if (url.pathname.endsWith("/profiles"))
      body = active
        ? {
            id: user.id,
            is_active: true,
            full_name: "Equipe Teste",
            role: "staff",
            oab_number: "123456/SP",
            phone: "+5513999999999",
            bio: null,
          }
        : null;
    else if (url.pathname.endsWith("/leads_intake"))
      body = [req.method() === "PATCH" ? { id: lead.id } : lead];
    else if (
      ["/clients", "/cases", "/appointments", "/payments"].some((path) =>
        url.pathname.endsWith(path),
      )
    )
      body = [];
    else if (url.pathname.endsWith("/review_lead_conversion"))
      body = { token: "review-test", conflicts: [] };
    else if (url.pathname.endsWith("/convert_lead"))
      body = {
        client_id: "test-client",
        case_id: "test-case",
        already_converted: false,
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return calls;
}
export async function login(page: Page) {
  await page.goto("/crm/login");
  await page.getByLabel("E-mail profissional").fill("equipe@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("senha-de-teste");
  await page.getByRole("button", { name: "Entrar no CRM" }).click();
}
