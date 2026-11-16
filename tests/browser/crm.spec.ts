import { expect, test, Page } from '@playwright/test';

const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'equipe@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-16T00:00:00Z' };
const lead = { id: '20000000-0000-0000-0000-000000000001', name: 'Maria Teste', phone: '+5513999999999', email: null, summary: 'Revisão de contrato de prestação de serviços.', practice_area: 'contratos', stage: 'novo', urgency: 'normal', created_at: '2026-11-16T00:00:00Z', converted_client_id: null };

// Contratos HTTP simulados; a autorização e a transação reais são testadas no PGlite.
async function api(page: Page, active = true) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  await page.route('https://crm-test.supabase.co/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    calls.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() });
    let body: unknown = {};
    if (url.pathname.endsWith('/token')) body = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user };
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.endsWith('/profiles')) body = active ? { id: user.id, is_active: true } : null;
    else if (url.pathname.endsWith('/leads_intake')) body = [req.method() === 'PATCH' ? { id: lead.id } : lead];
    else if (url.pathname.endsWith('/clients') || url.pathname.endsWith('/cases')) body = [];
    else if (url.pathname.endsWith('/review_lead_conversion')) body = { token: 'review-test', conflicts: [] };
    else if (url.pathname.endsWith('/convert_lead')) body = { client_id: 'test-client', case_id: 'test-case', already_converted: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}
async function login(page: Page) {
  await page.goto('/crm/login');
  await page.getByLabel('E-mail profissional').fill('equipe@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste');
  await page.getByRole('button', { name: 'Entrar no CRM' }).click();
}

test('acesso direto sem sessão mostra login, sem carregar dados internos', async ({ page }) => {
  const calls = await api(page);
  await page.goto('/crm/clientes');
  await expect(page.getByRole('heading', { name: 'Acesso ao escritório' })).toBeVisible();
  expect(calls.some(call => call.path.includes('/rest/'))).toBe(false);
  await expect(page).toHaveURL(/\/crm\/login$/);
});

test('credenciais válidas com profile inativo não abrem o painel', async ({ page }) => {
  const calls = await api(page, false);
  await login(page);
  await expect(page.getByRole('alert')).toContainText('não possui um perfil ativo');
  await expect(page.getByRole('heading', { name: 'Funil de atendimento' })).toHaveCount(0);
  expect(calls.some(call => call.path.endsWith('/leads_intake'))).toBe(false);
});

test('login ativo, Kanban, consultas BrasilAPI, revisão e conversão', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  const calls = await api(page);
  await page.route('https://brasilapi.com.br/api/cep/v2/11010000', route => route.fulfill({ json: { cep: '11010000', street: 'Rua de Teste', neighborhood: 'Centro', city: 'Santos', state: 'SP' } }));
  await page.route('https://brasilapi.com.br/api/cnpj/v1/62575046000196', route => route.fulfill({ json: { razao_social: 'Empresa Teste', municipio: 'Santos', uf: 'SP', cep: '11010000' } }));
  await login(page);
  await expect(page.getByRole('heading', { name: 'Funil de atendimento' })).toBeVisible();
  for (const name of ['Novos','Em triagem','Reunião agendada','Proposta','Fechados','Arquivados']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Etapa de Maria Teste').selectOption('triagem');
  await expect(page.getByRole('status')).toContainText('atualizada');
  await page.getByRole('button', { name: 'Formalizar cliente / caso' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Tipo de documento', exact: true }).selectOption('cnpj');
  await dialog.getByLabel('Documento', { exact: true }).fill('62575046000196');
  await dialog.getByRole('button', { name: 'Consultar CNPJ na BrasilAPI' }).click();
  await expect(dialog.getByLabel('Nome completo ou razão social')).toHaveValue('Empresa Teste');
  await dialog.getByLabel('CEP', { exact: true }).fill('11010000');
  await dialog.getByRole('button', { name: 'Consultar CEP na BrasilAPI' }).click();
  await expect(dialog.getByLabel('Logradouro')).toHaveValue('Rua de Teste');
  await dialog.getByLabel('Título do caso').fill('Revisão de contrato');
  await dialog.getByRole('button', { name: 'Verificar conflitos' }).click();
  const convert = dialog.getByRole('button', { name: 'Converter em cliente e caso' });
  await expect(convert).toBeDisabled();
  // Alterar dado após a revisão exige uma nova consulta.
  await dialog.getByLabel('Título do caso').fill('Revisão contratual');
  await expect(convert).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Verificar conflitos' }).click();
  await dialog.getByRole('checkbox').check();
  await convert.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Atendimento convertido.' })).toBeVisible();
  expect(calls.find(call => call.path.endsWith('/convert_lead'))?.body).toMatchObject({ p_review_token: 'review-test', p_document_type: 'cnpj', p_title: 'Revisão contratual' });
  await page.getByRole('link', { name: /Agenda/ }).click();
  await expect(page.getByRole('heading', { name: 'Compromissos, consultas e prazos' })).toBeVisible();
  await page.getByRole('link', { name: /Financeiro/ }).click();
  await expect(page.getByRole('heading', { name: 'Honorários e pagamentos InfinitePay' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair da sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Acesso ao escritório' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('CRM em tela pequena mantém navegação e diálogo utilizáveis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api(page); await login(page);
  await expect(page.getByRole('heading', { name: 'Funil de atendimento' })).toBeVisible();
  await page.getByRole('button', { name: 'Formalizar cliente / caso' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fechar conversão' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('coincidência de interesse bloqueia o botão de conversão', async ({ page }) => {
  const calls = await api(page);
  await page.route('https://crm-test.supabase.co/rest/v1/rpc/review_lead_conversion', route => route.fulfill({ json: { token: 'conflict-test', conflicts: [{ case_id: 'case-test', full_name: 'Maria Teste', party_role: 'adversa', match_by: 'nome' }] } }));
  await login(page);
  await page.getByRole('button', { name: 'Formalizar cliente / caso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Documento', { exact: true }).fill('52998224725');
  await dialog.getByLabel('Título do caso').fill('Revisão contratual');
  await dialog.getByRole('button', { name: 'Verificar conflitos' }).click();
  await expect(dialog.getByRole('heading', { name: 'Possíveis conflitos encontrados' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Converter em cliente e caso' })).toHaveCount(0);
  expect(calls.some(call => call.path.endsWith('/convert_lead'))).toBe(false);
});

test('clientes e casos mostram o vínculo e a revogação de acesso fecha o painel', async ({ page }) => {
  await api(page);
  await page.route('https://crm-test.supabase.co/rest/v1/clients*', route => route.fulfill({ json: [{ id: 'client-test', full_name: 'Maria Teste', document_type: 'cpf', document_number: '52998224725', phone: '+5513999999999', email: null, address_json: { city: 'Santos' } }] }));
  await page.route('https://crm-test.supabase.co/rest/v1/cases*', route => route.fulfill({ json: [{ id: 'case-test', client_id: 'client-test', title: 'Revisão contratual', status: 'ativo', practice_area: 'contratos', opposing_party: null, source_lead_id: lead.id }] }));
  await login(page);
  await page.getByRole('link', { name: /Clientes \/ Casos/ }).click();
  await page.getByRole('button', { name: 'Maria Teste' }).click();
  await expect(page.getByRole('heading', { name: 'Revisão contratual' })).toBeVisible();
  await page.route('https://crm-test.supabase.co/rest/v1/profiles*', route => route.fulfill({ json: null }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Acesso ao escritório' })).toBeVisible();
});

test('falha da BrasilAPI permite preenchimento manual e preserva o formulário', async ({ page }) => {
  await api(page);
  await page.route('https://brasilapi.com.br/**', route => route.fulfill({ status: 503, json: {} }));
  await login(page);
  await page.getByRole('button', { name: 'Formalizar cliente / caso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('CEP', { exact: true }).fill('11010000');
  await dialog.getByRole('button', { name: 'Consultar CEP na BrasilAPI' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Preencha os dados manualmente');
  await expect(dialog.getByLabel('Nome completo ou razão social')).toHaveValue('Maria Teste');
  await dialog.getByLabel('Cidade').fill('Santos');
  await expect(dialog.getByLabel('Cidade')).toHaveValue('Santos');
});
