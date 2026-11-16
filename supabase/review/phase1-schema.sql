-- M14 Advocacia | Fase 1 | PROPOSTA PARA AUDITORIA, NÃO APLICADA.
-- Alvo futuro: neotdgoftxkfaljpmddk. PostgreSQL 17 / Supabase.
-- Executar como postgres somente após aprovação e inspeção do schema existente.
-- Reexecução suportada para este mesmo schema; IF NOT EXISTS não corrige drift.
-- Não expor o schema m14_private na Data API.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS m14_private;
REVOKE ALL ON SCHEMA m14_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA m14_private TO authenticated;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  oab_number text,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  is_active boolean NOT NULL DEFAULT true,
  phone text,
  bio text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  document_type text CHECK (document_type IN ('cpf','cnpj')),
  document_number text,
  phone text,
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  address_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(address_json) = 'object'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coalesce((document_type IS NULL AND document_number IS NULL) OR
    (document_type = 'cpf' AND document_number IS NOT NULL AND document_number ~ '^[0-9]{11}$') OR
    (document_type = 'cnpj' AND document_number IS NOT NULL AND document_number ~ '^[A-Z0-9]{12}[0-9]{2}$'), false)),
  UNIQUE (document_type, document_number)
);
-- Formato normalizado acima; dígitos verificadores serão validados na Edge Function.
-- Sem documento, nomes iguais NÃO são considerados a mesma pessoa automaticamente.

CREATE TABLE IF NOT EXISTS public.leads_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  practice_area text NOT NULL CHECK (practice_area IN ('familia_sucessoes','medico_saude','criminal','contratos','outros')),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 3000),
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','alta','urgente')),
  stage text NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo','triagem','reuniao_agendada','proposta','fechado','arquivado')),
  source text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','whatsapp','manual','indicacao')),
  lgpd_consent_at timestamptz NOT NULL DEFAULT now(),
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 80),
  converted_client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'fechado' OR converted_client_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  source_lead_id uuid UNIQUE REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  practice_area text NOT NULL CHECK (practice_area IN ('familia_sucessoes','medico_saude','criminal','contratos','outros')),
  cnj_number text CHECK (cnj_number IS NULL OR cnj_number ~ '^[0-9]{20}$'),
  court_alias text,
  opposing_party text,
  is_confidential boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','suspenso','encerrado','arquivado')),
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, client_id)
);
-- Sem UNIQUE global em cnj_number: um processo pode representar vários clientes.
-- is_confidential orienta integrações; NÃO implementa compartimentação por advogado.

CREATE TABLE IF NOT EXISTS public.case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  party_role text NOT NULL CHECK (party_role IN ('cliente','adversa','terceiro')),
  document_type text CHECK (document_type IN ('cpf','cnpj')),
  document_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coalesce((document_type IS NULL AND document_number IS NULL) OR
    (document_type = 'cpf' AND document_number IS NOT NULL AND document_number ~ '^[0-9]{11}$') OR
    (document_type = 'cnpj' AND document_number IS NOT NULL AND document_number ~ '^[A-Z0-9]{12}[0-9]{2}$'), false))
);
-- Base para busca de conflito por documento/nome; alertas e análise humana na Fase 3.

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  type text NOT NULL CHECK (type IN ('consulta','audiencia','prazo','interno')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  meeting_url text,
  lead_id uuid REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  payment_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','concluido','cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- Datas timestamptz; exibição America/Sao_Paulo. Cálculo judicial fica fora deste SQL.

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  case_id uuid,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE RESTRICT,
  order_nsu uuid NOT NULL UNIQUE,
  infinitepay_slug text,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  fee_type text NOT NULL DEFAULT 'inicial' CHECK (fee_type IN ('consulta','inicial','parcela','exito')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 999999999999),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  capture_method text,
  checkout_url text,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','settled','canceled','refunded','failed')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, client_id) REFERENCES public.cases(id, client_id) ON DELETE RESTRICT,
  CHECK (order_nsu = id),
  CHECK (status NOT IN ('paid','settled') OR paid_at IS NOT NULL)
);
-- Status são internos. NÃO pressupõem nomes de eventos da API InfinitePay.
-- Edge Function deve fornecer o mesmo UUID em id e order_nsu.

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'infinitepay' CHECK (provider = 'infinitepay'),
  deduplication_key text NOT NULL CHECK (char_length(deduplication_key) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, deduplication_key)
);
-- Não armazena payload sensível bruto. Dedupe não autentica webhook.
-- Fase 4: confirmação no provedor + transação única evento/pagamento/agendamento.

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads_intake(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type text NOT NULL CHECK (sender_type IN ('client','human','ai_agent')),
  content text CHECK (content IS NULL OR char_length(content) <= 30000),
  media_url text,
  provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta','evolution')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL),
  CHECK (NULLIF(btrim(content),'') IS NOT NULL OR media_url IS NOT NULL),
  CHECK ((direction = 'inbound' AND sender_type = 'client') OR
         (direction = 'outbound' AND sender_type IN ('human','ai_agent'))),
  UNIQUE (provider, external_id)
);
-- media_url: identificador/caminho privado, nunca URL pública permanente de documento.

CREATE TABLE IF NOT EXISTS public.agent_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tone_examples_json jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tone_examples_json) = 'array'),
  practice_knowledge_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(practice_knowledge_json) = 'object'),
  oab_guardrails_enabled boolean NOT NULL DEFAULT true CHECK (oab_guardrails_enabled),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- agent_config é o perfil único de estilo do escritório; não duplicar em agent_style_profiles.

CREATE TABLE IF NOT EXISTS public.case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 1 AND 1024),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Storage privado será provisionado no módulo de documentos; nenhum bucket público criado.
-- Metadados não garantem existência do objeto. Edge valida MIME, tamanho e associação.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  entity text NOT NULL,
  entity_id text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- actor_id sem FK preserva auditoria após exclusão autorizada de identidade.
-- Em ações de serviço, actor_id pode ser NULL; não fingir identidade humana.

-- Índices: FKs, Kanban, agenda, financeiro, histórico e conflito.
CREATE INDEX IF NOT EXISTS m14_clients_name_idx ON public.clients (lower(full_name));
CREATE INDEX IF NOT EXISTS m14_leads_stage_created_idx ON public.leads_intake (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS m14_leads_phone_idx ON public.leads_intake (phone);
CREATE INDEX IF NOT EXISTS m14_leads_client_idx ON public.leads_intake (converted_client_id);
CREATE INDEX IF NOT EXISTS m14_cases_client_idx ON public.cases (client_id);
CREATE INDEX IF NOT EXISTS m14_cases_cnj_idx ON public.cases (cnj_number) WHERE cnj_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS m14_cases_status_idx ON public.cases (status);
CREATE INDEX IF NOT EXISTS m14_parties_case_idx ON public.case_parties (case_id);
CREATE INDEX IF NOT EXISTS m14_parties_document_idx ON public.case_parties (document_type, document_number);
CREATE INDEX IF NOT EXISTS m14_parties_name_idx ON public.case_parties (lower(full_name));
CREATE INDEX IF NOT EXISTS m14_appointments_start_idx ON public.appointments (starts_at);
CREATE INDEX IF NOT EXISTS m14_appointments_lead_idx ON public.appointments (lead_id);
CREATE INDEX IF NOT EXISTS m14_appointments_case_idx ON public.appointments (case_id);
CREATE INDEX IF NOT EXISTS m14_payments_client_idx ON public.payments (client_id);
CREATE INDEX IF NOT EXISTS m14_payments_case_client_idx ON public.payments (case_id, client_id);
CREATE INDEX IF NOT EXISTS m14_payments_appointment_idx ON public.payments (appointment_id);
CREATE INDEX IF NOT EXISTS m14_payments_status_due_idx ON public.payments (status, due_date);
CREATE INDEX IF NOT EXISTS m14_events_payment_idx ON public.payment_events (payment_id);
CREATE INDEX IF NOT EXISTS m14_messages_lead_created_idx ON public.whatsapp_messages (lead_id, created_at);
CREATE INDEX IF NOT EXISTS m14_messages_client_created_idx ON public.whatsapp_messages (client_id, created_at);
CREATE INDEX IF NOT EXISTS m14_documents_case_idx ON public.case_documents (case_id);
CREATE INDEX IF NOT EXISTS m14_documents_uploader_idx ON public.case_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS m14_audit_entity_idx ON public.audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS m14_audit_actor_idx ON public.audit_logs (actor_id, created_at DESC);

-- Helpers em schema NÃO exposto. SECURITY DEFINER evita recursão na RLS de profiles.
-- Exceção deliberada e restrita: apenas existência/role do usuário autenticado.
CREATE OR REPLACE FUNCTION m14_private.is_office_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
  );
$$;
CREATE OR REPLACE FUNCTION m14_private.is_office_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active AND p.role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION m14_private.is_office_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION m14_private.is_office_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION m14_private.is_office_member() TO authenticated;
GRANT EXECUTE ON FUNCTION m14_private.is_office_admin() TO authenticated;

CREATE OR REPLACE FUNCTION m14_private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION m14_private.audit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN row_id := to_jsonb(OLD)->>'id';
  ELSE row_id := to_jsonb(NEW)->>'id'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, metadata_json)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, row_id,
    jsonb_build_object('db_role', current_setting('role', true)));
  -- Não copiar nomes, documentos, mensagens, tokens ou conteúdos antigos/novos ao log.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION m14_private.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION m14_private.audit_change() FROM PUBLIC, anon, authenticated;

-- Triggers e RLS em TODAS as tabelas do projeto, sem afetar tabelas alheias.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','clients','leads_intake','cases','case_parties',
    'appointments','payments','payment_events','whatsapp_messages','agent_config',
    'case_documents','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    IF t <> 'audit_logs' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS m14_audit ON public.%I', t);
      EXECUTE format('CREATE TRIGGER m14_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.audit_change()', t);
    END IF;
    IF t NOT IN ('audit_logs','payment_events') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS m14_touch ON public.%I', t);
      EXECUTE format('CREATE TRIGGER m14_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION m14_private.touch_updated_at()', t);
    END IF;
  END LOOP;
END;
$$;
-- Logs são gravados exclusivamente pelo trigger; nem service_role recebe DML direto.
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM service_role;
-- Eventos já recebidos não podem ser apagados pelo serviço de integração.
REVOKE DELETE ON public.payment_events FROM service_role;

-- Leitura interna. Todos os membros ativos pertencem ao MESMO escritório.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','clients','leads_intake','cases','case_parties',
    'appointments','payments','whatsapp_messages','case_documents'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_read ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_member_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_member()))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['agent_config','payment_events','audit_logs'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_admin_read ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_admin_read ON public.%I FOR SELECT TO authenticated USING ((SELECT m14_private.is_office_admin()))', t);
  END LOOP;
END;
$$;

-- CRUD operacional. Sem DELETE via navegador; arquivamento por status.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','leads_intake','cases','case_parties'] LOOP
    EXECUTE format('GRANT INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS m14_member_update ON public.%I', t);
    EXECUTE format('CREATE POLICY m14_member_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT m14_private.is_office_member()))', t);
    EXECUTE format('CREATE POLICY m14_member_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT m14_private.is_office_member())) WITH CHECK ((SELECT m14_private.is_office_member()))', t);
  END LOOP;
END;
$$;
-- Agenda, documentos, mensagens, pagamentos, configuração e profiles:
-- escrita exclusivamente por Edge Functions autenticadas/autorizadas.
-- Isso impede confirmar agenda paga, forjar pagamento ou promover papel pelo browser.
-- As Edge Functions devem checar usuário/membro ANTES de usar service_role.

-- Entrada pública conforme Prompt Master: apenas os campos do formulário.
GRANT INSERT (name, phone, email, practice_area, summary, urgency, consent_version)
  ON public.leads_intake TO anon;
DROP POLICY IF EXISTS m14_public_intake ON public.leads_intake;
CREATE POLICY m14_public_intake ON public.leads_intake
  FOR INSERT TO anon
  WITH CHECK (
    stage = 'novo' AND source = 'portal' AND converted_client_id IS NULL
    AND consent_version = 'privacy-v1'
    AND lgpd_consent_at = now() AND created_at = now() AND updated_at = now()
  );
-- Sem SELECT/UPDATE/DELETE para anon. Usar INSERT com return=minimal, sem .select().
-- 'privacy-v1' é identificador técnico proposto, não política jurídica já aprovada.
-- LIMITAÇÃO: RLS não impõe rate limit/CAPTCHA. Antes do portal público:
-- preferir leads-intake Edge + antiabuso, REVOGANDO este GRANT direto em migration.
-- Caso contrário chamadas diretas à REST API contornam o CAPTCHA do frontend.

COMMIT;
