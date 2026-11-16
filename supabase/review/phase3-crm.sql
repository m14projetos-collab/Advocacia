-- M14 | Fase 3. Aplicar APÓS phase1-schema.sql e phase2-intake.sql como postgres.
-- Não expor m14_private na Data API. Nenhum GRANT de escrita em mensagens ao browser.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION m14_private.normalized_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT regexp_replace(translate(lower(btrim(p_name)),
    'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g');
$$;

CREATE INDEX IF NOT EXISTS m14_parties_normalized_name_idx
  ON public.case_parties(m14_private.normalized_name(full_name));

-- CPF numérico e CNPJ numérico/alfanumérico, conforme formato previsto na Fase 1.
-- CNPJ alfanumérico usa valor ASCII - 48 para os dígitos verificadores.
CREATE OR REPLACE FUNCTION m14_private.valid_document(p_type text, p_doc text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  d text := upper(regexp_replace(coalesce(p_doc, ''), '[./\s-]', '', 'g'));
  n integer; total integer; digit integer; i integer; pass integer;
  weights integer[];
BEGIN
  IF p_type = 'cpf' THEN
    IF d !~ '^[0-9]{11}$' OR d = repeat(substr(d, 1, 1), 11) THEN RETURN false; END IF;
    FOR pass IN 1..2 LOOP
      n := 8 + pass; total := 0;
      FOR i IN 1..n LOOP total := total + substr(d, i, 1)::integer * (n + 2 - i); END LOOP;
      digit := (total * 10) % 11;
      IF digit = 10 THEN digit := 0; END IF;
      IF digit <> substr(d, n + 1, 1)::integer THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_type = 'cnpj' THEN
    IF d !~ '^[A-Z0-9]{12}[0-9]{2}$' OR d = repeat(substr(d, 1, 1), 14) THEN RETURN false; END IF;
    FOR pass IN 1..2 LOOP
      weights := CASE WHEN pass = 1 THEN ARRAY[5,4,3,2,9,8,7,6,5,4,3,2]
                      ELSE ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2] END;
      total := 0;
      FOR i IN 1..array_length(weights, 1) LOOP
        total := total + (ascii(substr(d, i, 1)) - 48) * weights[i];
      END LOOP;
      digit := CASE WHEN total % 11 < 2 THEN 0 ELSE 11 - total % 11 END;
      IF digit <> substr(d, 12 + pass, 1)::integer THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- Dados de entrada normalizados e validados no banco, independentemente do frontend.
CREATE OR REPLACE FUNCTION m14_private.crm_input(
  p_lead_id uuid, p_name text, p_document_type text, p_document_number text,
  p_title text, p_address jsonb, p_opposing_name text,
  p_opposing_document_type text, p_opposing_document_number text
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  d text := upper(regexp_replace(coalesce(p_document_number, ''), '[./\s-]', '', 'g'));
  od text := upper(regexp_replace(coalesce(p_opposing_document_number, ''), '[./\s-]', '', 'g'));
BEGIN
  IF p_lead_id IS NULL OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 160
    OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 2 AND 240 THEN
    RAISE EXCEPTION 'Nome e título do caso são obrigatórios e devem respeitar os limites.' USING ERRCODE = '22023';
  END IF;
  IF NOT m14_private.valid_document(p_document_type, d) THEN
    RAISE EXCEPTION 'CPF/CNPJ do cliente inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' OR octet_length(p_address::text) > 4000 THEN
    RAISE EXCEPTION 'Endereço inválido.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(coalesce(p_opposing_name, ''))) > 160
    OR (btrim(coalesce(p_opposing_name, '')) <> '' AND char_length(btrim(p_opposing_name)) < 2)
    OR (od <> '' AND (btrim(coalesce(p_opposing_name, '')) = '' OR NOT m14_private.valid_document(p_opposing_document_type, od))) THEN
    RAISE EXCEPTION 'Nome/documento da parte adversa inválido.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('lead_id', p_lead_id, 'name', btrim(p_name),
    'document_type', p_document_type, 'document_number', d, 'title', btrim(p_title),
    'address', p_address, 'opposing_name', nullif(btrim(p_opposing_name), ''),
    'opposing_document_type', CASE WHEN od <> '' THEN p_opposing_document_type END,
    'opposing_document_number', nullif(od, ''));
END;
$$;

CREATE OR REPLACE FUNCTION m14_private.crm_conflicts(p_input jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.case_id, h.full_name, h.party_role), '[]'::jsonb)
  FROM (
    SELECT DISTINCT cp.case_id, cp.full_name, cp.party_role,
      CASE WHEN cp.document_number IN (p_input->>'document_number', p_input->>'opposing_document_number')
        THEN 'documento' ELSE 'nome' END AS match_by
    FROM public.case_parties cp
    WHERE (
      ((cp.document_type = p_input->>'document_type' AND cp.document_number = p_input->>'document_number')
        OR m14_private.normalized_name(cp.full_name) = m14_private.normalized_name(p_input->>'name')
        OR EXISTS(SELECT 1 FROM public.clients c WHERE c.document_type = p_input->>'document_type'
          AND c.document_number = p_input->>'document_number'
          AND m14_private.normalized_name(cp.full_name) = m14_private.normalized_name(c.full_name)))
      -- Reutilizar o mesmo cliente documentado não é, por si só, um conflito.
      AND NOT coalesce((cp.party_role = 'cliente' AND cp.document_type = p_input->>'document_type'
        AND cp.document_number = p_input->>'document_number'), false)
    ) OR (
      p_input->>'opposing_name' IS NOT NULL AND (
        (cp.document_type = p_input->>'opposing_document_type' AND cp.document_number = p_input->>'opposing_document_number')
        OR m14_private.normalized_name(cp.full_name) = m14_private.normalized_name(p_input->>'opposing_name')
      )
    )
  ) h;
$$;

-- Único ponto privilegiado: precisa atualizar whatsapp_messages, cuja escrita é
-- proibida ao browser na Fase 1. Autorização explícita, search_path vazio e ACL restrita.
CREATE OR REPLACE FUNCTION m14_private.crm_action(p_input jsonb, p_convert boolean, p_review_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.leads_intake%ROWTYPE; c public.clients%ROWTYPE; k public.cases%ROWTYPE;
  hits jsonb; token text;
BEGIN
  IF p_convert IS NULL THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL OR NOT m14_private.is_office_member() THEN
    RAISE EXCEPTION 'Acesso restrito a membros ativos.' USING ERRCODE = '42501';
  END IF;
  -- Serializa conversões entre leads diferentes; evita corrida de conflito/reutilização.
  PERFORM pg_advisory_xact_lock(14003, 1);
  SELECT * INTO l FROM public.leads_intake WHERE id = (p_input->>'lead_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO k FROM public.cases WHERE source_lead_id = l.id;
  IF FOUND THEN
    IF NOT p_convert THEN RAISE EXCEPTION 'Lead já convertido.'; END IF;
    RETURN jsonb_build_object('client_id', k.client_id, 'case_id', k.id, 'already_converted', true);
  END IF;
  IF l.converted_client_id IS NOT NULL THEN RAISE EXCEPTION 'Vínculo do lead inconsistente. Solicite revisão.'; END IF;
  IF l.stage = 'arquivado' THEN RAISE EXCEPTION 'Reabra o lead antes de converter.'; END IF;
  -- Revalidar dentro da operação privilegiada.
  p_input := m14_private.crm_input((p_input->>'lead_id')::uuid, p_input->>'name',
    p_input->>'document_type', p_input->>'document_number', p_input->>'title', p_input->'address',
    p_input->>'opposing_name', p_input->>'opposing_document_type', p_input->>'opposing_document_number');
  -- Congela partes durante a checagem/conversão, inclusive contra DML administrativo.
  LOCK TABLE public.case_parties IN SHARE ROW EXCLUSIVE MODE;
  hits := m14_private.crm_conflicts(p_input);
  token := md5(p_input::text || hits::text);
  IF NOT p_convert THEN RETURN jsonb_build_object('token', token, 'conflicts', hits); END IF;
  IF p_review_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'Refaça a checagem de conflitos: os dados mudaram.'; END IF;
  IF jsonb_array_length(hits) > 0 THEN RAISE EXCEPTION 'Possível conflito de interesses. Conversão bloqueada para análise jurídica.'; END IF;
  IF p_input->>'opposing_name' IS NOT NULL AND (
    m14_private.normalized_name(p_input->>'name') = m14_private.normalized_name(p_input->>'opposing_name')
    OR p_input->>'document_number' = p_input->>'opposing_document_number') THEN
    RAISE EXCEPTION 'Cliente e parte adversa coincidem. Revise os dados.';
  END IF;
  INSERT INTO public.clients(full_name, document_type, document_number, phone, email, address_json)
    VALUES (p_input->>'name', p_input->>'document_type', p_input->>'document_number', l.phone, l.email, p_input->'address')
    ON CONFLICT (document_type, document_number) DO NOTHING;
  SELECT * INTO STRICT c FROM public.clients WHERE document_type = p_input->>'document_type'
    AND document_number = p_input->>'document_number' FOR UPDATE;
  INSERT INTO public.cases(client_id, source_lead_id, title, practice_area, opposing_party)
    VALUES(c.id, l.id, p_input->>'title', l.practice_area, p_input->>'opposing_name') RETURNING * INTO k;
  INSERT INTO public.case_parties(case_id, full_name, party_role, document_type, document_number)
    VALUES(k.id, c.full_name, 'cliente', c.document_type, c.document_number);
  IF p_input->>'opposing_name' IS NOT NULL THEN
    INSERT INTO public.case_parties(case_id, full_name, party_role, document_type, document_number)
      VALUES(k.id, p_input->>'opposing_name', 'adversa', p_input->>'opposing_document_type', p_input->>'opposing_document_number');
  END IF;
  -- Divergência nunca deve reassociar silenciosamente uma mensagem de outro cliente.
  IF EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE lead_id = l.id AND client_id IS NOT NULL AND client_id <> c.id) THEN
    RAISE EXCEPTION 'Mensagem já vinculada a outro cliente. Solicite revisão.';
  END IF;
  UPDATE public.whatsapp_messages SET client_id = c.id WHERE lead_id = l.id AND client_id IS NULL;
  UPDATE public.leads_intake SET stage = 'fechado', converted_client_id = c.id WHERE id = l.id;
  RETURN jsonb_build_object('client_id', c.id, 'case_id', k.id, 'already_converted', false);
END;
$$;

-- API pública invoker; não aceita tabela, SQL ou identidade do ator como parâmetros.
CREATE OR REPLACE FUNCTION public.review_lead_conversion(
  p_lead_id uuid, p_name text, p_document_type text, p_document_number text, p_title text,
  p_address jsonb DEFAULT '{}', p_opposing_name text DEFAULT '',
  p_opposing_document_type text DEFAULT 'cpf', p_opposing_document_number text DEFAULT ''
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT m14_private.crm_action(m14_private.crm_input(p_lead_id, p_name, p_document_type,
    p_document_number, p_title, p_address, p_opposing_name, p_opposing_document_type,
    p_opposing_document_number), false, NULL);
$$;
CREATE OR REPLACE FUNCTION public.convert_lead(
  p_lead_id uuid, p_name text, p_document_type text, p_document_number text, p_title text,
  p_address jsonb DEFAULT '{}', p_opposing_name text DEFAULT '',
  p_opposing_document_type text DEFAULT 'cpf', p_opposing_document_number text DEFAULT '',
  p_review_token text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT m14_private.crm_action(m14_private.crm_input(p_lead_id, p_name, p_document_type,
    p_document_number, p_title, p_address, p_opposing_name, p_opposing_document_type,
    p_opposing_document_number), true, p_review_token);
$$;

-- Fechamento/vínculo/cadastro de casos apenas pela RPC: evita contornar a checagem.
REVOKE INSERT, UPDATE ON public.clients, public.cases, public.case_parties FROM authenticated;
REVOKE INSERT, UPDATE ON public.leads_intake FROM authenticated;
GRANT UPDATE(stage) ON public.leads_intake TO authenticated;
CREATE OR REPLACE FUNCTION m14_private.guard_lead_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage AND
    (OLD.converted_client_id IS NOT NULL OR (NEW.stage = 'fechado' AND NEW.converted_client_id IS NULL)) THEN
    RAISE EXCEPTION 'Lead convertido não pode mudar de etapa; fechamento exige conversão.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS m14_stage_guard ON public.leads_intake;
CREATE TRIGGER m14_stage_guard BEFORE UPDATE ON public.leads_intake
  FOR EACH ROW EXECUTE FUNCTION m14_private.guard_lead_stage();

REVOKE ALL ON FUNCTION m14_private.normalized_name(text), m14_private.valid_document(text,text),
  m14_private.crm_input(uuid,text,text,text,text,jsonb,text,text,text),
  m14_private.crm_conflicts(jsonb), m14_private.crm_action(jsonb,boolean,text),
  m14_private.guard_lead_stage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION m14_private.crm_input(uuid,text,text,text,text,jsonb,text,text,text),
  m14_private.crm_action(jsonb,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.review_lead_conversion(uuid,text,text,text,text,jsonb,text,text,text),
  public.convert_lead(uuid,text,text,text,text,jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_lead_conversion(uuid,text,text,text,text,jsonb,text,text,text),
  public.convert_lead(uuid,text,text,text,text,jsonb,text,text,text,text) TO authenticated;
-- crm_input (invoker) chama valid_document; ambas são puras e não leem dados.
GRANT EXECUTE ON FUNCTION m14_private.valid_document(text,text) TO authenticated;
COMMIT;
