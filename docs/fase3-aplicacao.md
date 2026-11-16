# Fase 3 — aplicação e aceite

Projeto alvo: `neotdgoftxkfaljpmddk` (`https://neotdgoftxkfaljpmddk.supabase.co`).

## Resultado da validação da base

A publicação original deixou arquivos de `src/`, `supabase/` e `docs/` soltos na raiz. A árvore foi restaurada usando o ZIP já versionado, sem recriar o schema ou o portal. Os arquivos soltos idênticos foram realocados para seus diretórios; o ZIP original foi preservado. A primeira compilação após recuperar a estrutura encontrou TS2339 em `import.meta.env`; `src/vite-env.d.ts` corrige a declaração de tipos do Vite. O lockfile foi incluído e a versão do cliente Supabase resolvida pelo `npm install` foi fixada.

## Checklist Supabase — executar pelo responsável

Os scripts abaixo não foram aplicados ao projeto hospedado nesta entrega. Inspecione o schema existente antes de executá-los: `IF NOT EXISTS` não corrige divergências de colunas/constraints. Faça backup conforme a política do escritório.

- [ ] Confirmar projeto e obter um snapshot do schema atual. Não executar em outro projeto.
- [ ] Em instalação nova: executar `supabase/review/phase1-schema.sql` no SQL Editor como `postgres`.
- [ ] Executar `supabase/review/phase2-intake.sql` logo após a Fase 1: revoga o INSERT público direto de leads.
- [ ] Executar `supabase/review/phase3-crm.sql` após as duas anteriores.
- [ ] Se Fases 1–2 já foram aplicadas e conferidas, reaplicar a Fase 2 corrigida deste PR antes da Fase 3; o wrapper público de rate limit foi adicionado nesta revisão. Se a Fase 3 já estiver aplicada, reaplicar apenas a Fase 2 corrigida é suficiente para esta correção do intake. Reaplicar a Fase 1 isoladamente pode restabelecer permissões que as fases seguintes revogam. Se reaplicar tudo, manter a ordem 1 → 2 → 3.
- [ ] Manter `m14_private` fora dos schemas expostos na Data API. Expor `public`, incluindo as RPCs públicas da Fase 3.
- [ ] Criar/convidar o usuário da equipe em Authentication. Não criar senha ou conta no frontend.
- [ ] Cadastrar `profiles` com o mesmo UUID de `auth.users`, `full_name`, `role` (`admin`/`staff`) e `is_active=true`. Não existe promoção de papel via navegador.
- [ ] Verificar os advisors de segurança/performance no Dashboard e as políticas RLS das tabelas antes de liberar acesso.

Exemplo de provisionamento de perfil, a adaptar no SQL Editor após criar a identidade Auth:

```sql
INSERT INTO public.profiles(id, full_name, role, is_active)
VALUES ('UUID-REAL-DO-USUARIO-AUTH', 'Nome do membro', 'staff', true);
```

## Edge Function `leads-intake` — correções do intake público

- [ ] Conferir `supabase/config.toml`: `verify_jwt=false` é intencional para o intake público. A credencial de serviço fica somente no ambiente da Edge Function.
- [ ] Reaplicar `phase2-intake.sql` corrigido para criar `public.check_intake_rate_limit`. A função pública é `SECURITY INVOKER`, com `REVOKE ALL FROM PUBLIC, anon, authenticated` e execução apenas por `service_role`. O núcleo privilegiado e os contadores com RLS permanecem em `m14_private`, sem expor esse schema na Data API. O `GRANT USAGE` ao serviço serve somente para resolver a chamada interna.
- [ ] Configurar `APP_ORIGIN` ou `ALLOWED_ORIGINS` com origens HTTPS exatas do portal (sem caminho; incluir previews que serão usados). O hostname do token precisa pertencer a essas origens.
- [ ] Configurar `INTAKE_HASH_SECRET` aleatório, exclusivo e com pelo menos 32 caracteres. Não existe mais salt padrão; IP bruto e token CAPTCHA não são inseridos no lead.
- [ ] Criar/configurar o widget Turnstile no Cloudflare com os domínios do portal permitidos. Usar sua site key pública em `VITE_TURNSTILE_SITE_KEY` e o secret correspondente somente em `TURNSTILE_SECRET_KEY` da Edge Function. Nunca usar as chaves de teste em produção.
- [ ] Publicar a Edge Function atualizada com `supabase functions deploy leads-intake --project-ref neotdgoftxkfaljpmddk` após conferir o projeto e autenticar o CLI.
- [ ] Inicialmente manter `VITE_INTAKE_ENABLED=false` e `INTAKE_ENABLED=false`. Habilitar ambos somente depois de aplicar o SQL corrigido, configurar as chaves e testar em homologação; alterar `VITE_*` exige novo build Vercel.

O widget usa renderização explícita no segundo passo, com action `leads_intake`. Só habilita envio após receber token; expiração/erro/timeout invalidam o token. Voltar ao primeiro passo remove o widget. Cada tentativa HTTP consome o token e remonta a verificação, inclusive em erro de rede/servidor. Falha ao carregar o script bloqueia envio e oferece nova tentativa. Se `VITE_INTAKE_ENABLED` não for exatamente `true`, ou a site key estiver ausente, não há formulário nem carregamento do script: o portal oferece WhatsApp.

A Edge Function verifica o token no Siteverify com timeout, exige sucesso, action `leads_intake` e hostname permitido. Ausência de secrets/configuração retorna 503; token inválido/expirado/repetido ou falha no Siteverify retorna 403. Depois chama `.rpc('check_intake_rate_limit', ...)` no schema público: falso retorna 429 e erro/resultado inesperado retorna 503. Nenhuma dessas falhas prossegue para INSERT. O projeto Supabase não precisa expor `m14_private`.

## Vercel

- [ ] Configurar `VITE_SUPABASE_URL=https://neotdgoftxkfaljpmddk.supabase.co`.
- [ ] Configurar `VITE_TURNSTILE_SITE_KEY` com a site key pública e manter `VITE_INTAKE_ENABLED=false` até o aceite do intake.
- [ ] Configurar `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave pública do projeto (nunca `service_role`).
- [ ] Completar os demais valores públicos de `.env.example`, inclusive a identificação profissional já prevista no portal.
- [ ] Manter build `npm run build`, output `dist` e o rewrite SPA de `vercel.json`. Os acessos diretos a `/crm/login`, `/crm/clientes`, `/crm/agenda` e `/crm/financeiro` precisam servir `index.html`.
- [ ] Fazer novo deploy após alterar `VITE_*`, pois são incorporadas ao bundle no build.

## Decisões de segurança e conversão

- Auth é verificado com `getUser()` e leitura de perfil ativo antes de montar o painel. O perfil é revalidado ao recuperar foco e a cada minuto; a RLS autoriza cada operação no banco independentemente da tela.
- `review_lead_conversion` e `convert_lead` são wrappers `SECURITY INVOKER`. O núcleo privilegiado está em `m14_private.crm_action`, com `search_path=''`, ACL restrita e checagem explícita de `auth.uid()`/membro ativo. O privilégio é necessário para vincular mensagens sem liberar escrita arbitrária no WhatsApp ao browser.
- O lead é lido com `FOR UPDATE`; uma trava consultiva transacional serializa conversões de leads diferentes. A checagem trava `case_parties` durante a operação. `cases.source_lead_id` permanece único.
- CPF e CNPJ são normalizados e validados por dígitos verificadores no servidor. O formato alfanumérico de CNPJ previsto no schema também é aceito; a consulta BrasilAPI usa apenas CNPJ numérico com 14 dígitos.
- O cliente é reutilizado pela chave única `(document_type, document_number)`. Nome igual sem documento não gera mesclagem automática. Dados de clientes já existentes são preservados; os dados recém-preenchidos não os sobrescrevem.
- A busca compara documentos e nomes exatos após normalizar caixa, espaços e acentos comuns. Busca tanto o cliente quanto a parte adversa conhecida em `case_parties`, incluindo o nome canônico do cliente reutilizado. Uma ocorrência de `cliente` com o mesmo documento validado é um vínculo esperado, não um conflito por si só. Demais coincidências bloqueiam a conversão para revisão jurídica, sem botão de contorno. Nomes aproximados/aliases e partes ainda desconhecidas exigem análise humana.
- Um token vincula a revisão aos dados preenchidos e às ocorrências encontradas. Alteração dos dados ou das ocorrências exige nova revisão; a checagem é executada novamente dentro da conversão. A confirmação humana é exigida na interface. O token não é credencial de autorização nem prova de leitura humana.
- Criação/edição direta de clientes, casos e partes foi revogada para `authenticated`. No intake, o membro só pode atualizar `stage`; fechamento exige a RPC, e leads convertidos não mudam de etapa. Essas restrições são deliberadas para evitar contornar as invariantes.
- A transação cria caso e partes, vincula mensagens existentes pelo `lead_id` (preservando o lead e o conteúdo) e fecha o lead. Uma mensagem já ligada a outro cliente cancela toda a operação. Repetir a mesma conversão retorna os IDs existentes sem duplicar registros.
- Auditoria usa os triggers da Fase 1, registra o ator e os IDs das entidades; não copia documentos, nomes ou conteúdos para os metadados de log.
- A consulta BrasilAPI é opcional e iniciada pelo usuário; envia somente CNPJ/CEP ao serviço. Falhas ou timeout permitem preenchimento manual.

## Aceite após publicação

- [ ] Com intake desabilitado ou sem site key: exibir WhatsApp, não carregar Turnstile nem enviar requisição de cadastro.
- [ ] Em homologação com chaves correspondentes: validar o widget e confirmar envio com token, action e hostname corretos. Tentar enviar antes de validar, após expiração e após falha/repetição: bloquear e exigir nova verificação.
- [ ] Simular indisponibilidade do rate limit: retornar 503 sem INSERT. Exceder o limite: retornar 429. Conferir que `anon` e `authenticated` não executam a RPC pública.

- [ ] Abrir `/crm/clientes` sem sessão: mostrar login e não consultar as tabelas internas.
- [ ] Entrar com conta sem perfil ou com perfil inativo: negar o painel. Entrar com membro ativo: carregar o funil.
- [ ] Mover lead não convertido entre etapas abertas e arquivar/reabrir. Confirmar que fechamento direto é negado.
- [ ] Consultar CNPJ e CEP; conferir os resultados; testar indisponibilidade da BrasilAPI e preenchimento manual.
- [ ] Converter lead com documento válido e sem conflito. Conferir cliente, caso, partes, lead fechado, auditoria e vínculo das mensagens.
- [ ] Repetir a chamada da conversão e converter outro lead com o mesmo documento: um cliente, um caso por lead, sem duplicar mensagens.
- [ ] Conferir conflito por documento e por nome/acento; alterar partes em outra sessão após revisar: exigir nova revisão ou bloquear.
- [ ] Em duas sessões simultâneas, converter o mesmo lead e leads diferentes para o mesmo documento. Os testes locais verificam idempotência/reutilização, mas o teste com conexões simultâneas deve ser repetido no ambiente de homologação.
- [ ] Desativar o perfil durante a sessão: RLS nega as operações; a revalidação fecha o painel.
- [ ] Validar navegação móvel, clientes/casos, placeholders Fase 4 e logout.

## Evidência local e limites

`npm run build` executa TypeScript em modo estrito e compila o bundle. `npm test` verifica a Edge Function em um runtime simulado (Siteverify e cliente Supabase simulados), incluindo falha fechada, token inválido, action/hostname, erro da RPC, 429 e envio válido. Também aplica as Fases 1–3 e reaplica Fase 3 em PGlite descartável: documentos (inclusive CNPJ alfanumérico), anon/inativos/sem perfil, ACLs, conversão, auditoria, repetição, reutilização, conflitos, revisão desatualizada e rollback completo. `npm run test:browser` usa Chromium com HTTP simulado: login, bloqueio de perfil inativo, Kanban, consultas, revisão, conversão, revogação de acesso, clientes/casos, erros e mobile. Os novos cenários de intake simulam o script Turnstile para testar bloqueio, expiração, renovação após falha, remoção ao voltar e carregamento indisponível; ambientes separados cobrem intake desabilitado e site key ausente.

Esses testes não comprovam a configuração do Supabase hospedado, a disponibilidade real da BrasilAPI ou o deploy Vercel. Nenhum dado real de cliente foi utilizado. O aceite acima fecha essas fronteiras após aplicação pelo responsável.
