import { Scale, ArrowUpRight } from 'lucide-react';
import { OFFICE_DATA } from '../data/office';

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-obsidian/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <a href="#topo" className="flex items-center gap-3 text-ivory">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-bronze/60 bg-slatecard">
            <Scale className="h-5 w-5 text-bronzeLight" strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-serif text-lg font-semibold tracking-wide text-ivory">
              {OFFICE_DATA.name}
            </p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
              Advocacia e Assessoria Jurídica
            </p>
          </div>
        </a>

        <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
          <a href="#atuacao" className="transition hover:text-bronzeLight">
            Áreas de Atuação
          </a>
          <a href="#escritorio" className="transition hover:text-bronzeLight">
            O Advogado
          </a>
          <a href="#triagem" className="transition hover:text-bronzeLight">
            Solicitar Atendimento
          </a>
        </nav>

        <a
          href="#triagem"
          className="inline-flex items-center gap-2 rounded-sm border border-bronze bg-bronze/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-bronzeLight transition hover:bg-bronze hover:text-obsidian"
        >
          Agendar Análise
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
        </a>
      </div>
    </header>
  );
}
