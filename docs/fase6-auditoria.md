# PR de refinamento — ciclo de engenharia e evidências

## Analisar

Base: `main` após o merge autorizado do PR #3, commit `5b66ff988d7939c426e830e9cacbd7dfe11a361b`. A entrega mantém React/Vite/TypeScript, identidade grafite/off-white/dourado, Supabase e o modelo de um único escritório. O benchmark de continuidade de atendimento da Fase 5 permanece aplicável: cadastro canônico, histórico vinculado e revisão do advogado.

Changelog Supabase e documentação atual de Auth foram consultados antes da implementação. A nota de PostgreSQL 15.19/17.11 afeta ltree, operadores, btree_gist e criptografia legada; a revisão não introduz essas dependências. A integração Resend foi conferida contra documentação de verificação de webhook e consulta de e-mail recebido.

## Diagnosticar

A página inicial era somente o funil; seletores de clientes/casos exigiam percorrer listas; o Hub misturava agenda e financeiro; o perfil era somente leitura; e um cadastro sem endereço não tinha correção depois da conversão. A geração de kit exigia uma saída revisável sem repetir qualificação já cadastrada. Conversas eram ligadas ao contato, mas e-mails ainda não tinham histórico integrado.

Nova leitura do Supabase em 17/11/2026 confirmou RLS em profiles, appointments, payments, whatsapp_messages e agent_config. As RPCs das Fases 4, 5 e 6 não estavam instaladas; a listagem retornou `functions: []`. O advisor manteve aviso de proteção de senhas vazadas desativada e informação de tabela privada com RLS fechada/sem políticas, intencional. Nenhum schema, senha, segredo ou integração de produção foi alterado nesta tarefa.

## Planejar

- Componente único de seleção e busca, com teclado/ARIA, IDs controlados e dados reais já carregados; normalização de acento, documento/telefone formatado e CNJ. Seleções dependentes são limpas ao mudar cliente.
- Visão Hoje separada do funil e da ficha 360º. Atualização por ação do usuário e estados de erro explícitos, sem conteúdo simulado no produto.
- SQL de revisão Fase 6 com mutações apenas por RPCs de serviço, usadas por Edge Functions que validam JWT e profile ativo. Sem alteração de role/status via edição de perfil e sem alteração de nome/documento do cliente por edição de contato.
- Outbox de e-mail antes da chamada externa, UUID estável, prévia/versionamento, limites por minuto e falha incerta sem reenvio automático. Entrada externa autenticada por Svix ou HMAC de relay; vínculo sugerido nunca é aceito automaticamente.
- Conhecimento organizado por área/jurisdição, fontes oficiais fixas, extratos datados, hash de dedupe e transparência sobre falhas. Copiloto retorna apenas trechos literais validados contra as fontes; sem evidência, informa lacuna.

## Implementar

| Entrega | Arquivos / comportamento |
|---|---|
| Busca unificada | `src/crm/components/SearchableCombobox.tsx`; busca por nome, documento, telefone e CNJ nas seleções de financeiro, agenda, clientes/casos, Hub, triagem e documentos-fonte |
| Hoje no Escritório | `/crm`; prazos de hoje até D+5, audiências/consultas de hoje, leads sem resposta e cobranças pendentes/vencidas. Datas em São Paulo; visão de calendário não altera o cálculo CPC |
| Kanban | `/crm/funil`; intake continua `novo`; consulta/audiência criada avança para reunião; link de cobrança confirmado avança para proposta; pagamento confirmado/conversão fecha quando há cliente. Sem regressão, reabertura de arquivado ou fechamento sem formalização |
| SLA | Janela operacional de 24h desde solicitação/última entrada. Só mensagem humana enviada, ligação atendida ou e-mail enviado contam como contato; reserva pendente ou confirmação incerta não contam |
| Ficha 360º | Resumo, partes/coincidências de conflito, DataJud, PDFs/documentos privados, agenda/prazos, WhatsApp/ligações, financeiro, e-mail e kit. Vínculo de caso e cliente é canônico |
| Perfil | Nome, OAB/UF, telefone E.164 e bio editáveis com controle de versão. E-mail Auth, cargo e status permanecem somente leitura. Fluxo de senha 8+/confirmação/reautenticação preservado |
| Kit Inicial | `initial-kit`; dados do cliente e OAB do perfil, objeto/qualificação complementar/honorários explícitos. Procuração sem poderes especiais automáticos, contrato sem promessa de êxito e declaração condicionada à veracidade. Minutas editáveis, versões revisadas imutáveis e impressão/PDF após conferência |
| E-mail de saída | `email-send`; resumo aprovado, cobrança pendente com link e compromisso confirmado. Resend ou SMTPS/TLS 465. Destinatário vem do cadastro; token de prévia impede envio de conteúdo alterado depois da revisão; histórico na ficha |
| Triagem | `email-inbound-webhook` + `email_triage`; assinatura, destino autorizado, dedupe, texto normalizado, CNJ com checksum, classificação auxiliar IA/regras e sugestão de casos. Revisão humana com versão; nada cria prazo automaticamente. E-mail vinculado aparece na ficha |
| Copiloto/base | `/crm/copiloto`, `legal-copilot`, `sync-legal-updates`, `legal_knowledge_sources`, `legal_knowledge_updates`. Família, Saúde, Criminal, Contratos e Ética/OAB; SP, RJ, MG, STJ, STF, CNJ e normas nacionais. Tom Matheus permanece no Hub e na configuração admin |
| Segurança | Todas as tabelas novas com RLS, SELECT de membro ativo; histórico do copiloto limitado a autor/admin. Mutações somente por serviço; segredos fora do frontend. Funções de agenda e contexto reforçam coerência dos vínculos |

A conversão Fase 3 já fecha o lead; criar cobrança depois disso não o devolve à proposta. Um agendamento cancelado, checkout incerto ou callback repetido não deve fabricar avanço comercial. Automação não inventa vínculo entre um pagamento genérico do cliente e um lead sem caso/consulta correspondente.

## Testar

Em 17/11/2026: build aprovado sem erros de TypeScript; **76 testes automatizados aprovados**, **34 testes Chromium aprovados**, **17 funções aprovadas no `deno check`**, e `git diff --check` limpo. As evidências finais e os limites também estão registrados no PR. Comandos:

```sh
npm install
npm run build
npm test
npm run test:browser
deno check supabase/functions/*/index.ts
git diff --check
```

Suítes incluem Postgres/PGlite aplicando Fases 1–6, RLS/ACLs para anon/inativo/staff/admin, versões concorrentes, conversão com triggers Fases 5–6, progressão do funil, contato canônico, kit imutável/revisado, outbox e triagem; contratos das 17 funções, HMAC/Svix/Resend/SMTPS, falhas de provedor e bloqueio de citação inventada; e navegação Chromium desktop/mobile, busca/teclado, perfil, impressão, e-mail, triagem e copiloto. Os testes de navegador capturam erros de console e de página. Há inspeção visual da captura mobile.

Provedores e Auth/API dos testes são simulados; PGlite é local e serializado, com schema Storage mínimo. Não substituem teste de MX/SMTP, Auth/Storage hospedados, concorrência real ou pagamentos reais. Nenhuma mensagem/cobrança real foi enviada e nenhum documento real foi processado pela IA.

## Auditar

- OAB 205/2021: portal sem preços públicos, captação ou promessa de êxito; nenhum parecer externo automático. Kit e rascunhos exigem advogado. E-mail e WhatsApp exigem revisão específica antes do envio.
- DataJud: metadados públicos, sem acesso a autos sigilosos. Na atualização geral, DataJud acompanha a documentação; selecionado um caso, há tentativa de consulta pública com a mesma trava da Fase 5. Ausência não prova segredo de justiça.
- Fontes: não há URL arbitrária de usuário, navegação autônoma da IA nem conteúdo de blogs. A atualização é manual e limitada a três downloads simultâneos, 1 MB/fonte e intervalo de 5min. Extratos são trechos datados das páginas oficiais, não promessa de catálogo jurisprudencial exaustivo ou vigência garantida.
- Algumas fontes oficiais retornaram bloqueio HTTP/indisponibilidade na pesquisa. O endereço antigo do STJ retornou 404 e foi substituído pelo portal oficial validado. Falhas ficam visíveis por fonte; a última versão válida é preservada. Fontes Planalto/OAB suprem normas por área; TJSP/TJRJ/TJMG e tribunais superiores são dimensões separadas.
- O copiloto verifica que cada citação aponta para atualização existente e que cada trecho é literal. URL, título e data são anexados pelo servidor. Uma referência inventada ou paráfrase não verificável é recusada. Resumos e pautas do contexto do caso continuam como rascunhos internos sujeitos a revisão.
- SMTP usa TLS direto 465, sem tentar contornar bloqueio de portas da plataforma. Resend Receiving/encaminhamento precisam ser configurados: envio de e-mail não implica recebimento. Remetente aparente não autentica webhook. Anexos não são automaticamente importados; use o upload privado do caso.
- `EMAIL_TRIAGE_AI_ENABLED` autoriza separadamente o processamento de correspondência; falha de IA preserva a entrada com regras auxiliares identificadas. Detecção de urgência/prazo por regras não é rebaixada por classificação IA.
- Pesquisa é por dados que o usuário ativo já pode acessar no escritório. Não foi introduzida segregação por advogado; sigilo de caso não implementa essa segregação.
- O [checklist único](implantacao-unica.md) contém a sequência Fases 1–6, 17 funções, segredos, flags, implantação e aceite. Não existe SQL aplicado pelo build.

Fontes: [Auth Edge Functions](https://supabase.com/docs/guides/functions/auth), [Supabase changelog](https://supabase.com/changelog), [Resend verificação](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend e-mail recebido](https://resend.com/docs/api-reference/emails/retrieve-received-email), [proteção de senha vazada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [OAB 205/2021](https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021).
