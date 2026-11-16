import { Award, Briefcase, Globe } from 'lucide-react';
import { OFFICE_DATA } from '../data/office';

export function AboutLawyer() {
  return (
    <section id="escritorio" className="border-y border-slate-200 bg-white py-20">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <div className="rounded-sm border border-slate-200 bg-obsidian p-8 text-ivory">
            <img
              src={OFFICE_DATA.logoUrl}
              alt="Monograma MM — Matheus Moraes Advocacia"
              className="h-14 w-auto object-contain"
            />
            <h3 className="mt-6 font-serif text-2xl font-semibold">
              {OFFICE_DATA.legalEntity}
            </h3>
            <p className="mt-2 font-mono text-xs tabular-nums text-slate-400">
              CNPJ {OFFICE_DATA.cnpj}
              {OFFICE_DATA.oabNumber ? ` · OAB/SP ${OFFICE_DATA.oabNumber}` : ''}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              {OFFICE_DATA.address}
            </p>
          </div>
        </div>

        <div className="lg:col-span-7">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-bronze">
            Sobre o Escritório
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold text-obsidian sm:text-4xl">
            Experiência prática em causas de alta sensibilidade
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Matheus Moraes é advogado, sócio-fundador do escritório Matheus Moraes Advogados,
            situado em Santos/SP. É membro efetivo da Comissão de Concursos Públicos da OAB
            Subseção Santos e possui formações complementares em Direito Público Aplicado,
            Direito dos Contratos e Prática Criminal.
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <div className="rounded-sm border border-slate-200 p-4">
              <Briefcase className="h-5 w-5 text-bronze" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-semibold text-obsidian">+7 anos de atuação</p>
              <p className="mt-1 text-xs text-slate-600">
                Sólida experiência em Direito de Família e Sucessões.
              </p>
            </div>
            <div className="rounded-sm border border-slate-200 p-4">
              <Globe className="h-5 w-5 text-bronze" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-semibold text-obsidian">Atendimento Nacional</p>
              <p className="mt-1 text-xs text-slate-600">
                Clientes atendidos em SP, RJ, PR, AM, MG e outros estados.
              </p>
            </div>
            <div className="rounded-sm border border-slate-200 p-4">
              <Award className="h-5 w-5 text-bronze" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-semibold text-obsidian">Comunicação Clara</p>
              <p className="mt-1 text-xs text-slate-600">
                Orientação jurídica sem juridiquês e com transparência.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
