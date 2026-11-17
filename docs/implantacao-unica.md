# Implantação única e ordenada — M14 Advocacia, Fases 1–6

Alvo: Supabase `neotdgoftxkfaljpmddk`, repositório `m14projetos-collab/Advocacia`, portal `https://advocacia-v3xu.vercel.app`. Este checklist substitui o encadeamento de instruções soltas; os documentos anteriores são referências de cada fase.

## 1. Conferir estado antes de modificar produção

- [ ] Revisar [auditoria e evidências da Fase 6](fase6-auditoria.md), PR de refinamento (Fase 6) e backup do projeto.
- [ ] Conferir se o schema hospedado coincide com as revisões. A auditoria encontrou Fases 1–3, mas não as RPCs Fase 4 e nenhuma Edge Function na listagem. A nova consulta de 17/11/2026 também não encontrou as RPCs Fases 5–6; merge de frontend não aplica SQL. Não pressupor implantação completa só pelo frontend.
- [ ] Identificar drift e cobranças duplicadas por `appointment_id` antes dos índices da Fase 4. Não apagar cadastros nem histórico para contornar constraints.
- [ ] Confirmar admin ativo e políticas Auth: senha mínima 8+, e-mail de reautenticação e proteção de senha vazada quando disponível no plano.

## 2. Aplicar SQL no Supabase, nesta ordem

Em instalação nova, usar SQL Editor como `postgres`:

1. `supabase/review/phase1-schema.sql`.
2. `supabase/review/phase2-intake.sql` corrigido.
3. `supabase/review/phase3-crm.sql`.
4. `supabase/review/phase4-agenda-finance.sql`.
5. `supabase/review/phase5-whatsapp-ai.sql`.
6. `supabase/review/phase6-refinement-and-legal-hub.sql`.

- [ ] Se Fases 1–3 já estiverem aplicadas e conferidas, aplicar somente Fases 4 → 5 → 6 (e reaplicar Fase 2 apenas se o wrapper público corrigido estiver ausente).
- [ ] Nunca reaplicar Fase 1 isoladamente depois das outras: ela redefine permissões operacionais. Estes arquivos são revisões SQL, não migrations descobertas por `db push`.
- [ ] Se reaplicar a Fase 4 ou 5 por correção, reaplicar a Fase 6 depois: ela reforça as RPCs de agenda e contexto. Preservar a ordem evita restaurar definições antigas.
- [ ] Manter `m14_private` fora da Data API. Expor somente `public` e os endpoints/RPCs com ACL apropriada.
- [ ] Confirmar bucket `case-files` com `public=false`, limite 20 MB e MIME PDF/TXT/JPEG/PNG. A política restritiva nega acesso direto de `anon`/`authenticated`, inclusive diante de permissões globais permissivas. Não conceder SELECT/INSERT de objetos desse bucket ao navegador.
- [ ] Conferir RLS e permissões com contas anon, inativa, staff e admin. Novas RPCs são somente `service_role`; escrita do navegador em agenda, pagamentos, mensagens, configurações e documentos deve continuar negada.
- [ ] Conferir advisors; INFO de tabelas privadas fechadas sem política é intencional, não motivo para adicionar acesso amplo.

## 3. Configurar segredos e flags no backend

Usar o Dashboard/gerenciador de segredos. Não colar valores no chat nem criar `VITE_*` para segredos. `supabase/functions/.env.example` lista nomes, sem credenciais reais.

- [ ] `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: somente runtime Edge; normalmente fornecidos pelo projeto.
- [ ] `APP_ORIGIN` ou `ALLOWED_ORIGINS`: origens exatas do portal/previews autorizados.
- [ ] Intake: `INTAKE_ENABLED=false`, `INTAKE_HASH_SECRET` exclusivo com 32+ caracteres e `TURNSTILE_SECRET_KEY` correspondente à site key pública.
- [ ] Financeiro: `INFINITEPAY_ENABLED=false`, `INFINITEPAY_HANDLE=matheus-moraes-tsd`, `PUBLIC_APP_URL` com origem HTTPS do portal. Recomenda-se `INFINITEPAY_API_KEY` para `single_payment=true`.
- [ ] WhatsApp: `WHATSAPP_ENABLED=false` e `WHATSAPP_PROVIDER=meta` ou `evolution`.
- [ ] Meta: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e `META_GRAPH_VERSION` suportada pela conta, no formato `vNN.N`. Não há versão Graph presumida no código.
- [ ] Evolution: `EVOLUTION_API_URL` HTTPS fixa, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN` e `WHATSAPP_RELAY_SECRET` independentes com 32+ caracteres aleatórios. Não usar API key no corpo como prova de autenticidade.
- [ ] IA: `LEGAL_AI_ENABLED=false`, `AI_GATEWAY_API_KEY`, `LEGAL_AI_MODEL` com ID `provider/model` disponível na conta. Conferir suporte a PDF/imagens, região, retenção, subprocessadores e base legal antes de autorizar contexto sensível. Não reutilizar `LLM_API_KEY` genérica sem contrato compatível.
- [ ] DataJud: `DATAJUD_API_KEY` atual publicada pelo CNJ, somente no backend. API não fornece autos protegidos.

### E-mail transacional e triagem (Fase 6)

- [ ] Configurar `EMAIL_ENABLED=false`, `EMAIL_PROVIDER=resend` ou `smtp` e `EMAIL_FROM` como endereço puro verificado. Resend exige domínio/remetente verificado e `RESEND_API_KEY`. SMTP usa `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` e TLS direto na porta 465; conferir disponibilidade no provedor e no runtime. As portas 25/587 não são usadas.
- [ ] Configurar `EMAIL_INBOUND_ENABLED=false`, `EMAIL_INBOUND_PROVIDER=resend` ou `relay` e `EMAIL_INBOUND_TO` com a caixa autorizada. Recebimento e envio são capacidades distintas; a API de envio não fornece uma caixa de entrada histórica.
- [ ] Resend Receiving: apontar MX/encaminhamento do endereço de entrada e assinar evento `email.received` em `https://neotdgoftxkfaljpmddk.supabase.co/functions/v1/email-inbound-webhook`. Salvar `RESEND_WEBHOOK_SECRET` Svix (`whsec_...`) e API key com acesso à consulta do e-mail recebido. O handler valida assinatura/corpo bruto, timestamp ±5min, busca corpo na API fixa e confere o destino. Anexos não são baixados automaticamente.
- [ ] Alternativa para caixa SMTP/provedor existente: configurar encaminhamento para relay próprio que envie JSON `{id, email:{from,to:["caixa autorizada"],subject,text}}`, com `x-email-timestamp` em segundos e `x-email-signature: sha256=<hex HMAC SHA256(timestamp + '.' + corpo bruto)>`, usando `EMAIL_RELAY_SECRET` de 32+ caracteres. O handler não confia em endereço do remetente como autenticação. Não é um cliente IMAP/webmail.
- [ ] Só habilitar `EMAIL_TRIAGE_AI_ENABLED` após avaliar o tratamento de correspondência pelo provedor IA; também exige `LEGAL_AI_ENABLED`, chave e modelo. Sem autorização/configuração ou em falha de modelo, a entrada é preservada com `classification_method=rules`, visível na interface. Confirmar sugestões manualmente; nunca inferir prazo processual apenas do texto do e-mail.
- [ ] Habilitar entrada e envio separadamente após testar com contatos de teste autorizados. Envios exigem prévia do conteúdo/destinatário, token de versão e revisão. Timeout fica incerto sem reenvio automático. Conferir o provedor antes de criar outra tentativa.

## 4. Publicar todas as Edge Functions e verificar autenticação

Após autenticar o CLI e conferir o projeto:

```sh
supabase functions deploy leads-intake --project-ref neotdgoftxkfaljpmddk
supabase functions deploy appointments --project-ref neotdgoftxkfaljpmddk
supabase functions deploy infinitepay-checkout --project-ref neotdgoftxkfaljpmddk
supabase functions deploy infinitepay-webhook --project-ref neotdgoftxkfaljpmddk
supabase functions deploy case-hub --project-ref neotdgoftxkfaljpmddk
supabase functions deploy whatsapp-send --project-ref neotdgoftxkfaljpmddk
supabase functions deploy whatsapp-webhook --project-ref neotdgoftxkfaljpmddk
supabase functions deploy whatsapp-evolution-relay --project-ref neotdgoftxkfaljpmddk
supabase functions deploy case-files --project-ref neotdgoftxkfaljpmddk
supabase functions deploy datajud-lookup --project-ref neotdgoftxkfaljpmddk
supabase functions deploy legal-agent --project-ref neotdgoftxkfaljpmddk
supabase functions deploy product-hub --project-ref neotdgoftxkfaljpmddk
supabase functions deploy initial-kit --project-ref neotdgoftxkfaljpmddk
supabase functions deploy email-send --project-ref neotdgoftxkfaljpmddk
supabase functions deploy email-inbound-webhook --project-ref neotdgoftxkfaljpmddk
supabase functions deploy sync-legal-updates --project-ref neotdgoftxkfaljpmddk
supabase functions deploy legal-copilot --project-ref neotdgoftxkfaljpmddk
```

- [ ] `verify_jwt=false` é deliberado: rotas humanas verificam Bearer por `getUser` e profile ativo antes de usar serviço. Configuração do agente exige admin também no SQL. Não retirar essas verificações.
- [ ] Webhooks são autenticados pelo protocolo do provedor: WhatsApp por HMAC; InfinitePay por `payment_check` antes da baixa. Eles não fingem ter JWT humano nem registram ator humano fictício.
- [ ] Fazer teste não autenticado em cada rota humana: deve negar acesso, sem gravar dados ou emitir URL de documento.

## 5. Configurar o WhatsApp escolhido

**Meta Cloud API:**

- [ ] Registrar URL `https://neotdgoftxkfaljpmddk.supabase.co/functions/v1/whatsapp-webhook` e verify token. Ativar `WHATSAPP_ENABLED` quando segredos estiverem corretos para testar o handshake.
- [ ] Assinar eventos de mensagens da conta/número do escritório; `phone_number_id` precisa corresponder ao configurado. HMAC usa `X-Hub-Signature-256` sobre bytes originais.
- [ ] Enviar mensagem a partir de um contato de teste autorizado. Conferir card do cliente ou lead de triagem; repetir callback para confirmar dedupe.

**Evolution (alternativa):**

- [ ] Na instância, configurar webhook para `https://neotdgoftxkfaljpmddk.supabase.co/functions/v1/whatsapp-evolution-relay`, evento `MESSAGES_UPSERT`, sem sufixo por evento.
- [ ] Configurar header `Authorization: Bearer <EVOLUTION_WEBHOOK_TOKEN>` no provedor. O relay valida o ingresso e assina corpo+timestamp para o handler central com segredo separado; o handler não aceita payload Evolution sem HMAC interno.
- [ ] Conferir formato da versão instalada: `event`, `instance`, `data.key.remoteJid`/`remoteJidAlt`, `messageTimestamp` e `message`. Não presumir HMAC nativo. LID precisa ser resolvido para telefone; sem mapeamento o evento é recusado/repetível, sem criar telefone fictício.
- [ ] Testar envio real autorizado pela instância e falha/repetição. Timeout fica no histórico como incerto e não dispara reenvio automático.

Em ambos: atendimento individual, sem grupos/broadcast; texto livre somente nas 24h após mensagem recebida do mesmo número. Templates fora da janela são operados no provedor, com regras e consentimentos aplicáveis. Não ativar disparos em massa. Mídias são registradas na conversa, com anexo manual no fluxo privado do caso.

## 6. Configurar o agente como admin

- [ ] Abrir `/crm/agente`, cadastrar exemplos reais autorizados e anonimizados e conhecimento conferido das quatro áreas do escritório.
- [ ] Manter trava OAB ativa (não é desativável). Autorizar documentos no provedor somente após avaliação da política do escritório; cada geração exige autorização adicional na interface.
- [ ] Habilitar `LEGAL_AI_ENABLED` e testar com dados sintéticos. Confirmar que nenhum texto é enviado automaticamente, e que prospect recebe somente rascunho administrativo.
- [ ] Testar resumo/pauta com caso, geração de documento até 5 MB e aprovação humana explícita antes de salvar resumo ou levar resposta ao compositor. A conversa exige nova revisão de destinatário/sigilo antes do envio.

### Base jurídica e copiloto (Fase 6)

- [ ] Como admin, abrir `/crm/copiloto` e usar **Atualizar Base Jurídica**. Não há sincronização automática anunciada. A atualização consulta 13 páginas oficiais fixas, com limite de tamanho/tempo, preserva extratos datados e apresenta falhas por fonte. Cadastros de área e jurisdição são separados do resultado de consulta; não há endpoint de URL arbitrária.
- [ ] Conferir CNJ, STJ, STF, TJSP, TJRJ, TJMG, Planalto e OAB. Bloqueios HTTP/WAF ou mudança de endereço exigem revisão do catálogo de código/SQL; não substituir por blogs nem considerar consulta malsucedida como atualização válida. Trecho de portal/notícia não equivale a texto integral de decisão ou garantia de vigência.
- [ ] DataJud: a fonte geral acompanha a documentação oficial. Ao selecionar um caso na atualização, o backend também tenta a consulta pública específica com a mesma verificação de sigilo/CNJ da Fase 5; não usa DataJud como repositório de jurisprudência.
- [ ] Conferir configuração de tom em `/crm/agente`. O copiloto pesquisa fontes por área/jurisdição, aceita somente trechos literais validados e devolve links/datas reais do banco. Sem evidência, deve informar a lacuna; resumos/pautas/rascunhos no tom do Matheus continuam no Hub com revisão humana. Não há envio automático de resultados.

## 7. Publicar frontend Vercel

- [ ] Revisar/mergear o PR de refinamento (Fase 6) somente após o backend e as políticas estarem prontos para uso.
- [ ] `VITE_SUPABASE_URL=https://neotdgoftxkfaljpmddk.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY` pública e identidade profissional real (`VITE_OFFICE_OAB_NUMBER`).
- [ ] `VITE_TURNSTILE_SITE_KEY` pública; `VITE_INTAKE_ENABLED=false` até o aceite do intake. Ausência de site key/flag mantém o contato por WhatsApp.
- [ ] Build `npm run build`, output `dist`, rewrite SPA existente. Não há chaves de WhatsApp/IA/DataJud/InfinitePay no bundle.
- [ ] Novo deploy após alterar qualquer `VITE_*`. Fontes, logo e retrato são locais; preservar `public/office` e `public/licenses`.

## 8. Aceite antes de liberar operação

- [ ] Minha Conta: perfil próprio, senha 8+, confirmação, erro/sucesso e reautenticação. Não usar senha real de terceiros em testes automatizados.
- [ ] Lead → cliente/caso: documento validado, conflito revisado, uma conversão por lead, mensagens/ligações preservadas e próximo evento no mesmo cliente. Telefone compartilhado não deve mesclar clientes.
- [ ] Hub → agenda → financeiro: campos de vínculo pré-carregados; compromisso abre por ID; cobrança vinculada confirma consulta somente após provedor. Callback repetido não duplica evento. A InfinitePay não tem sandbox: compra real de aceite depende de decisão do responsável da conta.
- [ ] WhatsApp: assinatura inválida e número/instância divergente negados; desconhecido vira lead sem consentimento fictício; resposta exige revisão/janela; simular timeout e conferir no provedor antes de novo envio.
- [ ] Documentos: anon/inativo não obtêm upload/download; staff ativo opera via Edge; bucket público e Storage REST direto continuam negados; URL expira em 60s; documento de outro caso é recusado. Formatos permitidos passam por validação básica, não por antivírus.
- [ ] DataJud: caso sigiloso bloqueia consulta; vazio público não vira afirmação de sigilo; fonte CNJ e data exibidas. Sem público, usar arquivo privado; não tentar contornar segredo judicial.
- [ ] IA: staff não altera config; admin não desativa trava; documento sem autorização é negado; revisão obrigatória; respostas não são publicadas automaticamente; sem modelo/key, endpoint informa configuração pendente.
- [ ] Desktop/mobile, navegação sem href vazio ou âncora inexistente, console sem erros no fluxo normal e sem dependência de fontes/imagens externas.
- [ ] Repetir concorrência real em homologação (conversão, agenda, cobrança e mensagens) e revisar os advisors. PGlite é local e serializado.
- [ ] Habilitar intake/financeiro/WhatsApp/IA separadamente após seus respectivos aceites. Manter logs operacionais sem tokens, payloads brutos ou conteúdo jurídico copiado para auditoria.

### Aceite adicional de produto (Fase 6)

- [ ] `/crm` abre **Hoje no Escritório**, `/crm/funil` preserva Kanban. Conferir prazos de hoje até D+5 (dias de calendário da visão, não contagem CPC), reuniões do dia em São Paulo, cobranças pendentes/vencidas e SLA operacional de 24h. O SLA não é prazo processual.
- [ ] Abrir seletores pela seta, selecionar recente em um clique e pesquisar documento formatado, nome com acento, telefone e CNJ; testar teclado e celular. Vínculos dependentes devem ser limpos ao mudar cliente.
- [ ] Editar perfil próprio e comprovar que e-mail Auth, role e status não são alteráveis pelo formulário/RPC. Completar OAB/UF. Contato/endereço do cliente podem ser corrigidos no resumo da ficha; nome/documento continuam protegidos pela formalização.
- [ ] Criar agendamento, confirmar criação do link e repetir webhook pago: funil avança sem regressão, duplicação ou reabertura de arquivado. Conversão já fecha o lead; cobrança posterior não o devolve a proposta. Contato só conta após mensagem humana enviada, ligação atendida ou e-mail enviado.
- [ ] Gerar Procuração, Contrato e Declaração com dados reais conferidos, editar cláusulas necessárias, salvar versão revisada, imprimir/PDF. Nenhuma hipossuficiência é presumida, poder especial não é conferido automaticamente e o modelo não dispensa análise da tabela OAB e do ajuste individual.
- [ ] Conferir prévia de e-mail, alteração concorrente, resposta incerta e idempotência; e-mail recebido só entra no caso após revisão e aparece na própria ficha. Prioridade IA é auxiliar; confirmar publicação, ciência e termo inicial antes de cadastrar prazo.
- [ ] Rodar os testes locais e repetir aceite hospedado com contas de teste: `npm install && npm run build`, `npm test`, `npm run test:browser`, `deno check supabase/functions/*/index.ts`. São 17 funções no total. Provedores simulados e PGlite não substituem concorrência, SMTP/MX, Auth/Storage e compra autorizada de aceite hospedado.
