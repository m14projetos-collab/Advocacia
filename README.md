# M14 Advocacia — Matheus Moraes

Portal público (Fases 1–2) e CRM interno (Fases 3–5), agenda e financeiro InfinitePay. React + Vite + TypeScript + Tailwind, Supabase Auth/Postgres e hospedagem Vercel.

## Desenvolvimento

Requer Node.js 22+ e npm. A estrutura original foi recuperada do ZIP versionado; os arquivos de aplicação ficam em `src/`, os SQLs em `supabase/review/` e as Edge Functions em `supabase/functions/`.

```sh
npm install
cp .env.example .env
npm run dev
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com os valores públicos do projeto. Nunca use `service_role` em `VITE_*`. O CRM exige também um usuário Auth com `profiles.is_active = true`.

## Rotas

- `/`: portal público preservado.
- `/crm/login`: acesso de membros ativos; sem cadastro público de equipe.
- `/crm`: funil com seis etapas, busca, resumo dos leads e conversão.
- `/crm/clientes`: clientes, contato, endereço e casos vinculados.
- `/crm/conta`: perfil e alteração da própria senha com confirmação e mínimo de 8 caracteres.
- `/crm/agenda`: calendário, criação/edição de compromissos e calculadora auxiliar de prazos CPC.
- `/crm/financeiro`: cobranças InfinitePay, consultas pagas e conferência no provedor.
- `/pagamento/retorno`: retorno público do comprador, sem baixa por parâmetros da URL.

## Intake público e Turnstile

O envio só é habilitado com `VITE_INTAKE_ENABLED=true`, uma `VITE_TURNSTILE_SITE_KEY` configurada e token Turnstile válido. Desabilitado ou sem site key, o portal oferece WhatsApp e não carrega o widget. O secret Turnstile, `INTAKE_HASH_SECRET` (32+ caracteres) e `INTAKE_ENABLED` ficam exclusivamente na Edge Function. Expiração ou falha invalida o token; cada tentativa exige nova verificação.

A Edge Function usa `public.check_intake_rate_limit`, executável somente por `service_role`, mantendo `m14_private` fora da Data API. CAPTCHA, configuração ou RPC com falha bloqueiam o INSERT. Reaplicar o SQL da Fase 2 corrigido e publicar a Edge Function antes de habilitar o intake.

## Hub jurídico, WhatsApp, documentos e IA

`/crm/hub` reúne conversa, ligações, documentos privados, casos, agenda e financeiro por contexto. Os atalhos levam os IDs existentes; não recadastram o cliente. `/crm/agente` é exclusivo do admin para exemplos de estilo e conhecimento. A IA é interna e revisável; não envia respostas automaticamente. DataJud consulta somente metadados públicos, sem contornar sigilo.

## Supabase e Vercel

Siga o [checklist único de implantação](docs/implantacao-unica.md) e o [relatório de auditoria/benchmark](docs/fase5-auditoria.md). Os SQLs em `supabase/review/` são revisões, não migrations descobertas por `db push`. A Fase 5 acrescenta `phase5-whatsapp-ai.sql` e as Edge Functions descritas no checklist. Nenhum SQL é aplicado pelo build, e flags de integração permanecem desabilitadas até configuração/aceite.

## Validação

```sh
npm run build
npm test
npm run test:browser
```

`npm test` aplica as cinco fases em suítes de integração em Postgres WASM descartável (PGlite), exercita RLS, ACLs, RPC, deduplicação, conflitos e rollback. Não acessa o banco hospedado. Os testes da Edge Function executam o código em runtime simulado com respostas de Siteverify/Supabase controladas, incluindo falha fechada, aprovação financeira e callbacks inválidos. Os testes de prazos cobrem o CPC e as conversões de fuso. Os testes de navegador usam Chromium e simulam as respostas HTTP do Supabase/BrasilAPI/InfinitePay/WhatsApp/IA; verificam a interface e o contrato das chamadas. Por padrão usam `/usr/bin/chromium`; informe `CHROMIUM_PATH` para outro executável. Uma instalação local também pode usar `npx playwright install chromium` e apontar `CHROMIUM_PATH` para o binário instalado.

A confirmação final no Supabase/Vercel requer aplicar os scripts, configurar os valores públicos e usar uma conta interna. Nenhum SQL é aplicado automaticamente pelo build.
