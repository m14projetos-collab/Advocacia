import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const PRACTICE_AREAS = new Set([
  'familia_sucessoes',
  'medico_saude',
  'criminal',
  'contratos',
  'outros',
]);
const URGENCIES = new Set(['normal', 'alta', 'urgente']);

function getAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const raw = Deno.env.get('APP_ORIGIN') ?? Deno.env.get('ALLOWED_ORIGINS') ?? '';
  const list = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function normalizeBrazilPhoneToE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  if (/^[1-9][0-9]{7,14}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // Permite testes controlados se a chave ainda não estiver configurada
  if (!token) return false;

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) return false;
  const json = await res.json();
  return Boolean(json.success);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const allowedOrigin = getAllowedOrigin(origin);
  const headers = corsHeaders(allowedOrigin);

  if (req.method === 'OPTIONS') {
    if (!allowedOrigin) return new Response('Forbidden', { status: 403 });
    return new Response('ok', { headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (origin && !allowedOrigin) {
    return new Response(JSON.stringify({ error: 'Origem não autorizada.' }), {
      status: 403,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (Deno.env.get('INTAKE_ENABLED') !== 'true') {
    return new Response(JSON.stringify({ error: 'Atendimento via portal temporariamente indisponível.' }), {
      status: 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const rawPhone = typeof body?.phone === 'string' ? body.phone : '';
    const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null;
    const practiceArea = typeof body?.practice_area === 'string' ? body.practice_area : '';
    const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
    const urgency = typeof body?.urgency === 'string' ? body.urgency : 'normal';
    const consentAccepted = body?.lgpd_consent === true;
    const turnstileToken = typeof body?.turnstile_token === 'string' ? body.turnstile_token : '';

    const e164Phone = normalizeBrazilPhoneToE164(rawPhone);

    if (name.length < 2 || name.length > 160) {
      return new Response(JSON.stringify({ error: 'Informe um nome válido.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!e164Phone || !/^\+[1-9][0-9]{7,14}$/.test(e164Phone)) {
      return new Response(JSON.stringify({ error: 'Informe um WhatsApp válido com DDD.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!PRACTICE_AREAS.has(practiceArea)) {
      return new Response(JSON.stringify({ error: 'Área jurídica inválida.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!URGENCIES.has(urgency)) {
      return new Response(JSON.stringify({ error: 'Nível de urgência inválido.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (summary.length < 10 || summary.length > 3000) {
      return new Response(JSON.stringify({ error: 'Descreva brevemente o caso (entre 10 e 3000 caracteres).' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (!consentAccepted) {
      return new Response(JSON.stringify({ error: 'É necessário concordar com o tratamento de dados (LGPD).' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const remoteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const turnstileOk = await verifyTurnstile(turnstileToken, remoteIp);
    if (!turnstileOk) {
      return new Response(JSON.stringify({ error: 'Validação de segurança falhou. Tente novamente.' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const hashSecret = Deno.env.get('INTAKE_HASH_SECRET') ?? 'm14-default-salt';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const ipHash = await sha256Hex(`${remoteIp}:${hashSecret}`);
    const { data: allowedByRate, error: rateError } = await supabase
      .schema('m14_private')
      .rpc('check_intake_rate_limit', { p_ip_hash: ipHash, p_limit: 8 });

    if (rateError) {
      console.error('Rate limit error:', rateError);
    } else if (allowedByRate === false) {
      return new Response(JSON.stringify({ error: 'Muitas solicitações recentes. Tente novamente mais tarde.' }), {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await supabase.from('leads_intake').insert({
      name,
      phone: e164Phone,
      email,
      practice_area: practiceArea,
      summary,
      urgency,
      stage: 'novo',
      source: 'portal',
      consent_version: 'privacy-v1',
    });

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Não foi possível registrar seu atendimento agora.' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Requisição inválida.' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
});
