# M14 Advocacia — Matheus Moraes

Portal público (Fases 1–2) e CRM interno (Fases 3–6), agenda e financeiro InfinitePay. React + Vite + TypeScript + Tailwind, Supabase Auth/Postgres e hospedagem Vercel.

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
- `/crm`: Hoje no Escritório, prazos, reuniões, SLA e cobranças.
- `/crm/funil`: seis etapas, busca, SLA e conversão.
- `/crm/clientes`: clientes, contato, endereço e casos vinculados.
- `/crm/conta`: perfil editável com OAB/UF, telefone/bio e alteração da própria senha com confirmação e mínimo de 8 caracteres.
- `/crm/agenda`: calendário, criação/edição de compromissos e calculadora auxiliar de prazos CPC.
- `/crm/financeiro`: cobranças InfinitePay, consultas pagas e conferência no provedor.
- `/crm/hub`: ficha 360º, WhatsApp/ligações, documentos privados, DataJud, agenda/financeiro, e-mails e kit inicial revisável para impressão/PDF.
- `/crm/emails`: triagem de correspondência com prioridade auxiliar, CNJ e vínculo revisado.
- `/crm/copiloto`: agente interno e base oficial por área/jurisdição, atualização manual e citação validada.
- `/crm/agente`: configuração admin do tom do Matheus e autorizações de IA.
- `/pagamento/retorno`: retorno público do comprador, sem baixa por parâmetros da URL.

## Intake público e Turnstile

O envio só é habilitado com `VITE_INTAKE_ENABLED=true`, uma `VITE_TURNSTILE_SITE_KEY` configurada e token Turnstile válido. Desabilitado ou sem site key, o portal oferece WhatsApp e não carrega o widget. O secret Turnstile, `INTAKE_HASH_SECRET` (32+ caracteres) e `INTAKE_ENABLED` ficam exclusivamente na Edge Function. Expiração ou falha invalida o token; cada tentativa exige nova verificação.

A Edge Function usa `public.check_intake_rate_limit`, executável somente por `service_role`, mantendo `m14_private` fora da Data API. CAPTCHA, configuração ou RPC com falha bloqueiam o INSERT. Reaplicar o SQL da Fase 2 corrigido e publicar a Edge Function antes de habilitar o intake.

## Hub jurídico, WhatsApp, documentos e IA

`/crm/hub` reúne conversa, ligações, documentos privados, casos, agenda e financeiro por contexto. Os atalhos levam os IDs existentes; não recadastram o cliente. `/crm/agente` é exclusivo do admin para exemplos de estilo e conhecimento. A IA é interna e revisável; não envia respostas automaticamente. DataJud consulta somente metadados públicos, sem contornar sigilo.

## Supabase e Vercel

Siga o [checklist único de implantação](docs/implantacao-unica.md) e os relatórios de [auditoria/benchmark da Fase 5](docs/fase5-auditoria.md) e [refinamento/auditoria da Fase 6](docs/fase6-auditoria.md). Os SQLs em `supabase/review/` são revisões, não migrations descobertas por `db push`. A Fase 6 acrescenta `phase6-refinement-and-legal-hub.sql` às fases anteriores, com 17 Edge Functions no total. Nenhum SQL é aplicado pelo build, e flags de integração permanecem desabilitadas até configuração/aceite.

## Validação

```sh
npm run build
npm test
npm run test:browser
```

`npm test` aplica as seis fases em suítes de integração em Postgres WASM descartável (PGlite), exercita RLS, ACLs, RPC, deduplicação, conflitos e rollback. Não acessa o banco hospedado. Os testes da Edge Function executam o código em runtime simulado com respostas de Siteverify/Supabase controladas, incluindo falha fechada, aprovação financeira, Svix/HMAC, SMTPS, kit e bloqueio de citação jurídica sem suporte. Os testes de prazos cobrem o CPC e as conversões de fuso. Os testes de navegador usam Chromium e simulam as respostas HTTP do Supabase/BrasilAPI/InfinitePay/WhatsApp/IA; verificam a interface e o contrato das chamadas. Por padrão usam `/usr/bin/chromium`; informe `CHROMIUM_PATH` para outro executável. Uma instalação local também pode usar `npx playwright install chromium` e apontar `CHROMIUM_PATH` para o binário instalado.

A confirmação final no Supabase/Vercel requer aplicar os scripts, configurar os valores públicos e usar uma conta interna. Nenhum SQL é aplicado automaticamente pelo build.
