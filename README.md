# M14 Advocacia — Matheus Moraes Advocacia

Portal Público Editorial + Base Supabase (Fase 1 e Fase 2 consolidadas).

## 1. Subir para o GitHub (`m14projetos-collab/Advocacia`)
```bash
git init
git add .
git commit -m "feat: fase 1 e 2 - schema supabase, edge leads-intake e portal matheus moraes"
git branch -M main
git remote add origin https://github.com/m14projetos-collab/Advocacia.git
git push -u origin main
```

## 2. Banco Supabase (`neotdgoftxkfaljpmddk`)
1. Execute `supabase/review/phase1-schema.sql` no SQL Editor (ou via `supabase db push --linked`).
2. Execute `supabase/review/phase2-intake.sql` para revogar o `INSERT` direto de `anon` e ativar o rate limit em `m14_private`.
3. Configure os secrets e publique a Edge Function:
```bash
supabase secrets set ALLOWED_ORIGINS="https://seu-dominio.vercel.app" INTAKE_ENABLED="true" INTAKE_HASH_SECRET="$(openssl rand -hex 32)" --project-ref neotdgoftxkfaljpmddk
supabase functions deploy leads-intake --project-ref neotdgoftxkfaljpmddk
```

## 3. Vercel
Conecte o repositório `m14projetos-collab/Advocacia` e configure as variáveis de `.env.example` (com `VITE_INTAKE_ENABLED=true`).
