import { useState, useEffect, FormEvent } from 'react';
import { CheckCircle2, AlertCircle, Lock, ArrowRight, ArrowLeft } from 'lucide-react';
import { PRACTICE_AREAS, PracticeAreaKey, OFFICE_DATA } from '../data/office';
import { TurnstileWidget } from './TurnstileWidget';
import { formatBrazilPhoneDisplay, normalizePhoneToE164 } from '../lib/phone';

interface IntakeFormProps {
  selectedArea: PracticeAreaKey;
}

export function IntakeForm({ selectedArea }: IntakeFormProps) {
  const intakeEnabled = import.meta.env.VITE_INTAKE_ENABLED === 'true';
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
  const [turnstileToken, setTurnstileToken] = useState('');
  const [widgetAttempt, setWidgetAttempt] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [practiceArea, setPracticeArea] = useState<PracticeAreaKey>(selectedArea);
  const [urgency, setUrgency] = useState<'normal' | 'alta' | 'urgente'>('normal');
  const [summary, setSummary] = useState('');
  const [lgpdConsent, setLgpdConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setPracticeArea(selectedArea);
  }, [selectedArea]);

  function handleNextStep() {
    setErrorMsg(null);
    if (name.trim().length < 2) {
      setErrorMsg('Por favor, informe seu nome completo.');
      return;
    }
    const e164 = normalizePhoneToE164(phone);
    if (!e164) {
      setErrorMsg('Informe um número de WhatsApp válido com DDD (ex: (13) 99676-4688).');
      return;
    }
    setStep(2);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (submitting) return;
    if (!intakeEnabled || !siteKey || !turnstileToken) {
      setErrorMsg('Conclua a verificação de segurança antes de enviar ou utilize o WhatsApp.');
      return;
    }

    const e164Phone = normalizePhoneToE164(phone);
    if (!e164Phone) {
      setErrorMsg('Número de WhatsApp inválido.');
      return;
    }
    if (summary.trim().length < 10) {
      setErrorMsg('Descreva brevemente sua situação (mínimo de 10 caracteres).');
      return;
    }
    if (!lgpdConsent) {
      setErrorMsg('Marque o consentimento LGPD para enviar sua solicitação.');
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) {
      setErrorMsg('Configuração do portal incompleta. Utilize o WhatsApp direto ao lado.');
      return;
    }

    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/leads-intake`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: e164Phone,
          email: email.trim() || null,
          practice_area: practiceArea,
          urgency,
          summary: summary.trim(),
          lgpd_consent: true,
          turnstile_token: turnstileToken,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMsg(data.error || 'Não foi possível enviar sua solicitação.');
        return;
      }

      setSubmitted(true);
    } catch {
      setErrorMsg('Falha de conexão ao enviar. Tente novamente ou chame no WhatsApp.');
    } finally {
      clearTimeout(timeout);
      setTurnstileToken('');
      setWidgetAttempt(value => value + 1);
      setSubmitting(false);
    }
  }

  return (
    <section id="triagem" className="bg-obsidian py-20 text-ivory">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-bronzeLight">
            Atendimento Inicial
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold sm:text-4xl">
            Solicite uma análise inicial do seu caso
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Preencha os dois passos ao lado para que o escritório organize as informações
            essenciais antes da sua reunião presencial ou por videoconferência.
          </p>

          <div className="mt-8 space-y-4 border-t border-white/10 pt-6 text-sm text-slate-300">
            <p>
              <strong className="text-ivory">WhatsApp:</strong>{' '}
              <span className="font-mono tabular-nums">{OFFICE_DATA.phoneDisplay}</span>
            </p>
            <p>
              <strong className="text-ivory">E-mail:</strong> {OFFICE_DATA.email}
            </p>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5 text-bronzeLight" strokeWidth={1.5} />
              Seus dados são protegidos pelo sigilo profissional e pela LGPD.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-sm border border-white/15 bg-slatecard p-6 sm:p-8">
            {!intakeEnabled || !siteKey ? (
              <div className="space-y-4 py-8">
                <h3 className="font-serif text-2xl text-ivory">Atendimento pelo WhatsApp</h3>
                <p className="text-sm text-slate-300">O formulário está temporariamente indisponível. Entre em contato com o escritório para organizar seu atendimento.</p>
                <a className="inline-block border border-bronzeLight px-5 py-3 text-sm text-ivory" href={`https://wa.me/${OFFICE_DATA.whatsappE164}`}>Falar com o escritório no WhatsApp</a>
              </div>
            ) : submitted ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" strokeWidth={1.5} />
                <h3 className="mt-4 font-serif text-2xl font-semibold text-ivory">
                  Solicitação registrada com sucesso
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
                  Recebemos seus dados iniciais com segurança. Nossa equipe entrará em contato
                  pelo WhatsApp informado para confirmar os próximos passos.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="font-mono text-xs uppercase tracking-wider text-bronzeLight">
                    Passo {step} de 2
                  </span>
                  <span className="text-xs text-slate-400">
                    {step === 1 ? 'Identificação e Área' : 'Resumo do Caso'}
                  </span>
                </div>

                {errorMsg && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-sm border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {step === 1 ? (
                  <>
                    <div>
                      <label htmlFor="intake-name" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Nome completo *
                      </label>
                      <input
                        id="intake-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Maria da Silva"
                        className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 text-sm text-ivory placeholder-slate-500 focus:border-bronzeLight focus:outline-none"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="intake-phone" className="mb-1.5 block text-xs font-medium text-slate-300">
                          WhatsApp com DDD *
                        </label>
                        <input
                          id="intake-phone"
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(formatBrazilPhoneDisplay(e.target.value))}
                          placeholder="(13) 99999-9999"
                          className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 font-mono text-sm tabular-nums text-ivory placeholder-slate-500 focus:border-bronzeLight focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="intake-email" className="mb-1.5 block text-xs font-medium text-slate-300">
                          E-mail (opcional)
                        </label>
                        <input
                          id="intake-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="voce@email.com"
                          className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 text-sm text-ivory placeholder-slate-500 focus:border-bronzeLight focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="intake-area" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Área jurídica relacionada *
                      </label>
                      <select
                        id="intake-area"
                        value={practiceArea}
                        onChange={(e) => setPracticeArea(e.target.value as PracticeAreaKey)}
                        className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 text-sm text-ivory focus:border-bronzeLight focus:outline-none"
                      >
                        {PRACTICE_AREAS.map((area) => (
                          <option key={area.id} value={area.id}>
                            {area.title}
                          </option>
                        ))}
                        <option value="outros">Outro assunto jurídico</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-bronze px-5 py-3 text-sm font-semibold text-obsidian transition hover:bg-bronzeLight"
                    >
                      Continuar para o resumo
                      <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <label htmlFor="intake-urgency" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Nível de urgência
                      </label>
                      <select
                        id="intake-urgency"
                        value={urgency}
                        onChange={(e) => setUrgency(e.target.value as 'normal' | 'alta' | 'urgente')}
                        className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 text-sm text-ivory focus:border-bronzeLight focus:outline-none"
                      >
                        <option value="normal">Normal — Quero agendar uma conversa</option>
                        <option value="alta">Alta — Tenho prazo ou audiência próxima</option>
                        <option value="urgente">Urgente — Medida liminar / situação imediata</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="intake-summary" className="mb-1.5 block text-xs font-medium text-slate-300">
                        Resumo breve da situação *
                      </label>
                      <textarea
                        id="intake-summary"
                        rows={4}
                        required
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        placeholder="Conte brevemente o que está acontecendo e qual sua principal dúvida..."
                        className="w-full rounded-sm border border-white/15 bg-obsidian px-3.5 py-2.5 text-sm text-ivory placeholder-slate-500 focus:border-bronzeLight focus:outline-none"
                      />
                    </div>

                    <label className="flex items-start gap-2.5 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={lgpdConsent}
                        onChange={(e) => setLgpdConsent(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded-sm border-white/20 bg-obsidian text-bronze"
                      />
                      <span>
                        Concordo com o envio destes dados para triagem de atendimento jurídico
                        pelo escritório Matheus Moraes Advocacia, conforme a LGPD.
                      </span>
                    </label>

                    <TurnstileWidget key={widgetAttempt} siteKey={siteKey} onToken={setTurnstileToken} />

                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setStep(1)}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-white/20 px-4 py-3 text-sm text-slate-300 transition hover:border-white/40"
                      >
                        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
                        Voltar
                      </button>
                      <button
                        type="submit"
                        disabled={submitting || !turnstileToken}
                        className="inline-flex flex-1 items-center justify-center rounded-sm bg-bronze px-5 py-3 text-sm font-semibold text-obsidian transition hover:bg-bronzeLight disabled:opacity-60"
                      >
                        {submitting ? 'Enviando...' : 'Enviar Solicitação'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
