import { ShieldCheck, MapPin, Clock, ArrowRight } from 'lucide-react';
import { OFFICE_DATA } from '../data/office';

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden bg-obsidian text-ivory">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:items-center lg:py-24">
        <div className="lg:col-span-7">
          <div className="mb-6 inline-flex items-center gap-2 rounded-sm border border-bronze/40 bg-slatecard px-3 py-1.5 text-xs tracking-wide text-bronzeLight">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            <span>
              Santos/SP e atendimento online em todo o Brasil
              {OFFICE_DATA.oabNumber ? ` · OAB/SP ${OFFICE_DATA.oabNumber}` : ''}
            </span>
          </div>

          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ivory sm:text-5xl lg:text-6xl">
            Atuação jurídica técnica, clara e humana em momentos decisivos.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Mais de 7 anos de experiência prática em <strong className="text-ivory">Direito de Família e Sucessões</strong>,{' '}
            <strong className="text-ivory">Direito Médico e da Saúde</strong>,{' '}
            <strong className="text-ivory">Prática Criminal</strong> e <strong className="text-ivory">Contratos</strong>.
            Atendimento presencial na Baixada Santista e digital para diversos estados.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#triagem"
              className="inline-flex items-center gap-2 rounded-sm bg-bronze px-6 py-3.5 text-sm font-semibold text-obsidian transition hover:bg-bronzeLight"
            >
              Iniciar Triagem de Atendimento
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </a>
            <a
              href={`https://wa.me/${OFFICE_DATA.whatsappE164}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-sm border border-white/20 px-6 py-3.5 text-sm font-medium text-ivory transition hover:border-bronzeLight hover:text-bronzeLight"
            >
              Falar pelo WhatsApp
            </a>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 border-t border-white/10 pt-8 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-bronzeLight" strokeWidth={1.5} />
              <div className="text-xs text-slate-300">
                <p className="font-semibold text-ivory">Santos — Vila Rica</p>
                <p>Helbor Offices · Conselheiro Nébias</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-bronzeLight" strokeWidth={1.5} />
              <div className="text-xs text-slate-300">
                <p className="font-semibold text-ivory">Disponibilidade Estendida</p>
                <p>Acolhimento ágil em casos urgentes</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-bronzeLight" strokeWidth={1.5} />
              <div className="text-xs text-slate-300">
                <p className="font-semibold text-ivory">Sigilo & LGPD</p>
                <p>Atendimento direto e confidencial</p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="relative mx-auto max-w-sm overflow-hidden rounded-sm border border-bronze/40 bg-slatecard p-2">
            <img
              src={OFFICE_DATA.profilePhoto}
              alt="Matheus Moraes — Advogado"
              className="aspect-[3/4] w-full rounded-sm object-cover object-top"
            />
            <div className="border-t border-white/10 bg-obsidian/90 px-4 py-3">
              <p className="font-serif text-lg font-semibold text-ivory">{OFFICE_DATA.name}</p>
              <p className="text-xs text-slate-400">
                Sócio-fundador · Comissão de Concursos Públicos OAB Santos
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
