# M14 Advocacia — Fase 1 para auditoria

Status: proposta, sem comandos no banco, sem aplicação, commit, push ou deploy.
Alvo: `neotdgoftxkfaljpmddk.supabase.co`. Repositório `m14projetos-collab/Advocacia` vazio na consulta desta sessão.
Vercel existente informada pelo usuário; configuração remota não foi alterada nem auditada.

## 1. Diagnóstico e decisão

Avançar com ajustes de segurança. React + Vite + TypeScript + Tailwind na Vercel; Supabase Auth, Postgres/RLS e Edge Functions. Um escritório por projeto, sem complexidade multitenant prematura. Todos os membros ativos têm acesso aos casos do escritório, inclusive sigilosos; se houver restrição por advogado será necessária ACL por caso antes de inserir dados reais. Este desenho não pode ser reutilizado como SaaS multi-escritório sem isolamento adicional.

O Prompt Master é um requisito, não prova de que integrações ou conformidade jurídica já foram validadas. Não inventar número OAB, credenciais, domínio ou eventos de pagamento. Esta fase não certifica conformidade OAB/LGPD nem implementa cálculo de prazo, DataJud ou IA.

| Risco | Decisão técnica |
|---|---|
| Cadastro público ganhar acesso ao escritório | Sem trigger de criação automática de profile. Membro provisionado por administrador via Edge ou bootstrap supervisionado. `is_active` revogável. |
| Escalada de privilégio | Nenhum INSERT/UPDATE de profiles pelo navegador, nem para admin. Não usar user_metadata para autorização. |
| Recursão em RLS de profiles | Helpers limitados em schema privado, com search_path vazio e EXECUTE restrito. |
| Escrita pública abusiva | INSERT anônimo somente em sete campos, com estado novo/portal, timestamp do servidor e sem leitura. Rate limit/CAPTCHA ainda não existem. Antes da Fase 2 pública, substituir por Edge e revogar o grant direto; CAPTCHA apenas no front não basta. |
| Falsa confirmação de pagamento ou agenda | Payments, payment_events e appointments só podem ser escritos pelo backend. Pagamento exige confirmação do provedor; redirect do navegador não comprova quitação. |
| Duplicidade na conversão | Documento normalizado único; source_lead_id único em cases. Fase 3 precisa RPC transacional chamada pela Edge, com lock do lead, cliente/caso e vínculo das mensagens; três chamadas REST não são transação. |
| Vazamento pela auditoria | Logs de identificadores/operação, sem cópia de CPF, texto ou arquivos; leitura somente admin e escrita por trigger. Não são logs imutáveis perante dono do banco. |
| Integrações presumidas | Estados locais não são eventos oficiais. Autenticação, webhook e consulta de pagamento InfinitePay serão verificados na Fase 4. |
| Documentos sensíveis | Tabela de metadados preparada, nenhum bucket público. Upload/download via Edge com autorização por caso, Storage privado e URLs curtas; provisionamento fica para o módulo. |
| Reaplicação perigosa | SQL transacional, objetos próprios com IF NOT EXISTS e substituição de policies/triggers de nomes próprios. Isso é reexecutável sobre esta mesma versão, não um reconciliador de schema desconhecido. |

Tensão entre operação e risco: o INSERT anônimo segue o pedido original, mas a recomendação para publicação é entrada via Edge com proteção de abuso. Tensão entre escala e custo: manter um escritório por projeto reduz complexidade inicial; multitenancy e integrações pagas ficam fora da base. Veredito: avançar com a base auditável, validando permissões antes do portal. Teste mínimo: visitante, usuário externo, staff, admin e membro desativado, mais conversão duplicada e webhook repetido nas fases correspondentes.

## 2. Estrutura de pastas

A tabela distingue entregáveis desta fase de caminhos planejados. Não contém módulos fictícios nem uma aplicação pronta para build.

| Caminho | Estado / responsabilidade |
|---|---|
| `vercel.json` | Entregue: Vite, dist, rewrite SPA e headers básicos |
| `.env.example` | Entregue: apenas variáveis públicas |
| `.gitignore` | Entregue: segredos e artefatos locais ignorados |
| `docs/arquitetura.md` | Entregue: diagnóstico, contratos e validações |
| `supabase/review/phase1-schema.sql` | Entregue: SQL integral proposto para revisão |
| `supabase/functions/.env.example` | Entregue: configuração exclusiva do servidor |
| `supabase/migrations/` | Após aprovação: gerar arquivo pelo CLI e transferir SQL auditado |
| `supabase/config.toml` | Após aprovação: gerar com CLI e revisar Auth/redirects/Functions |
| `supabase/tests/` | Testes de integração/RLS após autorização para banco de teste |
| `package.json`, `package-lock.json`, `index.html` | Fase 2: projeto executável com versões fixadas e lockfile |
| `vite.config.ts`, `tsconfig*.json` | Fase 2: build e TypeScript strict |
| `src/main.tsx`, `src/app/router.tsx`, `src/app/providers.tsx` | Bootstrap e rotas públicas/internas |
| `src/components/ui/`, `src/components/layout/` | Componentes acessíveis e shells |
| `src/styles/`, `public/brand/` | Tokens grafite/off-white/dourado, fontes e ativos aprovados |
| `src/lib/supabase/`, `src/lib/validation/`, `src/types/` | Cliente público, validação runtime e tipos gerados do banco |
| `src/features/portal/`, `src/features/intake/` | Fase 2 |
| `src/features/auth/`, `src/features/crm/`, `src/features/clients/`, `src/features/cases/` | Fase 3 |
| `src/features/calendar/`, `src/features/finance/` | Fase 4 |
| `src/features/whatsapp/`, `src/features/copilot/`, `src/features/settings/` | Fase 5 |
| `supabase/functions/_shared/` | Auth, autorização, CORS, schemas de entrada, respostas e clientes HTTP |
| `supabase/functions/leads-intake/` | Entrada com antiabuso, consentimento e resposta sem dados pessoais |
| `supabase/functions/office-members/` | Provisionamento e desativação: somente admin verificado |
| `supabase/functions/convert-lead/` | Autorização e chamada da futura RPC atômica |
| `supabase/functions/appointments/` | Agenda e validação do pré-pagamento |
| `supabase/functions/infinitepay-checkout/`, `supabase/functions/infinitepay-webhook/` | Fase 4: checkout e confirmação verificada/idempotente |
| `supabase/functions/whatsapp-send/`, `supabase/functions/whatsapp-webhook/` | Fase 5: mensagens e assinatura de webhook |
| `supabase/functions/legal-agent/`, `supabase/functions/datajud-lookup/`, `supabase/functions/case-files/` | IA, consulta autorizada e arquivos privados |
| `tests/e2e/`, `.github/workflows/ci.yml` | Ao iniciar código: typecheck, build e fluxos relevantes |

Nenhum `api/` na Vercel para camada sensível. Segredos e integrações executam no Supabase. Os headers propostos bloqueiam microfone/câmera; se WebRTC nativo for implementado futuramente, revisar Permissions-Policy. CSP precisa ser definida junto com fontes, imagens e integrações da Fase 2. SPA é suficiente para o CRM; SEO do portal público pede pré-renderização ou avaliação de renderização estática na Fase 2.

## 3. Modelo e permissões

As nove tabelas do prompt estão preservadas. Acrescentadas `case_parties` (conflitos), `payment_events` (deduplicação) e `case_documents` (metadados privados). `agent_config` unifica o perfil de estilo único; não há duas fontes concorrentes de configuração.

| Entidade | Visitante anon | Membro ativo | Escrita de servidor |
|---|---|---|---|
| profiles | Nenhum | Leitura | Provisionar/editar após verificar admin |
| leads_intake | INSERT restrito | Leitura/INSERT/UPDATE | Entrada protegida e conversão |
| clients, cases, case_parties | Nenhum | Leitura/INSERT/UPDATE | Operações compostas/validação adicional |
| appointments, payments, whatsapp_messages, case_documents | Nenhum | Leitura | Edge autenticada/autorizada |
| agent_config, payment_events | Nenhum | Leitura apenas admin | Edge; eventos não podem ser apagados pelo serviço |
| audit_logs | Nenhum | Leitura apenas admin | Trigger, sem DML direto de service_role |

Usuário autenticado sem profile ativo não obtém acesso interno. Sem DELETE pelo navegador; exclusão/retificação e retenção precisam de fluxo administrativo futuro. Auth desativado não implica expiração instantânea de JWT: `profiles.is_active=false` corta o acesso via políticas; Edge deve consultar o vínculo atualizado a cada operação sensível.

A service_role ignora RLS, logo a autorização da Edge é indispensável. Logs originados de serviço podem ter actor_id nulo; atribuição humana de operações sensíveis deve ser implementada com contexto autenticado verificável na futura RPC, sem aceitar actor_id enviado pelo navegador.

## 4. Limites explícitos desta entrega

- Nenhum comando foi executado no banco, nem SELECT de inspeção. Nenhuma migration foi aplicada. Não se conhece o schema real existente; repositório vazio não prova banco vazio.
- SQL entregue em `review/`, fora do caminho de aplicação automática. CLI indisponível neste ambiente; não inventamos timestamp de migration. Após aprovação, instalar/pinar CLI, consultar --help e gerar migration via `supabase migration new m14_advocacia_phase1`.
- Não foram criados usuários Auth, bootstrap de admin, buckets, secrets, Functions, aplicativo React ou deploy.
- O número OAB, origem real da Vercel e chave pública precisam ser fornecidos/consultados na fase de implementação. Não há credenciais no pacote.
- Formatos de CPF/CNPJ/CNJ são verificados no banco; dígitos verificadores e consulta cadastral não estão implementados nesta base. CNPJ permite letras no corpo, sem presumir consulta de CPF.
- O aceite gravado não substitui análise da base legal, aviso de privacidade aprovado, retenção e procedimentos de atendimento de titulares.
- Reservas, confirmação de agenda paga, cálculo judicial, conflito de interesses, resumo IA e conversão transacional são comportamentos das fases seguintes. As tabelas preparam os vínculos, não simulam esses comportamentos.
- Não há isolamento por advogado dentro do escritório. Se exigido, revisar policies e tabela de ACL antes de usar casos reais.
- Scripts não removem policies desconhecidas: policies permissivas anteriores poderiam ampliar acesso. Inspeção prévia é obrigatória após aprovação.

## 5. Checklist posterior à auditoria (não executado)

1. Confirmar projeto e inspecionar tabelas, funções, policies, grants e migrations existentes. Resolver diferenças antes de aplicar.
2. Garantir que m14_private não é schema exposto; bootstrap supervisionado do primeiro admin vinculado a UUID Auth real, sem autoinscrição.
3. Gerar migration pelo CLI; testar primeiro em ambiente isolado autorizado. Reaplicar a mesma versão e conferir que não duplica objetos.
4. Verificar anon: inserir apenas campos permitidos, sem retorno de linhas; rejeitar estágio, id, timestamps, fonte e cliente manipulados; negar leitura e atualização.
5. Verificar usuário autenticado sem profile e profile inativo: nenhuma linha interna acessível; nenhuma escrita.
6. Verificar staff: CRUD permitido nos cadastros; negar alteração de role, financeiro, mensagens, agenda paga, audit_logs e agent_config.
7. Verificar admin: leitura de auditoria/configuração, ainda sem escrita sensível direta pelo cliente.
8. Verificar constraints: documento duplicado, par tipo/documento incompleto, valor não positivo, pagamento de caso de outro cliente e janela de agenda inválida.
9. Verificar triggers: updated_at modificado, created_at preservado, auditoria gerada sem conteúdo pessoal e sem recursão.
10. Rodar advisors de segurança/performance após aplicação autorizada. Gerar tipos TypeScript do schema real.
11. Antes de abrir o portal, migrar intake para Edge com CAPTCHA/rate limit e revogar grant de INSERT anon direto. Configurar origens CORS e Auth redirect exatas, sem curingas de produção.
12. Na Fase 2 executar build e testar acesso direto/refresh em /crm e /auth/callback na Vercel; validar assets e páginas inexistentes. Nesta fase não existe build para testar.

## Fontes técnicas consultadas

- https://vercel.com/docs/frameworks/frontend/vite — rewrite oficial SPA.
- https://supabase.com/docs/guides/database/postgres/row-level-security — RLS, helpers privados e riscos de bypass.
- https://supabase.com/docs/guides/database/postgres/column-level-security — privilégios por coluna.


## Arquivo completo: `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
    ]
  }]
}
```

## Arquivo completo: `.env.example`

```dotenv
# Somente valores públicos. Tudo com VITE_ será incorporado ao navegador.
VITE_SUPABASE_URL=https://neotdgoftxkfaljpmddk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
# Preencher com a origem real já configurada na Vercel, sem inventar domínio.
VITE_APP_URL=
# Número ainda não fornecido; não publicar identificador fictício.
VITE_OFFICE_OAB_NUMBER=
```

## Arquivo completo: `supabase/functions/.env.example`

```dotenv
# Arquivo exclusivamente de desenvolvimento local das Edge Functions.
# Produção: configurar segredos no Supabase. Nunca copiar para VITE_*.
# SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos no ambiente hospedado.
APP_ORIGIN=
INFINITEPAY_HANDLE=matheus-moraes-tsd
# Autenticação do provedor e verificação de webhook: confirmar contrato na Fase 4.
# Nenhuma API key ou assinatura InfinitePay é presumida nesta fase.
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=
LLM_API_KEY=
DATAJUD_API_KEY=
# Configuração futura do provedor de proteção contra abuso:
TURNSTILE_SECRET_KEY=
```

## Arquivo completo: `.gitignore`

```gitignore
node_modules/
dist/
.vercel/
.env
.env.*
!.env.example
supabase/functions/.env
supabase/functions/.env.*
!supabase/functions/.env.example
supabase/.temp/
```

## Arquivo completo: `supabase/review/phase1-schema.sql`

```sql
-- M14 Advocacia | Fase 1 | PROPOSTA PARA AUDITORIA, NÃO APLICADA.
-- Alvo futuro: neotdgoftxkfaljpmddk. PostgreSQL 17 / Supabase.
-- Executar como postgres somente após aprovação e inspeção do schema existente.
-- Reexecução suportada para este mesmo schema; IF NOT EXISTS não corrige drift.
-- Não expor o schema m14_private na Data API.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS m14_private;
REVOKE ALL ON SCHEMA m14_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA m14_private TO authenticated;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  oab_number text,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  is_active boolean NOT NULL DEFAULT true,
  phone text,
  bio text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  document_type text CHECK (document_type IN ('cpf','cnpj')),
  document_number text,
  phone text,
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  address_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(address_json) = 'object'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coalesce((document_type IS NULL AND document_number IS NULL) OR
    (document_type = 'cpf' AND document_number IS NOT NULL AND document_number ~ '^[0-9]{11}$') OR
    (document_type = 'cnpj' AND document_number IS NOT NULL AND document_number ~ '^[A-Z0-9]{12}[0-9]{2}$'), false)),
  UNIQUE (document_type, document_number)
);
-- Formato normalizado acima; dígitos verificadores serão validados na Edge Function.
-- Sem documento, nomes iguais NÃO são considerados a mesma pessoa automaticamente.

CREATE TABLE IF NOT EXISTS public.leads_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  practice_area text NOT NULL CHECK (practice_area IN ('familia_sucessoes','medico_saude','criminal','contratos','outros')),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 3000),
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','alta','urgente')),
  stage text NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo','triagem','reuniao_agendada','proposta','fechado','arquivado')),
  source text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','whatsapp','manual','indicacao')),
  lgpd_consent_at timestamptz NOT NULL DEFAULT now(),
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 80),
  converted_client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'fechado' OR converted_client_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  source_lead_id uuid UNIQUE REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  practice_area text NOT NULL CHECK (practice_area IN ('familia_sucessoes','medico_saude','criminal','contratos','outros')),
  cnj_number text CHECK (cnj_number IS NULL OR cnj_number ~ '^[0-9]{20}$'),
  court_alias text,
  opposing_party text,
  is_confidential boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','suspenso','encerrado','arquivado')),
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id)
);
-- Sem UNIQUE global em cnj_number: um processo pode representar vários clientes.
-- is_confidential orienta integrações; NÃO implementa compartimentação por advogado.

CREATE TABLE IF NOT EXISTS public.case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  party_role text NOT NULL CHECK (party_role IN ('cliente','adversa','terceiro')),
  document_type text CHECK (document_type IN ('cpf','cnpj')),
  document_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coalesce((document_type IS NULL AND document_number IS NULL) OR
    (document_type = 'cpf' AND document_number IS NOT NULL AND document_number ~ '^[0-9]{11}$') OR
    (document_type = 'cnpj' AND document_number IS NOT NULL AND document_number ~ '^[A-Z0-9]{12}[0-9]{2}$'), false))
);
-- Base para busca de conflito por documento/nome; alertas e análise humana na Fase 3.

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  type text NOT NULL CHECK (type IN ('consulta','audiencia','prazo','interno')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  meeting_url text,
  lead_id uuid REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  payment_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','concluido','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- Datas timestamptz; exibição America/Sao_Paulo. Cálculo judicial fica fora deste SQL.

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  case_id uuid,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE RESTRICT,
  order_nsu uuid NOT NULL UNIQUE,
  infinitepay_slug text,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  fee_type text NOT NULL DEFAULT 'inicial' CHECK (fee_type IN ('consulta','inicial','parcela','exito')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 999999999999),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  capture_method text,
  checkout_url text,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','settled','canceled','refunded','failed')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, client_id) REFERENCES public.cases(id, client_id) ON DELETE RESTRICT,
  CHECK (order_nsu = id),
  CHECK (status NOT IN ('paid','settled') OR paid_at IS NOT NULL)
);
-- Status são internos. NÃO pressupõem nomes de eventos da API InfinitePay.
-- Edge Function deve fornecer o mesmo UUID em id e order_nsu.

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'infinitepay' CHECK (provider = 'infinitepay'),
  deduplication_key text NOT NULL CHECK (char_length(deduplication_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, deduplication_key)
);
-- Não armazena payload sensível bruto. Dedupe não autentica webhook.
-- Fase 4: confirmação no provedor + transação única evento/pagamento/agendamento.

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type text NOT NULL CHECK (sender_type IN ('client','human','ai_agent')),
  content text CHECK (content IS NULL OR char_length(content) <= 30000),
  media_url text,
  provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta','evolution')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL),
  CHECK (NULLIF(btrim(content),'') IS NOT NULL OR media_url IS NOT NULL),
  CHECK ((direction = 'inbound' AND sender_type = 'client') OR
         (direction = 'outbound' AND sender_type IN ('human','ai_agent'))),
  UNIQUE (provider, external_id)
);
-- media_url: identificador/caminho privado, nunca URL pública permanente de documento.

CREATE TABLE IF NOT EXISTS public.agent_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tone_examples_json jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tone_examples_json) = 'array'),
  practice_knowledge_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(practice_knowledge_json) = 'object'),
  oab_guardrails_enabled boolean NOT NULL DEFAULT true CHECK (oab_guardrails_enabled),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- agent_config é o perfil único de estilo do escritório; não duplicar em agent_style_profiles.

CREATE TABLE IF NOT EXISTS public.case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 1 AND 1024),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Storage privado será provisionado no módulo de documentos; nenhum bucket público criado.
-- Metadados não garantem existência do objeto. Edge valida MIME, tamanho e associação.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  entity text NOT NULL,
  entity_id text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- actor_id sem FK preserva auditoria após exclusão autorizada de identidade.
-- Em ações de serviço, actor_id pode ser NULL; não fingir identidade humana.

-- Índices: FKs, Kanban, agenda, financeiro, histórico e conflito.
CREATE INDEX IF NOT EXISTS m14_clients_name_idx ON public.clients (lower(full_name));
CREATE INDEX IF NOT EXISTS m14_leads_stage_created_idx ON public.leads_intake (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS m14_leads_phone_idx ON public.leads_intake (phone);
CREATE INDEX IF NOT EXISTS m14_leads_client_idx ON public.leads_intake (converted_client_id);
CREATE INDEX IF NOT EXISTS m14_cases_client_idx ON public.cases (client_id);
CREATE INDEX IF NOT EXISTS m14_cases_cnj_idx ON public.cases (cnj_number) WHERE cnj_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS m14_cases_status_idx ON public.cases (status);
CREATE INDEX IF NOT EXISTS m14_parties_case_idx ON public.case_parties (case_id);
CREATE INDEX IF NOT EXISTS m14_parties_document_idx ON public.case_parties (document_type, document_number);
CREATE INDEX IF NOT EXISTS m14_parties_name_idx ON public.case_parties (lower(full_name));
CREATE INDEX IF NOT EXISTS m14_appointments_start_idx ON public.appointments (starts_at);
CREATE INDEX IF NOT EXISTS m14_appointments_lead_idx ON public.appointments (lead_id);
CREATE INDEX IF NOT EXISTS m14_appointments_case_idx ON public.appointments (case_id);
CREATE INDEX IF NOT EXISTS m14_payments_client_idx ON public.payments (client_id);
CREATE INDEX IF NOT EXISTS m14_payments_case_client_idx ON public.payments (case_id, client_id);
CREATE INDEX IF NOT EXISTS m14_payments_appointment_idx ON public.payments (appointment_id);
CREATE INDEX IF NOT EXISTS m14_payments_status_due_idx ON public.payments (status, due_date);
CREATE INDEX IF NOT EXISTS m14_events_payment_idx ON public.payment_events (payment_id);
CREATE INDEX IF NOT EXISTS m14_messages_lead_created_idx ON public.whatsapp_messages (lead_id, created_at);
CREATE INDEX IF NOT EXISTS m14_messages_client_created_idx ON public.whatsapp_messages (client_id, created_at);
CREATE INDEX IF NOT EXISTS m14_documents_case_idx ON public.case_documents (case_id);
CREATE INDEX IF NOT EXISTS m14_documents_uploader_idx ON public.case_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS m14_audit_entity_idx ON public.audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS m14_audit_actor_idx ON public.audit_logs (actor_id, created_at DESC);

-- Helpers em schema NÃO exposto. SECURITY DEFINER evita recursão na RLS de profiles.
-- Exceção deliberada e restrita: apenas existência/role do usuário autenticado.
CREATE OR REPLACE FUNCTION m14_private.is_office_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
  );
$$;
CREATE OR REPLACE FUNCTION m14_private.is_office_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active AND p.role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION m14_private.is_office_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION m14_private.is_office_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION m14_private.is_office_member() TO authenticated;
GRANT EXECUTE ON FUNCTION m14_private.is_office_admin() TO authenticated;

CREATE OR REPLACE FUNCTION m14_private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION m14_private.audit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN row_id := to_jsonb(OLD)->>'id';
  ELSE row_id := to_jsonb(NEW)->>'id'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata_json)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, row_id,
    jsonb_build_object('db_role', current_setting('role', true)));
  -- Não copiar nomes, documentos, mensagens, tokens ou conteúdos antigos/novos ao log.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION m14_private.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION m14_private.audit_change() FROM PUBLIC, anon, authenticated;

-- Triggers e RLS em TODAS as tabelas do projeto, sem afetar tabelas alheias.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','clients','leads_intake','cases','case_parties',
    'appointments','payments','payment_events','whatsapp_messages','agent_config',
    'case_documents','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    IF t <> 'audit_logs' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS m14_audit ON public.%I', t);
      EXECUTE format('CREATE TRIGGER m14_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.audit_change()', t);
    END IF;
    IF t NOT IN ('audit_logs','payment_events') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS m14_touch ON public.%I', t);
      EXECUTE format('CREATE TRIGGER m14_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.touch_updated_at()', t);
    END IF;
  END LOOP;
END;
$$;
-- Logs são gravados exclusivamente pelo trigger; nem service_role recebe DML direto.
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM service_role;
-- Eventos já recebidos não podem ser apagados pelo serviço de integração.
REVOKE DELETE ON public.payment_events FROM service_role;

-- Leitura interna. Todos os membros ativos pertencem ao MESMO escritório.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','clients','leads_intake','cases','case_parties',
    'appointments','payments','whatsapp_messages','case_documents'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_read ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_member_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_member()))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['agent_config','payment_events','audit_logs'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_admin_read ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_admin_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_admin()))', t);
  END LOOP;
END;
$$;

-- CRUD operacional. Sem DELETE via navegador; arquivamento por status.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','leads_intake','cases','case_parties'] LOOP
    EXECUTE format('GRANT INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_update ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_member_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT m14_private.is_office_member()))', t);
    EXECUTE format('CREATE POLICY m14_member_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT m14_private.is_office_member())) WITH CHECK ((SELECT m14_private.is_office_member()))', t);
  END LOOP;
END;
$$;
-- Agenda, documentos, mensagens, pagamentos, configuração e profiles:
-- escrita exclusivamente por Edge Functions autenticadas/autorizadas.
-- Isso impede confirmar agenda paga, forjar pagamento ou promover papel pelo browser.
-- As Edge Functions devem checar usuário/membro ANTES de usar service_role.

-- Entrada pública conforme Prompt Master: apenas os campos do formulário.
GRANT INSERT (name, phone, email, practice_area, summary, urgency, consent_version)
  ON public.leads_intake TO anon;
DROP POLICY IF EXISTS m14_public_intake ON public.leads_intake;
CREATE POLICY m14_public_intake ON public.leads_intake
  FOR INSERT TO anon
  WITH CHECK (
    stage = 'novo' AND source = 'portal' AND converted_client_id IS NULL
    AND consent_version = 'privacy-v1'
    AND lgpd_consent_at = now() AND created_at = now() AND updated_at = now()
  );
-- Sem SELECT/UPDATE/DELETE para anon. Usar INSERT com return=minimal, sem .select().
-- 'privacy-v1' é identificador técnico proposto, não política jurídica já aprovada.
-- LIMITAÇÃO: RLS não impõe rate limit/CAPTCHA. Antes do portal público:
-- preferir leads-intake Edge + antiabuso, REVOGANDO este GRANT direto em migration.
-- Caso contrário chamadas diretas à REST API contornam o CAPTCHA do frontend.

COMMIT;
```

## Validação realizada

Validação estática: parser PostgreSQL e funções PL/pgSQL aprovados; templates SQL dinâmicos analisados; vercel.json válido; 12 tabelas incluídas em RLS. Nenhum comando SQL executado. Testes de execução, permissões, idempotência e integração pendentes de autorização e ambiente de teste.
