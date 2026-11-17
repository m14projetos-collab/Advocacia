-- M14 | Fase 4. Aplicar após Fases 1, 2 corrigida e 3. Scripts de revisão, não db push.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS checkout_state text NOT NULL DEFAULT 'not_started'
  CHECK (checkout_state IN ('not_started','creating','ready','unknown'));
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_nsu text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS m14_payment_transaction_unique ON public.payments(transaction_nsu) WHERE transaction_nsu IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS m14_appointment_payment_unique ON public.payments(appointment_id)
  WHERE appointment_id IS NOT NULL AND status NOT IN ('canceled','refunded','failed');
CREATE INDEX IF NOT EXISTS m14_payments_creator_idx ON public.payments(created_by);

-- Todas as mutações são service-only. p_actor vem do getUser(jwt) na Edge, nunca do body.
CREATE OR REPLACE FUNCTION m14_private.phase4_actor(p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = p_actor AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membro ativo obrigatório.' USING ERRCODE = '42501'; END IF;
  -- Identidade previamente validada pela Edge; preserva o ator nos triggers de auditoria.
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
END;
$$;

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
    IF v_client IS NOT NULL AND v_lead_client IS NOT NULL AND v_client <> v_lead_client THEN
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

CREATE OR REPLACE FUNCTION public.office_prepare_checkout(p_actor uuid,p_id uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  p public.payments%ROWTYPE; a public.appointments%ROWTYPE; case_client uuid; lead_client uuid;
  v_client uuid := (p_data->>'client_id')::uuid; v_case uuid := nullif(p_data->>'case_id','')::uuid;
  v_appointment uuid := nullif(p_data->>'appointment_id','')::uuid;
  v_amount bigint := (p_data->>'amount_cents')::bigint;
BEGIN
  PERFORM m14_private.phase4_actor(p_actor);
  PERFORM pg_advisory_xact_lock(14004,1);
  IF p_id IS NULL OR v_client IS NULL OR v_amount IS NULL OR v_amount < 100 OR v_amount > 999999999999 THEN
    RAISE EXCEPTION 'Valor inválido: mínimo de R$ 1,00.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.payments WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF p.client_id IS DISTINCT FROM v_client OR p.case_id IS DISTINCT FROM v_case OR p.appointment_id IS DISTINCT FROM v_appointment
      OR p.amount_cents IS DISTINCT FROM v_amount OR p.description IS DISTINCT FROM btrim(p_data->>'description')
      OR p.fee_type IS DISTINCT FROM p_data->>'fee_type' OR p.due_date IS DISTINCT FROM nullif(p_data->>'due_date','')::date THEN
      RAISE EXCEPTION 'UUID já utilizado com outros dados de cobrança.';
    END IF;
    RETURN jsonb_build_object('payment',to_jsonb(p),'create_link',false);
  END IF;
  PERFORM 1 FROM public.clients WHERE id=v_client;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF v_case IS NOT NULL THEN
    SELECT client_id INTO STRICT case_client FROM public.cases WHERE id=v_case;
    IF case_client <> v_client THEN RAISE EXCEPTION 'Caso não pertence ao cliente.'; END IF;
  END IF;
  IF v_appointment IS NOT NULL THEN
    SELECT * INTO STRICT a FROM public.appointments WHERE id=v_appointment FOR UPDATE;
    IF a.status <> 'pendente' OR NOT a.payment_required OR a.type <> 'consulta' THEN
      RAISE EXCEPTION 'Vincule uma consulta pendente que exija pagamento.';
    END IF;
    IF a.case_id IS DISTINCT FROM v_case THEN RAISE EXCEPTION 'Caso diverge da consulta.'; END IF;
    IF a.lead_id IS NOT NULL THEN SELECT converted_client_id INTO lead_client FROM public.leads_intake WHERE id=a.lead_id; END IF;
    IF a.case_id IS NULL AND (lead_client IS NULL OR lead_client <> v_client) THEN
      RAISE EXCEPTION 'Converta o lead ou vincule um caso do cliente à consulta.';
    END IF;
    IF a.case_id IS NOT NULL THEN
      SELECT client_id INTO case_client FROM public.cases WHERE id=a.case_id;
      IF case_client <> v_client THEN RAISE EXCEPTION 'Consulta de outro cliente.'; END IF;
    END IF;
  END IF;
  INSERT INTO public.payments(id,order_nsu,client_id,case_id,appointment_id,description,fee_type,amount_cents,due_date,created_by,checkout_state)
  VALUES(p_id,p_id,v_client,v_case,v_appointment,btrim(p_data->>'description'),p_data->>'fee_type',v_amount,
    nullif(p_data->>'due_date','')::date,p_actor,'creating') RETURNING * INTO p;
  RETURN jsonb_build_object('payment',to_jsonb(p),'create_link',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.office_store_checkout(p_actor uuid,p_id uuid,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.payments%ROWTYPE;
BEGIN
  PERFORM m14_private.phase4_actor(p_actor);
  SELECT * INTO STRICT p FROM public.payments WHERE id=p_id FOR UPDATE;
  IF p_url IS NOT NULL AND p_url !~ '^https://([a-z0-9-]+\.)*infinitepay\.io/' THEN RAISE EXCEPTION 'URL de checkout inválida.'; END IF;
  -- Uma falha/timeout é ambígua: preservar ordem pendente, não gerar outro link automaticamente.
  UPDATE public.payments SET checkout_url=coalesce(checkout_url,p_url),
    checkout_state=CASE WHEN checkout_url IS NOT NULL OR p_url IS NOT NULL THEN 'ready' ELSE 'unknown' END
    WHERE id=p_id RETURNING * INTO p;
  RETURN to_jsonb(p);
END;
$$;

CREATE OR REPLACE FUNCTION public.office_confirm_payment(p_id uuid,p_transaction text,p_slug text,
  p_amount bigint,p_capture_method text,p_payload_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.payments%ROWTYPE; a public.appointments%ROWTYPE; event_id uuid; v_duplicate boolean;
BEGIN
  -- Somente a Edge após payment_check success=true, paid=true e amount conferido.
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM pg_advisory_xact_lock(14004,1);
  SELECT * INTO STRICT p FROM public.payments WHERE id=p_id FOR UPDATE;
  IF p_amount IS NULL OR p_amount <> p.amount_cents OR p_transaction IS NULL OR char_length(p_transaction) NOT BETWEEN 1 AND 120
    OR p_slug IS NULL OR char_length(p_slug) NOT BETWEEN 1 AND 160 OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR p_capture_method IS NULL OR p_capture_method NOT IN ('pix','credit_card') THEN
    RAISE EXCEPTION 'Confirmação divergente ou incompleta.' USING ERRCODE = '22023';
  END IF;
  v_duplicate := p.transaction_nsu IS NOT NULL AND p.transaction_nsu <> p_transaction;
  INSERT INTO public.payment_events(payment_id,deduplication_key,event_type,payload_hash)
    VALUES(p.id,p.id::text || ':' || p_transaction,CASE WHEN v_duplicate THEN 'duplicate_paid' ELSE 'paid_verified' END,p_payload_hash)
    ON CONFLICT(provider,deduplication_key) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NULL THEN RETURN jsonb_build_object('duplicate',true,'payment_id',p.id); END IF;
  IF v_duplicate OR p.status NOT IN ('pending','paid','settled') THEN
    UPDATE public.payments SET review_required=true WHERE id=p.id;
    UPDATE public.payment_events SET processed_at=now() WHERE id=event_id;
    RETURN jsonb_build_object('review_required',true,'payment_id',p.id);
  END IF;
  IF p.infinitepay_slug IS NOT NULL AND p.infinitepay_slug <> p_slug THEN RAISE EXCEPTION 'Slug divergente.'; END IF;
  UPDATE public.payments SET status=CASE WHEN status='settled' THEN 'settled' ELSE 'paid' END,
    paid_at=coalesce(paid_at,now()),transaction_nsu=p_transaction,infinitepay_slug=p_slug,capture_method=p_capture_method
    WHERE id=p.id;
  IF p.appointment_id IS NOT NULL THEN
    SELECT * INTO STRICT a FROM public.appointments WHERE id=p.appointment_id FOR UPDATE;
    -- Cancelamento/conclusão não são revertidos por callback tardio.
    IF a.status='pendente' AND a.payment_required THEN
      UPDATE public.appointments SET status='confirmado' WHERE id=a.id;
    ELSIF a.status='cancelado' THEN
      UPDATE public.payments SET review_required=true WHERE id=p.id;
    END IF;
  END IF;
  UPDATE public.payment_events SET processed_at=now() WHERE id=event_id;
  RETURN jsonb_build_object('duplicate',false,'payment_id',p.id);
END;
$$;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE INSERT,UPDATE,DELETE ON public.appointments,public.payments,public.payment_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION m14_private.phase4_actor(uuid) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA m14_private TO service_role;
GRANT EXECUTE ON FUNCTION m14_private.phase4_actor(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.office_save_appointment(uuid,uuid,jsonb,timestamptz),
  public.office_prepare_checkout(uuid,uuid,jsonb),public.office_store_checkout(uuid,uuid,text),
  public.office_confirm_payment(uuid,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.office_save_appointment(uuid,uuid,jsonb,timestamptz),
  public.office_prepare_checkout(uuid,uuid,jsonb),public.office_store_checkout(uuid,uuid,text),
  public.office_confirm_payment(uuid,text,text,bigint,text,text) TO service_role;
COMMIT;
