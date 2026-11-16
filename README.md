# M14 Advocacia — Matheus Moraes

Portal público (Fases 1–2) e CRM interno (Fase 3). React + Vite + TypeScript + Tailwind, Supabase Auth/Postgres e hospedagem Vercel.

## Desenvolvimento

Requer Node.js 22+ e npm. A estrutura original foi recuperada do ZIP versionado; os arquivos de aplicação ficam em `src/`, os SQLs em `supabase/review/` e a Edge Function em `supabase/functions/leads-intake/`.

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
- `/crm/agenda` e `/crm/financeiro`: módulos identificados como Fase 4, sem operações habilitadas.

## Supabase e Vercel

Siga o [checklist de aplicação da Fase 3](docs/fase3-aplicacao.md). Os SQLs são scripts de revisão, não migrations registradas no CLI. Não use `supabase db push` esperando que ele encontre `supabase/review/`.

## Validação

```sh
npm run build
npm test
npm run test:browser
```

`npm test` aplica as três fases em Postgres WASM descartável (PGlite), exercita RLS, ACLs, RPC, deduplicação, conflitos e rollback. Não acessa o banco hospedado. Os testes de navegador usam Chromium e simulam as respostas HTTP do Supabase/BrasilAPI; verificam a interface e o contrato das chamadas. Por padrão usam `/usr/bin/chromium`; informe `CHROMIUM_PATH` para outro executável. Uma instalação local também pode usar `npx playwright install chromium` e apontar `CHROMIUM_PATH` para o binário instalado.

A confirmação final no Supabase/Vercel requer aplicar os scripts, configurar os valores públicos e usar uma conta interna. Nenhum SQL é aplicado automaticamente pelo build.
