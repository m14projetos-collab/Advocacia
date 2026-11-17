-- M14 Fase 6 | Refinamento de produto. Aplicar após Fases 1–5.
-- Revisão SQL: não publicar m14_private na Data API.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS oab_uf text CHECK(oab_uf IS NULL OR oab_uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));
ALTER TABLE public.leads_intake ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;
ALTER TABLE public.leads_intake ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
CREATE TABLE IF NOT EXISTS public.email_outbox (
 id uuid PRIMARY KEY,created_by uuid NOT NULL REFERENCES public.profiles(id),
 lead_id uuid REFERENCES public.leads_intake(id),client_id uuid NOT NULL REFERENCES public.clients(id),case_id uuid REFERENCES public.cases(id),
 template text NOT NULL CHECK(template IN ('summary','payment','appointment')),reference_id uuid,
 recipient text NOT NULL CHECK(length(recipient)<=254),subject text NOT NULL CHECK(length(subject)<=200),
 content text NOT NULL CHECK(length(content)<=24000),provider text NOT NULL CHECK(provider IN ('resend','smtp')),
 external_id text,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_triage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL,external_id text NOT NULL,
 sender text NOT NULL CHECK(length(sender)<=320),subject text NOT NULL CHECK(length(subject)<=500),
 content text NOT NULL CHECK(length(content)<=24000),received_at timestamptz NOT NULL DEFAULT now(),
 priority text NOT NULL DEFAULT 'informativo' CHECK(priority IN ('urgente','prazo','comercial','informativo')),
 classification_method text NOT NULL CHECK(classification_method IN ('ai','rules')),
 cnj_numbers_json jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(cnj_numbers_json)='array'),
 suggested_case_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(suggested_case_ids)='array'),
 case_id uuid REFERENCES public.cases(id),reviewed_by uuid REFERENCES public.profiles(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','linked','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,external_id)
);
CREATE TABLE IF NOT EXISTS public.document_kits (
 id uuid PRIMARY KEY,case_id uuid NOT NULL REFERENCES public.cases(id),created_by uuid NOT NULL REFERENCES public.profiles(id),
 inputs jsonb NOT NULL,documents jsonb NOT NULL CHECK(jsonb_typeof(documents)='array'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.legal_knowledge_sources (
 id text PRIMARY KEY,title text NOT NULL,area text NOT NULL CHECK(area IN ('familia_sucessoes','medico_saude','criminal','contratos','etica','geral')),
 jurisdiction text NOT NULL CHECK(jurisdiction IN ('SP/TJSP','RJ/TJRJ','MG/TJMG','STJ','STF','CNJ','Nacional')),
 official_url text NOT NULL CHECK(official_url ~ '^https://(www\.)?(cnj\.jus\.br|stj\.jus\.br|noticias\.stf\.jus\.br|portal\.stf\.jus\.br|tjsp\.jus\.br|tjrj\.jus\.br|tjmg\.jus\.br|oab\.org\.br|planalto\.gov\.br|datajud-wiki\.cnj\.jus\.br)/'),
 enabled boolean NOT NULL DEFAULT true,last_checked_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.legal_knowledge_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text NOT NULL REFERENCES public.legal_knowledge_sources(id),
 title text NOT NULL,official_url text NOT NULL CHECK(official_url ~ '^https://(www\.)?(cnj\.jus\.br|stj\.jus\.br|noticias\.stf\.jus\.br|portal\.stf\.jus\.br|tjsp\.jus\.br|tjrj\.jus\.br|tjmg\.jus\.br|oab\.org\.br|planalto\.gov\.br|datajud-wiki\.cnj\.jus\.br)/'),
 summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 8000),content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 fetched_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_id,content_hash)
);
CREATE TABLE IF NOT EXISTS public.copilot_turns (
 id uuid PRIMARY KEY,created_by uuid NOT NULL REFERENCES public.profiles(id),case_id uuid REFERENCES public.cases(id),
 question text NOT NULL CHECK(length(question) BETWEEN 2 AND 4000),answer text CHECK(length(answer)<=18000),
 citations_json jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(citations_json)='array'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','draft','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS m14_email_context_idx ON public.email_outbox(client_id,case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS m14_email_triage_status_idx ON public.email_triage(status,received_at DESC);
CREATE INDEX IF NOT EXISTS m14_kits_case_idx ON public.document_kits(case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS m14_knowledge_source_idx ON public.legal_knowledge_updates(source_id,fetched_at DESC);
CREATE INDEX IF NOT EXISTS m14_copilot_actor_idx ON public.copilot_turns(created_by,created_at DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['email_outbox','email_triage','document_kits','legal_knowledge_sources','legal_knowledge_updates','copilot_turns'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  EXECUTE format('DROP POLICY IF EXISTS m14_phase6_read ON public.%I',t);
  IF t='copilot_turns' THEN
   EXECUTE format('CREATE POLICY m14_phase6_read ON public.%I FOR SELECT TO authenticated USING((SELECT m14_private.is_office_member()) AND (created_by=(SELECT auth.uid()) OR (SELECT m14_private.is_office_admin())))',t);
  ELSE
   EXECUTE format('CREATE POLICY m14_phase6_read ON public.%I FOR SELECT TO authenticated USING((SELECT m14_private.is_office_member()))',t);
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS m14_audit ON public.%I',t);
  EXECUTE format('CREATE TRIGGER m14_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.audit_change()',t);
 END LOOP;
END $$;
-- Histórico de documentos não é reescrito após geração.
REVOKE UPDATE ON public.document_kits,public.legal_knowledge_updates FROM service_role;
INSERT INTO public.legal_knowledge_sources(id,title,area,jurisdiction,official_url) VALUES
 ('cnj','CNJ — notícias oficiais','geral','CNJ','https://www.cnj.jus.br/feed/'),
 ('stj','STJ — portal oficial','geral','STJ','https://www.stj.jus.br/sites/portalp/Inicio'),
 ('stf','STF — notícias oficiais','geral','STF','https://noticias.stf.jus.br/'),
 ('tjsp','TJSP — notícias oficiais','geral','SP/TJSP','https://www.tjsp.jus.br/Noticias'),
 ('tjrj','TJRJ — notícias oficiais','geral','RJ/TJRJ','https://www.tjrj.jus.br/web/guest/noticias'),
 ('tjmg','TJMG — notícias oficiais','geral','MG/TJMG','https://www.tjmg.jus.br/portal-tjmg/noticias/'),
 ('familia','Código Civil — Família e Sucessões','familia_sucessoes','Nacional','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm'),
 ('saude','Lei 9.656/1998 — Planos de Saúde','medico_saude','Nacional','https://www.planalto.gov.br/ccivil_03/leis/l9656.htm'),
 ('criminal','Código de Processo Penal','criminal','Nacional','https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689.htm'),
 ('contratos','Código Civil — Contratos','contratos','Nacional','https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm'),
 ('etica','Código de Ética OAB — Resolução 02/2015','etica','Nacional','https://www.oab.org.br/leisnormas/legislacao/resolucoes/02-2015'),
 ('oab205','OAB — Provimento 205/2021','etica','Nacional','https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021'),
 ('datajud','DataJud — documentação da API Pública','geral','CNJ','https://datajud-wiki.cnj.jus.br/api-publica/')
ON CONFLICT(id) DO NOTHING;
-- Funil avança por evento confirmado, sem reabrir fechados/arquivados nem regredir.
CREATE OR REPLACE FUNCTION m14_private.advance_lead(p_id uuid,p_stage text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.leads_intake SET stage=p_stage WHERE id=p_id AND stage NOT IN ('arquivado','fechado')
 AND array_position(ARRAY['novo','triagem','reuniao_agendada','proposta','fechado'],stage)<array_position(ARRAY['novo','triagem','reuniao_agendada','proposta','fechado'],p_stage)
 AND (p_stage<>'fechado' OR converted_client_id IS NOT NULL);
END $$;
CREATE OR REPLACE FUNCTION m14_private.phase6_events() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE lid uuid;cid uuid; BEGIN
 IF TG_TABLE_NAME='appointments' THEN
  lid:=NEW.lead_id;
  IF lid IS NULL THEN SELECT source_lead_id INTO lid FROM public.cases WHERE id=NEW.case_id; END IF;
  IF NEW.type IN ('consulta','audiencia') AND NEW.status IN ('pendente','confirmado') THEN PERFORM m14_private.advance_lead(lid,'reuniao_agendada'); END IF;
 ELSIF TG_TABLE_NAME='payments' THEN
  SELECT source_lead_id INTO lid FROM public.cases WHERE id=NEW.case_id;
  IF lid IS NULL THEN SELECT lead_id INTO lid FROM public.appointments WHERE id=NEW.appointment_id; END IF;
  IF NEW.status IN ('paid','settled') THEN PERFORM m14_private.advance_lead(lid,'fechado');
  ELSIF NEW.checkout_url IS NOT NULL AND NEW.checkout_state='ready' AND NEW.status='pending' THEN PERFORM m14_private.advance_lead(lid,'proposta'); END IF;
 ELSIF TG_TABLE_NAME='whatsapp_messages' THEN
  IF NEW.direction='inbound' THEN
   UPDATE public.leads_intake SET last_inbound_at=greatest(last_inbound_at,coalesce(NEW.provider_timestamp,NEW.created_at))
    WHERE id=NEW.lead_id;
  ELSIF NEW.sender_type='human' AND NEW.send_state IN ('sent','delivered','read') THEN
   UPDATE public.leads_intake SET last_contact_at=greatest(last_contact_at,NEW.created_at) WHERE id=NEW.lead_id;
  END IF;
 ELSIF TG_TABLE_NAME='call_logs' THEN
  IF NEW.outcome='atendida' THEN UPDATE public.leads_intake SET last_contact_at=greatest(last_contact_at,NEW.created_at) WHERE id=NEW.lead_id; END IF;
 ELSIF TG_TABLE_NAME='email_outbox' THEN
  IF NEW.status='sent' THEN UPDATE public.leads_intake SET last_contact_at=greatest(last_contact_at,NEW.created_at) WHERE id=NEW.lead_id; END IF;
 END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['appointments','payments','whatsapp_messages','call_logs','email_outbox'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS m14_phase6_events ON public.%I',t);
  EXECUTE format('CREATE TRIGGER m14_phase6_events AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.phase6_events()',t);
 END LOOP;
END $$;
-- Trigger de WhatsApp também executa na conversão autenticada da Fase 3.
GRANT EXECUTE ON FUNCTION m14_private.advance_lead(uuid,text),m14_private.phase6_events() TO service_role;
REVOKE ALL ON FUNCTION m14_private.advance_lead(uuid,text),m14_private.phase6_events() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION m14_private.hub_context(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l public.leads_intake%ROWTYPE;c public.clients%ROWTYPE;k public.cases%ROWTYPE;
 lid uuid:=nullif(p->>'lead_id','')::uuid;cid uuid:=nullif(p->>'client_id','')::uuid;kid uuid:=nullif(p->>'case_id','')::uuid;
BEGIN
 IF kid IS NOT NULL THEN
  SELECT * INTO STRICT k FROM public.cases WHERE id=kid;
  IF cid IS NOT NULL AND cid<>k.client_id THEN RAISE EXCEPTION 'Caso de outro cliente.'; END IF;
  cid:=k.client_id;lid:=coalesce(lid,k.source_lead_id);
 END IF;
 IF lid IS NOT NULL THEN
  SELECT * INTO STRICT l FROM public.leads_intake WHERE id=lid;
  IF cid IS NOT NULL AND l.converted_client_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'Lead e cliente não correspondem.'; END IF;
  cid:=coalesce(cid,l.converted_client_id);
 END IF;
 IF cid IS NOT NULL THEN SELECT * INTO STRICT c FROM public.clients WHERE id=cid; END IF;
 IF lid IS NULL AND cid IS NULL THEN RAISE EXCEPTION 'Selecione um atendimento, cliente ou caso.'; END IF;
 RETURN jsonb_build_object('lead_id',lid,'client_id',cid,'case_id',kid,
  'lead',CASE WHEN lid IS NOT NULL THEN to_jsonb(l) END,'client',CASE WHEN cid IS NOT NULL THEN to_jsonb(c) END,
  'case',CASE WHEN kid IS NOT NULL THEN to_jsonb(k) END,'phone',coalesce(c.phone,l.phone));
END $$;

CREATE OR REPLACE FUNCTION public.office_save_appointment(p_actor uuid, p_id uuid, p_data jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  old public.appointments%ROWTYPE; result public.appointments%ROWTYPE;
  v_start timestamptz := (p_data->>'starts_at')::timestamptz;
  v_end timestamptz := (p_data->>'ends_at')::timestamptz;
  v_case uuid := nullif(p_data->>'case_id','')::uuid;
  v_lead uuid := nullif(p_data->>'lead_id','')::uuid;
  v_required boolean := coalesce((p_data->>'payment_required')::boolean,false);
  v_status text := p_data->>'status'; v_type text := p_data->>'type';
  v_client uuid; v_lead_client uuid;
BEGIN
  PERFORM m14_private.phase4_actor(p_actor);
  PERFORM pg_advisory_xact_lock(14004,1);
  IF p_id IS NULL OR p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR
    v_start IS NULL OR v_end IS NULL OR NOT isfinite(v_start) OR NOT isfinite(v_end) OR v_end <= v_start
    OR v_type IS NULL OR v_type NOT IN ('consulta','audiencia','prazo','interno')
    OR v_status IS NULL OR v_status NOT IN ('pendente','confirmado','concluido','cancelado')
    OR (v_required AND v_type <> 'consulta') THEN
    RAISE EXCEPTION 'Dados do agendamento inválidos.' USING ERRCODE = '22023';
  END IF;
  IF v_case IS NOT NULL THEN SELECT client_id INTO STRICT v_client FROM public.cases WHERE id = v_case; END IF;
  IF v_lead IS NOT NULL THEN
    SELECT converted_client_id INTO STRICT v_lead_client FROM public.leads_intake WHERE id = v_lead;
    IF v_client IS NOT NULL AND v_lead_client IS DISTINCT FROM v_client AND v_lead IS DISTINCT FROM (SELECT source_lead_id FROM public.cases WHERE id=v_case) THEN
      RAISE EXCEPTION 'Lead e caso pertencem a clientes diferentes.';
    END IF;
  END IF;
  SELECT * INTO old FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM old.updated_at THEN
      RAISE EXCEPTION 'Agendamento alterado ou criação já recebida. Atualize a agenda antes de editar.' USING ERRCODE = '40001';
    END IF;
    IF EXISTS(SELECT 1 FROM public.payments WHERE appointment_id = p_id) AND
      (old.case_id IS DISTINCT FROM v_case OR old.lead_id IS DISTINCT FROM v_lead OR old.payment_required IS DISTINCT FROM v_required) THEN
      RAISE EXCEPTION 'Não altere vínculos ou exigência de pagamento de uma consulta com cobrança.';
    END IF;
  ELSIF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;
  IF v_required AND v_status IN ('confirmado','concluido') AND NOT EXISTS(
    SELECT 1 FROM public.payments WHERE appointment_id = p_id AND status IN ('paid','settled')) THEN
    RAISE EXCEPTION 'Consulta depende de pagamento confirmado no provedor.';
  END IF;
  -- Uma agenda do escritório. Pendências também reservam o intervalo. Prazos não ocupam sala/horário.
  IF v_type <> 'prazo' AND v_status IN ('pendente','confirmado') AND EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.id <> p_id AND a.type <> 'prazo'
      AND a.status IN ('pendente','confirmado') AND a.starts_at < v_end AND a.ends_at > v_start) THEN
    RAISE EXCEPTION 'Conflito de horário na agenda do escritório.' USING ERRCODE = '23P01';
  END IF;
  INSERT INTO public.appointments(id,title,type,starts_at,ends_at,meeting_url,lead_id,case_id,payment_required,status)
    VALUES(p_id,btrim(p_data->>'title'),v_type,v_start,v_end,nullif(btrim(p_data->>'meeting_url'),''),v_lead,v_case,v_required,v_status)
  ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,type=EXCLUDED.type,starts_at=EXCLUDED.starts_at,
    ends_at=EXCLUDED.ends_at,meeting_url=EXCLUDED.meeting_url,lead_id=EXCLUDED.lead_id,case_id=EXCLUDED.case_id,
    payment_required=EXCLUDED.payment_required,status=EXCLUDED.status RETURNING * INTO result;
  RETURN to_jsonb(result);
END;
$$;

CREATE OR REPLACE FUNCTION public.office_phase6_action(p_actor uuid,p_action text,p_context jsonb DEFAULT '{}',p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ctx jsonb;cid uuid;kid uuid;lid uuid;pr public.profiles%ROWTYPE;em public.email_outbox%ROWTYPE;
 pay public.payments%ROWTYPE;ap public.appointments%ROWTYPE;v_subject text;v_content text;v_template text;
 result jsonb;v_today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_count integer; BEGIN
 PERFORM m14_private.phase4_actor(p_actor);
 IF p_action='profile_save' THEN
  SELECT * INTO STRICT pr FROM public.profiles WHERE id=p_actor FOR UPDATE;
  IF p_data->>'expected_updated_at' IS NULL OR pr.updated_at IS DISTINCT FROM (p_data->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Perfil alterado. Atualize a página.'; END IF;
  IF char_length(btrim(p_data->>'full_name')) NOT BETWEEN 2 AND 160 OR char_length(coalesce(p_data->>'bio',''))>3000
   OR (nullif(p_data->>'phone','') IS NOT NULL AND p_data->>'phone' !~ '^\+[1-9][0-9]{7,14}$')
   OR char_length(coalesce(p_data->>'oab_number',''))>30 THEN RAISE EXCEPTION 'Perfil inválido.'; END IF;
  UPDATE public.profiles SET full_name=btrim(p_data->>'full_name'),oab_number=nullif(btrim(p_data->>'oab_number'),''),
   oab_uf=nullif(p_data->>'oab_uf',''),phone=nullif(p_data->>'phone',''),bio=nullif(btrim(p_data->>'bio'),'') WHERE id=p_actor RETURNING to_jsonb(profiles.*) INTO result;RETURN result;
 ELSIF p_action='dashboard' THEN
  RETURN jsonb_build_object('today',v_today,'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY starts_at) FROM public.appointments a WHERE status IN ('pendente','confirmado') AND ((type='prazo' AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_today AND v_today+5) OR (type IN ('audiencia','consulta') AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date=v_today))),'[]'),
   'unanswered',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY created_at) FROM public.leads_intake l WHERE stage NOT IN ('fechado','arquivado') AND (last_contact_at IS NULL OR last_contact_at<coalesce(last_inbound_at,created_at))),'[]'),
   'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY due_date NULLS LAST,created_at) FROM public.payments p WHERE status='pending'),'[]'));
 ELSIF p_action='knowledge' THEN
  RETURN jsonb_build_object('sources',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY jurisdiction,title) FROM public.legal_knowledge_sources s),'[]'),
   'updates',coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY fetched_at DESC) FROM (SELECT latest.* FROM public.legal_knowledge_sources s CROSS JOIN LATERAL (SELECT * FROM public.legal_knowledge_updates v WHERE v.source_id=s.id ORDER BY fetched_at DESC,id DESC LIMIT 3)latest)u),'[]'));
 ELSIF p_action IN ('sync_reserve','sync_result') THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin' AND is_active) THEN RAISE EXCEPTION 'Somente administrador.' USING ERRCODE='42501'; END IF;
  IF p_action='sync_reserve' THEN
   PERFORM pg_advisory_xact_lock(14006,1);
   IF EXISTS(SELECT 1 FROM public.legal_knowledge_sources WHERE last_checked_at>now()-interval '5 minutes') THEN RAISE EXCEPTION 'Aguarde 5 minutos entre atualizações.'; END IF;
   UPDATE public.legal_knowledge_sources SET last_checked_at=now() WHERE enabled; RETURN '{}';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.legal_knowledge_sources WHERE id=p_data->>'source_id' AND official_url=p_data->>'official_url' AND enabled) THEN RAISE EXCEPTION 'Fonte oficial não cadastrada.'; END IF;
  UPDATE public.legal_knowledge_sources SET last_error=nullif(p_data->>'error','') WHERE id=p_data->>'source_id';
  IF p_data->>'error' IS NULL THEN
   INSERT INTO public.legal_knowledge_updates(source_id,title,official_url,summary,content_hash)
    VALUES(p_data->>'source_id',p_data->>'title',p_data->>'official_url',p_data->>'summary',p_data->>'content_hash') ON CONFLICT(source_id,content_hash) DO NOTHING;
  END IF;RETURN '{}';
 ELSIF p_action='triage_list' THEN
  IF coalesce((p_data->>'offset')::integer,0) NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Paginação inválida.'; END IF;
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY received_at DESC) FROM (SELECT * FROM public.email_triage ORDER BY received_at DESC,id DESC LIMIT 100 OFFSET coalesce((p_data->>'offset')::integer,0))e),'[]'),'has_more',(SELECT count(*)>coalesce((p_data->>'offset')::integer,0)+100 FROM public.email_triage));
 ELSIF p_action='triage_review' THEN
  IF p_data->>'status' NOT IN ('linked','dismissed') THEN RAISE EXCEPTION 'Decisão inválida.';END IF;
  IF p_data->>'status'='linked' THEN
   ctx:=m14_private.hub_context(p_context);kid:=(ctx->>'case_id')::uuid;
   IF kid IS NULL THEN RAISE EXCEPTION 'Selecione um caso.'; END IF;
  END IF;
  UPDATE public.email_triage SET case_id=kid,status=p_data->>'status',reviewed_by=p_actor,updated_at=now()
   WHERE id=(p_data->>'id')::uuid AND updated_at=(p_data->>'expected_updated_at')::timestamptz RETURNING to_jsonb(email_triage.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'E-mail alterado. Atualize a triagem.'; END IF; RETURN result;
 ELSIF p_action IN ('chat_start','chat_finish','chat_history') THEN
  IF p_context->>'case_id' IS NOT NULL THEN ctx:=m14_private.hub_context(p_context);kid:=(ctx->>'case_id')::uuid; END IF;
  IF p_action='chat_history' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at) FROM (SELECT * FROM public.copilot_turns WHERE created_by=p_actor AND case_id IS NOT DISTINCT FROM kid ORDER BY created_at DESC LIMIT 30)r),'[]'); END IF;
  IF p_action='chat_start' THEN
   PERFORM pg_advisory_xact_lock(14006,2);
   SELECT to_jsonb(r.*) INTO result FROM public.copilot_turns r WHERE id=(p_data->>'id')::uuid AND created_by=p_actor AND question=p_data->>'question' AND case_id IS NOT DISTINCT FROM kid;
   IF result IS NOT NULL THEN RETURN jsonb_build_object('generate',false,'turn',result); END IF;
   SELECT count(*) INTO v_count FROM public.copilot_turns WHERE created_by=p_actor AND created_at>now()-interval '1 minute';
   IF v_count>=5 THEN RAISE EXCEPTION 'Limite de 5 consultas por minuto.'; END IF;
   INSERT INTO public.copilot_turns(id,created_by,case_id,question) VALUES((p_data->>'id')::uuid,p_actor,kid,p_data->>'question') RETURNING to_jsonb(copilot_turns.*) INTO result;RETURN jsonb_build_object('generate',true,'turn',result);
  END IF;
  UPDATE public.copilot_turns SET answer=p_data->>'answer',citations_json=coalesce(p_data->'citations_json','[]'),status=CASE WHEN p_data->>'answer' IS NULL THEN 'failed' ELSE 'draft' END,updated_at=now()
   WHERE id=(p_data->>'id')::uuid AND created_by=p_actor AND case_id IS NOT DISTINCT FROM kid AND status='pending' RETURNING to_jsonb(copilot_turns.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Consulta indisponível.'; END IF;RETURN result;
 END IF;
 ctx:=m14_private.hub_context(p_context);cid:=(ctx->>'client_id')::uuid;kid:=(ctx->>'case_id')::uuid;lid:=(ctx->>'lead_id')::uuid;
 IF p_action='client_save' THEN
  IF cid IS NULL OR jsonb_typeof(p_data->'address_json') IS DISTINCT FROM 'object' OR octet_length((p_data->'address_json')::text)>4000 OR (nullif(p_data->>'phone','') IS NOT NULL AND p_data->>'phone' !~ '^\+[1-9][0-9]{7,14}$') OR char_length(coalesce(p_data->>'email',''))>254 THEN RAISE EXCEPTION 'Contato inválido.'; END IF;
  UPDATE public.clients SET phone=nullif(p_data->>'phone',''),email=nullif(p_data->>'email',''),address_json=p_data->'address_json' WHERE id=cid AND updated_at=(p_data->>'expected_updated_at')::timestamptz RETURNING to_jsonb(clients.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Cliente alterado. Atualize a ficha.'; END IF; RETURN result;
 ELSIF p_action='details' THEN
  RETURN ctx||jsonb_build_object('profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=p_actor),
   'parties',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.case_parties p WHERE case_id=kid),'[]'),
   'conflicts',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.case_parties p WHERE p.case_id<>kid AND (p.document_number=ctx->'client'->>'document_number' OR lower(p.full_name)=lower(ctx->'client'->>'full_name'))),'[]'),
   'emails',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.email_outbox e WHERE client_id=cid AND (kid IS NULL OR case_id=kid)),'[]'),
   'inbound_emails',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY received_at DESC) FROM public.email_triage e WHERE status='linked' AND (case_id=kid OR (kid IS NULL AND case_id IN(SELECT id FROM public.cases WHERE client_id=cid)))),'[]'),
   'kits',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY created_at DESC) FROM public.document_kits d WHERE case_id=kid),'[]'));
 ELSIF p_action='kit_review' THEN
  IF kid IS NULL OR NOT EXISTS(SELECT 1 FROM public.document_kits WHERE id=(p_data->>'base_kit_id')::uuid AND case_id=kid) OR (p_data->>'reviewed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Kit de outro caso ou revisão ausente.'; END IF;
  INSERT INTO public.document_kits(id,case_id,created_by,inputs,documents) VALUES((p_data->>'id')::uuid,kid,p_actor,jsonb_build_object('base_kit_id',p_data->>'base_kit_id','human_reviewed',true),p_data->'documents') ON CONFLICT(id) DO NOTHING;
  SELECT to_jsonb(d.*) INTO STRICT result FROM public.document_kits d WHERE id=(p_data->>'id')::uuid AND case_id=kid AND created_by=p_actor AND documents=p_data->'documents';RETURN result;
 ELSIF p_action='kit_save' THEN
  IF kid IS NULL THEN RAISE EXCEPTION 'Kit exige caso de cliente.'; END IF;
  INSERT INTO public.document_kits(id,case_id,created_by,inputs,documents) VALUES((p_data->>'id')::uuid,kid,p_actor,p_data->'inputs',p_data->'documents')
   ON CONFLICT(id) DO NOTHING;
  SELECT to_jsonb(d.*) INTO STRICT result FROM public.document_kits d WHERE id=(p_data->>'id')::uuid AND case_id=kid AND created_by=p_actor AND inputs=p_data->'inputs';RETURN result;
 ELSIF p_action IN ('email_prepare','email_preview') THEN
  IF cid IS NULL OR coalesce(ctx->'client'->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Cadastre um e-mail válido para o cliente.'; END IF;
  IF p_action='email_prepare' AND (p_data->>'reviewed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Revisão e autorização de envio obrigatórias.'; END IF;
  v_template:=p_data->>'template';
  IF v_template='summary' THEN
   v_subject:='Resumo do atendimento — M14 Advocacia';v_content:=ctx->'case'->>'ai_summary';
   IF kid IS NULL OR coalesce(v_content,'')='' THEN RAISE EXCEPTION 'Aprove o resumo do caso antes de enviar.'; END IF;
  ELSIF v_template='payment' THEN
   SELECT * INTO STRICT pay FROM public.payments WHERE id=(p_data->>'reference_id')::uuid AND client_id=cid AND (kid IS NULL OR case_id=kid);
   IF pay.checkout_url IS NULL OR pay.checkout_state<>'ready' OR pay.status<>'pending' THEN RAISE EXCEPTION 'Cobrança sem link pendente disponível.'; END IF;
   v_subject:='Link de pagamento — M14 Advocacia';v_content:='Segue o link de pagamento solicitado: '||pay.checkout_url;
  ELSIF v_template='appointment' THEN
   SELECT * INTO STRICT ap FROM public.appointments WHERE id=(p_data->>'reference_id')::uuid AND (case_id IN(SELECT id FROM public.cases WHERE client_id=cid) OR lead_id IN(SELECT id FROM public.leads_intake WHERE converted_client_id=cid)) AND (kid IS NULL OR case_id=kid);
   IF ap.status<>'confirmado' THEN RAISE EXCEPTION 'Confirme o compromisso antes de enviar a confirmação.'; END IF;
   v_subject:='Confirmação de compromisso — M14 Advocacia';v_content:='Compromisso confirmado em '||to_char(ap.starts_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (São Paulo).'||CASE WHEN ap.meeting_url IS NULL THEN '' ELSE E'\nLink de reunião: '||ap.meeting_url END;
  ELSE RAISE EXCEPTION 'Modelo de e-mail inválido.'; END IF;
  IF p_action='email_preview' THEN RETURN jsonb_build_object('recipient',ctx->'client'->>'email','subject',v_subject,'content',v_content,'preview_token',md5(v_subject||v_content||(ctx->'client'->>'email'))); END IF;
  IF p_data->>'preview_token' IS DISTINCT FROM md5(v_subject||v_content||(ctx->'client'->>'email')) THEN RAISE EXCEPTION 'Conteúdo alterado. Pré-visualize e revise novamente.'; END IF;
  PERFORM pg_advisory_xact_lock(14006,3);
  SELECT * INTO em FROM public.email_outbox WHERE id=(p_data->>'id')::uuid FOR UPDATE;
  IF FOUND THEN
   IF em.created_by<>p_actor OR em.client_id<>cid OR em.case_id IS DISTINCT FROM kid OR em.template<>v_template OR em.reference_id IS DISTINCT FROM nullif(p_data->>'reference_id','')::uuid THEN RAISE EXCEPTION 'Identificador de outro envio.'; END IF;
   RETURN jsonb_build_object('send',false,'email',to_jsonb(em));
  END IF;
  IF (SELECT count(*) FROM public.email_outbox WHERE created_by=p_actor AND created_at>now()-interval '1 minute')>=10 THEN RAISE EXCEPTION 'Limite de 10 e-mails por minuto.'; END IF;
  INSERT INTO public.email_outbox(id,created_by,lead_id,client_id,case_id,template,reference_id,recipient,subject,content,provider)
   VALUES((p_data->>'id')::uuid,p_actor,lid,cid,kid,v_template,nullif(p_data->>'reference_id','')::uuid,ctx->'client'->>'email',v_subject,v_content,p_data->>'provider') RETURNING * INTO em;
  RETURN jsonb_build_object('send',true,'email',to_jsonb(em));
 ELSIF p_action='email_finish' THEN
  UPDATE public.email_outbox SET status=CASE WHEN nullif(p_data->>'external_id','') IS NULL THEN 'unknown' ELSE 'sent' END,external_id=p_data->>'external_id',updated_at=now()
   WHERE id=(p_data->>'id')::uuid AND created_by=p_actor AND client_id=cid AND case_id IS NOT DISTINCT FROM kid AND status='pending' RETURNING to_jsonb(email_outbox.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Envio já registrado. Atualize a ficha.'; END IF;RETURN result;
 END IF;
 RAISE EXCEPTION 'Operação inválida.';
END $$;
-- Eventos externos só entram após assinatura/autenticação e normalização na Edge.
CREATE OR REPLACE FUNCTION public.office_receive_email(p_provider text,p_external_id text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;v_cases jsonb;BEGIN
 SELECT coalesce(jsonb_agg(id),'[]') INTO v_cases FROM public.cases WHERE cnj_number IN(SELECT jsonb_array_elements_text(p_data->'cnj_numbers_json'));
 INSERT INTO public.email_triage(provider,external_id,sender,subject,content,priority,classification_method,cnj_numbers_json,suggested_case_ids)
 VALUES(p_provider,p_external_id,p_data->>'sender',p_data->>'subject',p_data->>'content',p_data->>'priority',p_data->>'classification_method',p_data->'cnj_numbers_json',v_cases)
 ON CONFLICT(provider,external_id) DO NOTHING RETURNING to_jsonb(email_triage.*) INTO result;
 IF result IS NULL THEN RETURN jsonb_build_object('duplicate',true); END IF; RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.office_phase6_action(uuid,text,jsonb,jsonb),public.office_receive_email(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.office_phase6_action(uuid,text,jsonb,jsonb),public.office_receive_email(text,text,jsonb) TO service_role;
COMMIT;
