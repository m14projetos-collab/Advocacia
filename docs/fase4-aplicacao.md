# Fase 4 — Minha Conta, Agenda, Prazos e InfinitePay

Projeto: `neotdgoftxkfaljpmddk`. Esta entrega contém código, SQL de revisão e testes. Não aplica SQL, não publica Edge Functions e não realiza transações financeiras no projeto hospedado.

## Fluxos disponíveis

- `/crm/conta`: perfil do usuário autenticado, e-mail Auth e troca de senha com mínimo de 8 caracteres e confirmação. Não altera `profiles` nem papéis. Usa `auth.updateUser({ password })`; senha atual e nonce são enviados somente quando informados para as políticas adicionais. A interface permite solicitar reautenticação por e-mail.
- `/crm/agenda`: calendário mensal e lista do dia, consultas, audiências, prazos e compromissos internos. Criação/edição via Edge Function `appointments`, com versão otimista (`updated_at`), validação de vínculos e conflito de horários. A agenda representa o escritório inteiro, sem alocação por advogado/sala. Consultas pendentes também reservam horário; prazos não ocupam intervalo. A edição permite cancelamento/conclusão; consulta paga exige baixa confirmada para confirmar/concluir.
- Calculadora auxiliar: dias úteis, suspensão de 20/12 a 20/01 inclusive, exclusão do começo e inclusão do vencimento. Aceita dia do começo/publicação já definida ou disponibilização no DJE (calcula a publicação no próximo dia útil). Feriados, dias sem expediente e suspensões extraordinárias são informados pelo operador. Resultado, memória de cálculo e uso da data em um novo prazo. Não define intimação, não consulta calendários de tribunais nem substitui revisão jurídica; a hora limite do compromisso é preenchida pelo responsável.
- `/crm/financeiro`: cobranças por cliente/caso, vínculo a consulta pendente, link de pagamento e conferência manual autenticada no provedor quando o webhook não chegar. Valores em centavos e `order_nsu` igual ao UUID do pagamento.
- `/pagamento/retorno`: página pública neutra para o comprador, sem acesso ao CRM. Limpa os parâmetros da URL e não confirma pagamento com base neles.

## Aplicação do SQL

- [ ] Conferir projeto e schema atual; manter backup conforme as rotinas do escritório.
- [ ] Confirmar aplicação das Fases 1, 2 corrigida e 3. Não reaplicar Fase 1 isoladamente: ela redefine permissões que as fases seguintes restringem.
- [ ] Inspecionar possíveis registros anteriores de cobrança que conflitem com os índices novos:

```sql
SELECT appointment_id, count(*) FROM public.payments
WHERE appointment_id IS NOT NULL AND status NOT IN ('canceled','refunded','failed')
GROUP BY appointment_id HAVING count(*) > 1;
```

- [ ] Aplicar `supabase/review/phase4-agenda-finance.sql` no SQL Editor como `postgres`. O arquivo não é uma migration descoberta por `supabase db push`.
- [ ] Manter `m14_private` fora dos schemas expostos na Data API.
- [ ] Conferir RLS e advisors no Dashboard. O navegador continua sem INSERT/UPDATE/DELETE em `appointments`, `payments` e `payment_events`, e sem EXECUTE nas RPCs de Fase 4.

A revisão adiciona `created_by`, `checkout_state`, `transaction_nsu` e `review_required` em pagamentos, índice de transação única e uma cobrança ativa por agendamento. Reaplicação foi testada sem perder registros. `IF NOT EXISTS` não corrige drift de definições anteriores.

## Auth / Minha Conta

- [ ] Em Authentication → configurações de senha, definir mínimo **8 ou mais** também no servidor. A validação da interface não substitui a política Auth para chamadas diretas à API.
- [ ] Conferir as políticas de senha atual, reautenticação e envio de e-mail, quando habilitadas.
- [ ] Usar contas Auth reais com `profiles.is_active=true`; a seção consulta apenas o UUID retornado por `getUser()`.

## Publicação das Edge Functions

Configuração em `supabase/config.toml`: `verify_jwt=false` nas três funções. Em `appointments` e `infinitepay-checkout`, o JWT Bearer é validado explicitamente via `getUser(jwt)` e o perfil ativo é conferido **antes** de acessar a RPC de serviço. O webhook recebe o provedor sem JWT e sempre faz confirmação externa antes da baixa.

- [ ] Configurar `APP_ORIGIN` ou `ALLOWED_ORIGINS` com origens exatas da aplicação (incluir previews utilizados).
- [ ] Configurar `PUBLIC_APP_URL` com a origem HTTPS pública do portal, sem caminho/query, por exemplo `https://dominio-do-escritorio.example`. Não usar uma rota do CRM como retorno do comprador.
- [ ] Configurar `INFINITEPAY_HANDLE=matheus-moraes-tsd` e, inicialmente, `INFINITEPAY_ENABLED=false`.
- [ ] Habilitar Checkout Integrado na conta InfinitePay do escritório e confirmar que a handle corresponde à conta correta.
- [ ] Recomenda-se configurar `INFINITEPAY_API_KEY` no backend para enviar `options.single_payment=true`. Sem chave, a criação por handle é suportada pelo provedor, mas o link pode aceitar mais de um pagamento. A chave nunca vai para `VITE_*` ou para o navegador.
- [ ] `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` ficam somente no ambiente Edge, normalmente já fornecidos pelo Supabase. Não criar variáveis públicas com esses segredos.
- [ ] Autenticar o CLI e conferir o projeto antes de publicar:

```sh
supabase functions deploy appointments --project-ref neotdgoftxkfaljpmddk
supabase functions deploy infinitepay-checkout --project-ref neotdgoftxkfaljpmddk
supabase functions deploy infinitepay-webhook --project-ref neotdgoftxkfaljpmddk
```

- [ ] Habilitar `INFINITEPAY_ENABLED=true` somente após configuração e aceite controlado. O formulário não tem fallback de pagamento fictício.
- [ ] Publicar o frontend com o rewrite SPA existente em `vercel.json`. Preservar as variáveis públicas Supabase e Turnstile já configuradas. Fase 4 não adiciona segredos ao frontend.

## Transações, autorização e recuperação

As RPCs públicas de Fase 4 são `SECURITY INVOKER`, executáveis exclusivamente por `service_role`. `p_actor` é preenchido pela Edge com o usuário validado, nunca repassado do body. O banco também bloqueia o perfil ativo durante a operação e atribui essa identidade aos triggers de auditoria. Baixas automáticas registram ator nulo como ação de serviço, sem fingir identidade humana.

A criação da cobrança é persistida antes da chamada externa. O UUID gerado pela interface é reutilizado em tentativas da mesma cobrança; dados financeiros divergentes com o mesmo UUID são rejeitados. Requisições concorrentes não repetem a criação de link para uma ordem existente. `creating`/`unknown` sem URL exige conferência; timeout não prova falha no provedor, então o sistema não cria outro link automaticamente. O fluxo de conferência manual aceita os identificadores da transação e faz `payment_check`, sem permitir marcar pago livremente. Se o link tiver sido gerado, mas a resposta tiver se perdido e não houver transação, conferir na InfinitePay antes de criar outra cobrança; não existe consulta documentada de link apenas por `order_nsu`.

O checkout recebe uma descrição genérica de serviço, sem o resumo jurídico interno ou os dados pessoais do cliente. API Key, se configurada, é enviada somente no header da chamada ao provedor. As URLs do provedor são validadas como HTTPS em domínio InfinitePay. O vencimento do banco é administrativo; não significa expiração do link no provedor.

O webhook não possui assinatura documentada. Os campos recebidos servem apenas para consultar `payment_check` na API fixa da InfinitePay com a conta configurada. Exige `success=true`, `paid=true` e `amount` igual ao valor local; `paid_amount` pode diferir por taxas. Não confia no valor/status do payload nem na URL de retorno.

A RPC bloqueia a cobrança e registra a chave `(payment_id, transaction_nsu)` em `payment_events`, atualiza o pagamento e confirma a consulta pendente na mesma transação. Repetições não duplicam eventos. Outro pagamento verificado para a mesma cobrança gera ocorrência de revisão sem sobrescrever a primeira transação. Callback tardio não reabre consulta cancelada e sinaliza conferência. Erro na confirmação da agenda reverte também pagamento e evento. Trava transacional serializa as operações da agenda/financeiro do escritório.

A URL simples `webhook_url` é usada para notificações de aprovação. Eventos não comprovados de estorno, cancelamento ou liquidação não são aplicados automaticamente: `payment_check` documenta aprovação, não um estado autenticado completo desses eventos. Estornos/cancelamentos de venda são operados na conta InfinitePay e exigem reconciliação administrativa. Não há botão que marque pagamento como pago ou estornado sem verificação.

## Testes e aceite

```sh
npm run build
npm test
npm run test:browser
# Com Deno instalado:
deno check supabase/functions/appointments/index.ts supabase/functions/infinitepay-checkout/index.ts supabase/functions/infinitepay-webhook/index.ts
```

Testes locais aplicam as quatro fases em Postgres WASM descartável (PGlite), verificam RLS/ACLs, ator, conflitos/versão, coerência dos vínculos, replay, valor divergente, aprovação/duplicidade, cancelamento tardio, rollback e reaplicação. Os testes de Edge executam o código com cliente Supabase e respostas InfinitePay simulados. Os testes de navegador verificam interface e contrato HTTP simulado. A calculadora cobre suspensão, DJE, fins de semana, exclusões, datas inválidas, ano bissexto e conversão São Paulo.

Antes de habilitar em produção:

- [ ] Trocar senha com menos de 8 caracteres, confirmação divergente, senha aceita e política de reautenticação real. Verificar novo login após alteração.
- [ ] Criar/editar consulta, audiência e prazo; testar horários adjacentes, conflito, cancelamento e duas sessões editando a mesma versão.
- [ ] Conferir prazos com calendário oficial do tribunal e regra de intimação; comparar a memória de cálculo com análise manual.
- [ ] Criar cobrança vinculada com pagamento exigido. Verificar que o navegador não grava diretamente nem executa RPCs de serviço.
- [ ] Validar webhook repetido, pagamento divergente, erro de provedor, callback após cancelamento e comportamento de revisão de pagamento extra.
- [ ] Conferir atualização da agenda após a baixa usando “Atualizar calendário” e da cobrança usando “Atualizar financeiro”; não depende de configuração de Realtime.
- [ ] Testar concorrência real entre conexões em homologação. PGlite usa uma conexão serializada e não substitui esse aceite.
- [ ] A InfinitePay informa que **não possui sandbox**. Nenhum link/cobrança real foi criado nos testes desta entrega. Qualquer compra de aceite de baixo valor deve ser decidida e realizada pelo responsável da conta, com conferência do crédito e eventual estorno no provedor.

## Fontes consultadas

- [CPC vigente, arts. 219, 220 e 224 — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105compilada.htm)
- [Checkout e confirmação — documentação oficial InfinitePay](https://www.infinitepay.io/checkout-documentacao)
- [Supabase Auth: updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)
- [Supabase: política de senha e reautenticação](https://supabase.com/docs/guides/auth/password-security)
