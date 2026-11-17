# Auditoria Fases 1–5 e benchmark aplicado

## Base e protocolo

A pesquisa foi iniciada antes das alterações de implementação. O PR #2 ainda estava aberto; após autorização explícita do responsável, foi consolidado na main (`42b778a4cc10a3e7636ad26b14300e4d7fe78b73`). A branch da Fase 5 parte dessa main. `npm install && npm run build` da base passou.

## Benchmark → decisões concretas

| Referência consultada | Padrão observado | Aplicação no M14 |
|---|---|---|
| [Clio Grow — oportunidades](https://help.clio.com/hc/en-us/articles/10272935235099-Track-Prospective-Clients-With-Opportunities-in-Clio-Grow) | Contato, comunicações, documentos e trabalho de intake na mesma ficha; continuidade na conversão | Hub por IDs canônicos de lead/cliente/caso; a conversão mantém mensagens e ligações; mensagem geral continua no cliente até associação humana ao caso |
| [Yuris — gestão do escritório](https://yuris.com.br/gestao-escritorio-advocacia/) | Cadastro central e atendimento ligado ao cliente/processo | Telefone vem do cadastro; mensagens são normalizadas no backend e nunca ficam sem lead ou cliente; links da ficha pré-carregam agenda e financeiro |
| [Lawmatics — intake](https://www.lawmatics.com/client-intake) | Fluxo conectado entre intake, agendamento e documentos | Compromisso abre com contexto; cobranças carregam cliente/caso/consulta; documentos e rascunhos ficam no caso |

O benchmark orienta organização de produto, não copia práticas de marketing estrangeiras. O portal permanece informativo, sem preços públicos, promessas de êxito ou parecer automatizado a prospect.

## Evidência da produção — leitura, sem alterações

Consulta pelo conector Supabase ao projeto `neotdgoftxkfaljpmddk`:

- Admin informado pelo responsável: perfil com `role=admin` e `is_active=true` confirmado. Não foi lida nem alterada senha.
- RLS confirmada em `appointments`, `payments`, `whatsapp_messages`, `agent_config` e `case_documents`.
- `anon` sem SELECT em mensagens; `authenticated` sem INSERT em mensagens e sem UPDATE em pagamentos.
- RPCs `convert_lead` e `check_intake_rate_limit` encontradas. As RPCs de agenda/checkout/confirmação da Fase 4 ainda não apareceram na consulta do banco hospedado.
- A listagem de Edge Functions retornou `functions: []`. Isso impede afirmar que as integrações de produção estavam integralmente publicadas no momento da auditoria. A existência do frontend e do admin não comprova implantação das Edge Functions.
- Advisor: aviso de proteção contra senhas vazadas desativada; conferir plano e configuração de Auth. INFO de RLS sem políticas em `m14_private.intake_rate_limits` é esperado: acesso fechado a usuários, somente serviço.

O checklist único explicita essas pendências. Não houve aplicação de SQL, criação de credenciais, alteração de Auth, leitura de documentos reais ou envio a clientes/provedores. A troca de senha e o fluxo financeiro foram verificados por contratos e testes isolados; não se trocou a senha real do admin nem se criou cobrança de produção.

## Auditoria de código e correções

- Fases 1–4 inspecionadas em conjunto: Auth e profile ativo, E.164, conversão transacional, consentimento do intake, RPC pública restrita de rate limit, agenda, cálculo CPC e confirmação InfinitePay. A Fase 5 preserva o protocolo de `payment_check` e idempotência de `payment_events`.
- Hub reutiliza cadastros e associa conversa ao lead/cliente. Caso não é inferido pelo telefone: mensagens gerais permanecem na ficha do cliente; associação ao caso é explícita. Telefone compartilhado cria triagem com revisão de identidade, sem escolher cliente arbitrariamente.
- Contato de WhatsApp não fabrica consentimento: `lgpd_consent_at` pode ser nulo nessa origem; consentimento do portal é preservado. Os registros recebidos iniciam triagem humana.
- Conversão Fase 3 agora propaga cliente/caso para ligações e roteamento futuro, na mesma transação. Outbox usa UUID estável, janela de 24h vinculada ao número recebido e estado incerto sem reenvio automático.
- Criação/edição/download/configuração sensíveis continuam em Edge Functions autenticadas; assinatura autentica os eventos externos. O navegador não tem gravação direta nem acesso a binários por políticas genéricas.
- Documentos são validados por tamanho/MIME/assinatura básica de arquivo e recebidos pela Edge. URLs de download duram 60s. Não são usadas signed upload URLs de 2 horas. A validação básica não é um antivírus.
- DataJud deriva o tribunal de CNJ com checksum; endpoint é fixo/allowlist. Caso marcado sigiloso é bloqueado antes da consulta. Ausência pública não confirma sigilo. Fonte CNJ/DataJud e momento da consulta são exibidos.
- IA interna: configuração admin, trava OAB não desativável, autorização por geração e autorização admin adicional para documentos. Prospect recebe somente modelo administrativo determinístico. Para casos, usa SDK real, contexto limitado e rascunho revisável; não há tools nem envio automático. Segredos nunca entram no prompt.
- O assistente público deixou de alegar preparação de resumo que não executava. A descrição pública de Saúde foi ajustada para não sugerir garantia de resultado.
- Fontes e imagens externas reproduziam erros de certificado no navegador de teste. As mesmas fontes e imagens já utilizadas pelo escritório passaram a ser servidas localmente, reduzindo dependência e requisições a terceiros. Licenças tipográficas estão em `public/licenses/`.
- Rotas, âncoras e ações de navegação foram testadas com contexto. Agenda/financeiro abrem a ficha correta, sem reentrada de dados já cadastrados.

## Validação executada antes do PR

Em 17/11/2026, na branch da Fase 5:

- `npm install && npm run build`: sucesso, sem erros de TypeScript.
- `npm test`: 56 testes aprovados, zero falhas. Inclui SQL das cinco fases em Postgres local/PGlite, RLS e ACL com anon, inativo, staff e admin; rollback, idempotência e contratos das Edge Functions.
- `deno check supabase/functions/*/index.ts`: as 11 Edge Functions passaram.
- `npm run test:browser`: 25 testes Chromium aprovados, incluindo desktop/mobile, login/perfil inativo, senha, intake/Turnstile, conversão, agenda/CPC, financeiro e Hub/IA/documentos. Os cenários verificam erros de console; o teste de navegação verifica links internos vazios, âncoras e largura mobile.
- `git diff --check`: sem erros de whitespace.

Os fluxos de navegador usam Auth/API simuladas e os contratos de integração usam provedores simulados. O teste SQL usa schema Storage mínimo e não substitui o servidor Storage hospedado, concorrência real ou o gateway de Auth. A leitura do projeto hospedado está descrita acima. Nenhuma dessas evidências afirma que WhatsApp, IA, DataJud ou pagamentos foram habilitados e exercitados com dados reais em produção. O aceite hospedado permanece no checklist único, após publicação do backend e configuração dos provedores.

## Limites técnicos deliberados

- Atendimento individual, sem importação de grupos/status/broadcast. Mensagens de mídia registram a ocorrência na ficha; o arquivo é anexado ao caso pelo fluxo privado. Não se expõe URL temporária do provedor nem se promete transcrição de áudio/OCR.
- Evolution não é tratado como se tivesse HMAC nativo documentado. O código-fonte oficial consultado suporta headers do webhook. Um relay de ingresso autenticado produz HMAC sobre corpo e timestamp para o handler central. Configure ambos os segredos e a instância. LID sem telefone resolvido é recusado para correção/retry, não confirmado silenciosamente.
- O texto livre é limitado à janela de atendimento. Templates aprovados fora dela são operados no provedor; não há disparos de marketing no CRM.
- Não se acessam autos sigilosos pelo DataJud. A consulta guarda apenas metadados públicos selecionados, não autos.
- OCR, captura automática de novas intimações, VoIP/gravação de áudio, envio autônomo de IA e sincronização de calendários externos não são funcionalidades anunciadas por esta entrega.
- Regras de feriados/termo inicial do CPC seguem a Fase 4 e exigem calendário/conferência humana.
- Os acessos mantêm o modelo de um escritório da Fase 1: membros ativos podem ler dados operacionais do escritório; não há compartimentação por advogado. O campo `is_confidential` não cria esse isolamento.

## Fontes técnicas e éticas

- [OAB — Provimento 205/2021](https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021)
- [CNJ — API Pública DataJud](https://www.cnj.jus.br/sistemas/datajud/api-publica/) e [termos/documentação](https://datajud-wiki.cnj.jus.br/api-publica/)
- [Meta — verificação de webhooks](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
- [Evolution — implementação oficial de webhooks e headers](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/event/webhook/webhook.controller.ts)
- [Supabase — buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals) e [signed upload URLs, validade 2h](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)
- SDK IA `ai@7.0.173`: implementação conferida contra documentação/versionamento do pacote e `deno check`, sem modelo fixo presumido.
