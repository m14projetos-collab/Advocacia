-- M14 | Fase 5. Aplicar após Fases 1–4. Não expor m14_private na Data API.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Um contato recebido não equivale a consentimento LGPD coletado pelo portal.
ALTER TABLE public.leads_intake ALTER COLUMN lgpd_consent_at DROP NOT NULL;
ALTER TABLE public.leads_intake ADD COLUMN IF NOT EXISTS identity_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS remote_phone text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'received'
  CHECK(send_state IN ('received','pending','sent','delivered','read','failed','unknown'));
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS provider_media_id text;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz;
CREATE INDEX IF NOT EXISTS m14_messages_case_idx ON public.whatsapp_messages(case_id,created_at);
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE public.agent_config ADD COLUMN IF NOT EXISTS document_ai_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.case_lookups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES public.cases(id),created_by uuid NOT NULL REFERENCES public.profiles(id),status text NOT NULL CHECK(status IN ('public','not_found','restricted')),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS m14_lookup_case_idx ON public.case_lookups(case_id,created_at);
CREATE INDEX IF NOT EXISTS m14_lookup_actor_idx ON public.case_lookups(created_by);
CREATE TABLE IF NOT EXISTS public.call_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES public.leads_intake(id),
 client_id uuid REFERENCES public.clients(id),case_id uuid REFERENCES public.cases(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 outcome text NOT NULL CHECK(outcome IN ('atendida','sem_resposta','retorno_pendente')),
 notes text NOT NULL CHECK(char_length(notes) BETWEEN 1 AND 3000),duration_seconds integer CHECK(duration_seconds BETWEEN 0 AND 86400),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(lead_id IS NOT NULL OR client_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.ai_runs(
 id uuid PRIMARY KEY,lead_id uuid REFERENCES public.leads_intake(id),client_id uuid REFERENCES public.clients(id),
 case_id uuid REFERENCES public.cases(id),created_by uuid NOT NULL REFERENCES public.profiles(id),
 task text NOT NULL CHECK(task IN ('summary','meeting','reply')),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','draft','failed','reviewed')),
 content text CHECK(char_length(content)<=20000),model text NOT NULL,document_id uuid REFERENCES public.case_documents(id),
 reviewed_by uuid REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(lead_id IS NOT NULL OR client_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.document_access_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES public.case_documents(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),purpose text NOT NULL CHECK(purpose IN ('download','ai')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS m14_private.whatsapp_routes(
 provider text NOT NULL CHECK(provider IN ('meta','evolution')),phone text NOT NULL,
 lead_id uuid REFERENCES public.leads_intake(id),client_id uuid REFERENCES public.clients(id),
 PRIMARY KEY(provider,phone),CHECK(lead_id IS NOT NULL OR client_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS m14_private.ai_rate_limits(
 actor_id uuid NOT NULL,minute_bucket timestamptz NOT NULL,hits integer NOT NULL DEFAULT 1,PRIMARY KEY(actor_id,minute_bucket)
);
CREATE INDEX IF NOT EXISTS m14_calls_lead_idx ON public.call_logs(lead_id,created_at);
CREATE INDEX IF NOT EXISTS m14_calls_client_idx ON public.call_logs(client_id,created_at);
CREATE INDEX IF NOT EXISTS m14_calls_case_idx ON public.call_logs(case_id,created_at);
CREATE INDEX IF NOT EXISTS m14_ai_case_idx ON public.ai_runs(case_id,created_at);
CREATE INDEX IF NOT EXISTS m14_ai_client_idx ON public.ai_runs(client_id,created_at);
CREATE INDEX IF NOT EXISTS m14_ai_lead_idx ON public.ai_runs(lead_id,created_at);
CREATE INDEX IF NOT EXISTS m14_document_access_doc_idx ON public.document_access_logs(document_id);
CREATE INDEX IF NOT EXISTS m14_document_access_actor_idx ON public.document_access_logs(actor_id);
CREATE INDEX IF NOT EXISTS m14_ai_actor_idx ON public.ai_runs(created_by);
CREATE INDEX IF NOT EXISTS m14_ai_document_idx ON public.ai_runs(document_id);
CREATE INDEX IF NOT EXISTS m14_message_actor_idx ON public.whatsapp_messages(created_by);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['call_logs','ai_runs','document_access_logs','case_lookups'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS m14_read ON public.%I',t);
  IF t='document_access_logs' THEN
   EXECUTE format('CREATE POLICY m14_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_admin()))',t);
  ELSE
   EXECUTE format('CREATE POLICY m14_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_member()))',t);
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS m14_audit ON public.%I',t);
  EXECUTE format('CREATE TRIGGER m14_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.audit_change()',t);
 END LOOP;
END $$;
ALTER TABLE m14_private.whatsapp_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE m14_private.ai_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON m14_private.whatsapp_routes,m14_private.ai_rate_limits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON m14_private.whatsapp_routes,m14_private.ai_rate_limits TO service_role;
REVOKE INSERT,UPDATE,DELETE ON public.whatsapp_messages,public.agent_config,public.case_documents FROM PUBLIC,anon,authenticated;
INSERT INTO public.agent_config(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

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
  'case',CASE WHEN kid IS NOT NULL THEN to_jsonb(k) END,'phone',coalesce(l.phone,c.phone));
END $$;

CREATE OR REPLACE FUNCTION public.office_phase5_action(p_actor uuid,p_action text,p_context jsonb,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ctx jsonb;lid uuid;cid uuid;kid uuid;pid uuid;doc public.case_documents%ROWTYPE;
 msg public.whatsapp_messages%ROWTYPE;run public.ai_runs%ROWTYPE;cfg public.agent_config%ROWTYPE;
 result jsonb;v_hits integer;v_phone text;v_offset integer:=coalesce((p_data->>'offset')::integer,0);
BEGIN
 PERFORM m14_private.phase4_actor(p_actor);
 IF p_action IN ('config_get','config_save') THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin' AND is_active) THEN RAISE EXCEPTION 'Somente administrador.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT cfg FROM public.agent_config WHERE id=1 FOR UPDATE;
  IF p_action='config_save' THEN
   IF p_data->>'expected_updated_at' IS NULL OR (p_data->>'expected_updated_at')::timestamptz IS DISTINCT FROM cfg.updated_at THEN RAISE EXCEPTION 'Configuração alterada. Atualize antes de salvar.'; END IF;
   IF jsonb_typeof(p_data->'tone_examples_json') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'tone_examples_json')>10
     OR jsonb_typeof(p_data->'practice_knowledge_json') IS DISTINCT FROM 'object' OR octet_length(p_data::text)>30000
     OR (p_data->>'oab_guardrails_enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Configuração inválida; trava OAB obrigatória.'; END IF;
   UPDATE public.agent_config SET tone_examples_json=p_data->'tone_examples_json',practice_knowledge_json=p_data->'practice_knowledge_json',
    document_ai_enabled=coalesce((p_data->>'document_ai_enabled')::boolean,false),oab_guardrails_enabled=true WHERE id=1 RETURNING * INTO cfg;
  END IF;
  RETURN to_jsonb(cfg);
 END IF;
 ctx:=m14_private.hub_context(p_context);lid:=(ctx->>'lead_id')::uuid;cid:=(ctx->>'client_id')::uuid;kid:=(ctx->>'case_id')::uuid;
 IF p_action='snapshot' THEN
  IF v_offset<0 OR v_offset>100000 THEN RAISE EXCEPTION 'Paginação inválida.'; END IF;
  RETURN ctx||jsonb_build_object('actor',(SELECT jsonb_build_object('id',id,'full_name',full_name,'role',role) FROM public.profiles WHERE id=p_actor),
   'cases',coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.created_at DESC) FROM public.cases k WHERE k.client_id=cid),'[]'),
   'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id) FROM(SELECT * FROM public.whatsapp_messages WHERE (client_id=cid OR lead_id=lid) ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET v_offset)m),'[]'),
   'has_more',(SELECT count(*)>v_offset+100 FROM public.whatsapp_messages WHERE client_id=cid OR lead_id=lid),
   'calls',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.call_logs a WHERE a.client_id=cid OR a.lead_id=lid),'[]'),
   'lookups',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC) FROM(SELECT * FROM public.case_lookups WHERE case_id=kid ORDER BY created_at DESC LIMIT 5)q),'[]'),
   'documents',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC) FROM public.case_documents d WHERE d.case_id=kid),'[]'),
   'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.starts_at DESC) FROM public.appointments a WHERE a.case_id=kid OR a.lead_id=lid OR a.case_id IN(SELECT id FROM public.cases WHERE client_id=cid)),'[]'),
   'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM public.payments p WHERE p.client_id=cid),'[]'),
   'ai_runs',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM(SELECT * FROM public.ai_runs WHERE case_id=kid OR (kid IS NULL AND (client_id=cid OR lead_id=lid)) ORDER BY created_at DESC LIMIT 30)r),'[]'));
 ELSIF p_action='outbox' THEN
  pid:=(p_data->>'id')::uuid;
  PERFORM pg_advisory_xact_lock(14005,1);
  SELECT * INTO msg FROM public.whatsapp_messages WHERE request_id=pid FOR UPDATE;
  IF FOUND THEN
   IF msg.lead_id IS DISTINCT FROM lid OR msg.client_id IS DISTINCT FROM cid OR msg.content IS DISTINCT FROM p_data->>'content' OR msg.case_id IS DISTINCT FROM kid THEN RAISE EXCEPTION 'Identificador já usado com outro contexto.'; END IF;
   RETURN jsonb_build_object('message',to_jsonb(msg),'send',false);
  END IF;
  v_phone:=ctx->>'phone';
  IF v_phone IS NULL OR v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Contato sem telefone E.164 válido.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE (lead_id=lid OR client_id=cid) AND provider=p_data->>'provider' AND remote_phone=v_phone AND direction='inbound'
    AND provider_timestamp>now()-interval '24 hours' AND provider_timestamp<=now()+interval '5 minutes') THEN
    RAISE EXCEPTION 'Janela de atendimento de 24h fechada. Aguarde novo contato ou use template aprovado no provedor; texto livre bloqueado.';
  END IF;
  IF (p_data->>'reviewed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Revise a resposta antes do envio.'; END IF;
  INSERT INTO public.whatsapp_messages(lead_id,client_id,case_id,request_id,created_by,direction,sender_type,content,provider,send_state,remote_phone)
   VALUES(lid,cid,kid,pid,p_actor,'outbound','human',p_data->>'content',p_data->>'provider','pending',v_phone) RETURNING * INTO msg;
  RETURN jsonb_build_object('message',to_jsonb(msg),'phone',v_phone,'send',true);
 ELSIF p_action='sent' THEN
  SELECT * INTO STRICT msg FROM public.whatsapp_messages WHERE request_id=(p_data->>'id')::uuid FOR UPDATE;
  IF msg.created_by<>p_actor OR msg.lead_id IS DISTINCT FROM lid OR msg.client_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'Mensagem de outro contexto.'; END IF;
  UPDATE public.whatsapp_messages SET external_id=coalesce(external_id,nullif(p_data->>'external_id','')),
    send_state=CASE WHEN send_state IN ('read','delivered') THEN send_state WHEN p_data->>'external_id' IS NOT NULL THEN 'sent' ELSE 'unknown' END WHERE id=msg.id RETURNING * INTO msg;
  RETURN to_jsonb(msg);
 ELSIF p_action='message_case' THEN
  IF kid IS NULL THEN RAISE EXCEPTION 'Selecione o caso.'; END IF;
  UPDATE public.whatsapp_messages SET case_id=kid WHERE id=(p_data->>'id')::uuid AND client_id=cid RETURNING to_jsonb(whatsapp_messages.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Mensagem de outro cliente.'; END IF; RETURN result;
 ELSIF p_action='call' THEN
  INSERT INTO public.call_logs(id,lead_id,client_id,case_id,created_by,direction,outcome,notes,duration_seconds)
  VALUES((p_data->>'id')::uuid,lid,cid,kid,p_actor,p_data->>'direction',p_data->>'outcome',p_data->>'notes',nullif(p_data->>'duration_seconds','')::integer)
  ON CONFLICT(id) DO NOTHING RETURNING to_jsonb(call_logs.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Registro já recebido. Atualize o histórico.'; END IF; RETURN result;
 ELSIF p_action='case_update' THEN
  IF kid IS NULL THEN RAISE EXCEPTION 'Selecione um caso.'; END IF;
  UPDATE public.cases SET cnj_number=nullif(p_data->>'cnj_number',''),is_confidential=(p_data->>'is_confidential')::boolean
  WHERE id=kid AND updated_at=(p_data->>'expected_updated_at')::timestamptz RETURNING to_jsonb(cases.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Caso alterado. Atualize a ficha.'; END IF; RETURN result;
 ELSIF p_action='datajud_store' THEN
  IF kid IS NULL OR (SELECT is_confidential FROM public.cases WHERE id=kid) THEN RAISE EXCEPTION 'Consulta pública bloqueada para caso sigiloso.'; END IF;
  INSERT INTO public.case_lookups(case_id,created_by,status,metadata) VALUES(kid,p_actor,p_data->>'status',p_data->'metadata') RETURNING to_jsonb(case_lookups.*) INTO result;RETURN result;
 ELSIF p_action='file_add' THEN
  IF kid IS NULL OR p_data->>'storage_path' NOT LIKE kid::text||'/%' THEN RAISE EXCEPTION 'Caminho de documento inválido.'; END IF;
  INSERT INTO public.case_documents(id,case_id,storage_path,original_name,mime_type,size_bytes,uploaded_by,sha256)
   VALUES((p_data->>'id')::uuid,kid,p_data->>'storage_path',p_data->>'original_name',p_data->>'mime_type',(p_data->>'size_bytes')::bigint,p_actor,p_data->>'sha256') RETURNING to_jsonb(case_documents.*) INTO result;
  RETURN result;
 ELSIF p_action='file_access' THEN
  SELECT * INTO STRICT doc FROM public.case_documents WHERE id=(p_data->>'id')::uuid AND case_id=kid;
  INSERT INTO public.document_access_logs(document_id,actor_id,purpose)VALUES(doc.id,p_actor,p_data->>'purpose');RETURN to_jsonb(doc);
 ELSIF p_action='ai_start' THEN
  SELECT * INTO run FROM public.ai_runs WHERE id=(p_data->>'id')::uuid;
  IF FOUND THEN
   IF run.created_by<>p_actor OR run.case_id IS DISTINCT FROM kid OR run.lead_id IS DISTINCT FROM lid OR run.client_id IS DISTINCT FROM cid OR run.task IS DISTINCT FROM p_data->>'task' OR run.document_id IS DISTINCT FROM nullif(p_data->>'document_id','')::uuid THEN RAISE EXCEPTION 'Execução de outro contexto.'; END IF;
   RETURN jsonb_build_object('run',to_jsonb(run),'generate',false);
  END IF;
  IF p_data->>'task' IN ('summary','meeting') AND kid IS NULL THEN RAISE EXCEPTION 'Resumo e pauta exigem caso de cliente.'; END IF;
  INSERT INTO m14_private.ai_rate_limits VALUES(p_actor,date_trunc('minute',now()),1)
   ON CONFLICT(actor_id,minute_bucket) DO UPDATE SET hits=m14_private.ai_rate_limits.hits+1 RETURNING hits INTO v_hits;
  IF v_hits>5 THEN RAISE EXCEPTION 'Limite de geração atingido; aguarde um minuto.'; END IF;
  IF p_data->>'document_id' IS NOT NULL THEN
   PERFORM 1 FROM public.case_documents WHERE id=(p_data->>'document_id')::uuid AND case_id=kid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Documento de outro caso.'; END IF;
  END IF;
  INSERT INTO public.ai_runs(id,lead_id,client_id,case_id,created_by,task,model,document_id)
   VALUES((p_data->>'id')::uuid,lid,cid,kid,p_actor,p_data->>'task',p_data->>'model',nullif(p_data->>'document_id','')::uuid) RETURNING * INTO run;
  RETURN jsonb_build_object('run',to_jsonb(run),'generate',true);
 ELSIF p_action='ai_finish' THEN
  UPDATE public.ai_runs SET status=CASE WHEN p_data->>'content' IS NULL THEN 'failed' ELSE 'draft' END,content=p_data->>'content'
   WHERE id=(p_data->>'id')::uuid AND created_by=p_actor AND case_id IS NOT DISTINCT FROM kid AND lead_id IS NOT DISTINCT FROM lid AND client_id IS NOT DISTINCT FROM cid AND status='pending' RETURNING to_jsonb(ai_runs.*) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Execução não disponível.'; END IF; RETURN result;
 ELSIF p_action='ai_approve' THEN
  SELECT * INTO STRICT run FROM public.ai_runs WHERE id=(p_data->>'id')::uuid AND case_id=kid AND task='summary' AND status IN ('draft','reviewed') FOR UPDATE;
  IF (p_data->>'reviewed')::boolean IS DISTINCT FROM true OR p_data->>'content' IS NULL OR char_length(p_data->>'content') NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Revisão obrigatória.'; END IF;
  UPDATE public.cases SET ai_summary=p_data->>'content' WHERE id=kid;
  UPDATE public.ai_runs SET status='reviewed',reviewed_by=p_actor,content=p_data->>'content' WHERE id=run.id RETURNING to_jsonb(ai_runs.*) INTO result;RETURN result;
 END IF;
 RAISE EXCEPTION 'Operação não permitida.';
END $$;

-- Entrada externa: chamada somente após assinatura válida e normalização pela Edge.
CREATE OR REPLACE FUNCTION public.office_receive_whatsapp(p_provider text,p_external_id text,p_phone text,p_name text,p_content text,p_time timestamptz,p_media_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE route m14_private.whatsapp_routes%ROWTYPE;l public.leads_intake%ROWTYPE;cid uuid;count_clients integer;msg public.whatsapp_messages%ROWTYPE;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM pg_advisory_xact_lock(14005,1);
 IF p_provider NOT IN ('meta','evolution') OR p_external_id IS NULL OR char_length(p_external_id) NOT BETWEEN 1 AND 200 OR p_phone !~ '^\+[1-9][0-9]{7,14}$'
  OR p_time IS NULL OR p_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Evento inválido.'; END IF;
 SELECT * INTO msg FROM public.whatsapp_messages WHERE provider=p_provider AND external_id=p_external_id;
 IF FOUND THEN RETURN jsonb_build_object('duplicate',true,'id',msg.id); END IF;
 SELECT * INTO route FROM m14_private.whatsapp_routes WHERE provider=p_provider AND phone=p_phone;
 IF NOT FOUND THEN
  SELECT count(*),min(id::text)::uuid INTO count_clients,cid FROM public.clients WHERE phone=p_phone;
  IF count_clients=1 THEN route.client_id:=cid;
  ELSE
   SELECT * INTO l FROM public.leads_intake WHERE phone=p_phone AND converted_client_id IS NULL AND stage NOT IN ('arquivado','fechado') ORDER BY created_at DESC LIMIT 1;
   IF NOT FOUND THEN
    INSERT INTO public.leads_intake(name,phone,practice_area,summary,source,consent_version,lgpd_consent_at,identity_review_required)
    VALUES(left(CASE WHEN char_length(btrim(p_name))>=2 THEN btrim(p_name) ELSE 'WhatsApp '||p_phone END,160),p_phone,'outros','Contato iniciado por WhatsApp. Aguardando triagem humana.','whatsapp','not-recorded',NULL,count_clients>1) RETURNING * INTO l;
   END IF;
   route.lead_id:=l.id;
  END IF;
  INSERT INTO m14_private.whatsapp_routes(provider,phone,lead_id,client_id) VALUES(p_provider,p_phone,route.lead_id,route.client_id);
 END IF;
 INSERT INTO public.whatsapp_messages(lead_id,client_id,direction,sender_type,content,provider,external_id,send_state,provider_media_id,provider_timestamp,remote_phone)
 VALUES(route.lead_id,route.client_id,'inbound','client',p_content,p_provider,p_external_id,'received',p_media_id,p_time,p_phone) RETURNING * INTO msg;
 RETURN jsonb_build_object('duplicate',false,'id',msg.id,'lead_id',route.lead_id,'client_id',route.client_id);
END $$;
CREATE OR REPLACE FUNCTION public.office_whatsapp_status(p_provider text,p_external_id text,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_status NOT IN ('sent','delivered','read','failed') THEN RETURN; END IF;
 UPDATE public.whatsapp_messages SET send_state=p_status WHERE provider=p_provider AND external_id=p_external_id AND direction='outbound'
 AND (send_state NOT IN ('read','delivered') OR (send_state='delivered' AND p_status='read'));
END $$;
CREATE OR REPLACE FUNCTION m14_private.phase5_convert_links() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE kid uuid;
BEGIN
 IF NEW.converted_client_id IS NOT NULL AND OLD.converted_client_id IS DISTINCT FROM NEW.converted_client_id THEN
  SELECT id INTO kid FROM public.cases WHERE source_lead_id=NEW.id;
  UPDATE m14_private.whatsapp_routes SET client_id=NEW.converted_client_id WHERE lead_id=NEW.id;
  UPDATE public.call_logs SET client_id=NEW.converted_client_id,case_id=coalesce(case_id,kid) WHERE lead_id=NEW.id;
  UPDATE public.whatsapp_messages SET case_id=coalesce(case_id,kid) WHERE lead_id=NEW.id;
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS m14_convert_links ON public.leads_intake;
CREATE TRIGGER m14_convert_links AFTER UPDATE ON public.leads_intake FOR EACH ROW EXECUTE FUNCTION m14_private.phase5_convert_links();
REVOKE ALL ON FUNCTION m14_private.hub_context(jsonb),m14_private.phase5_convert_links() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION m14_private.hub_context(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.office_phase5_action(uuid,text,jsonb,jsonb),public.office_receive_whatsapp(text,text,text,text,text,timestamptz,text),public.office_whatsapp_status(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.office_phase5_action(uuid,text,jsonb,jsonb),public.office_receive_whatsapp(text,text,text,text,text,timestamptz,text),public.office_whatsapp_status(text,text,text) TO service_role;

-- Bucket privado. Política RESTRICTIVE impede políticas globais de conceder acesso direto.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('case-files','case-files',false,20971520,ARRAY['application/pdf','text/plain','image/jpeg','image/png'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=20971520,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS m14_casefiles_no_direct ON storage.objects;
CREATE POLICY m14_casefiles_no_direct ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'case-files') WITH CHECK(bucket_id<>'case-files');
COMMIT;
