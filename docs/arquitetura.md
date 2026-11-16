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

