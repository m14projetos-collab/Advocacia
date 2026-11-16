import { PRACTICE_AREAS, PracticeAreaKey } from '../data/office';
import { Check, ArrowRight } from 'lucide-react';

interface PracticeAreasProps {
  onSelectArea: (area: PracticeAreaKey) => void;
}

export function PracticeAreas({ onSelectArea }: PracticeAreasProps) {
  return (
    <section id="atuacao" className="bg-ivory py-20 text-obsidian">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-bronze">
            Áreas de Atuação
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
            Atendimento especializado e estruturado por demanda
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Cada caso recebe análise individualizada, linguagem acessível e estratégia jurídica
            adequada à urgência da situação.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PRACTICE_AREAS.map((area) => (
            <article
              key={area.id}
              className="flex flex-col justify-between rounded-sm border border-slate-200 bg-white p-7 transition hover:border-bronze/60"
            >
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-bronze">
                  {area.subtitle}
                </span>
                <h3 className="mt-2 font-serif text-2xl font-semibold text-obsidian">
                  {area.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{area.description}</p>

                <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5">
                  {area.topics.map((topic) => (
                    <li key={topic} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-bronze" strokeWidth={1.75} />
                      <span>{topic}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-4">
                <a
                  href="#triagem"
                  onClick={() => onSelectArea(area.id)}
                  className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-obsidian transition hover:text-bronze"
                >
                  Solicitar análise nesta área
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
