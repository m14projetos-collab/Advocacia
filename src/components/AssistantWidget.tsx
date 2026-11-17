import { useState } from 'react';
import { MessageSquare, X, ArrowRight } from 'lucide-react';
import { PRACTICE_AREAS, PracticeAreaKey } from '../data/office';

interface AssistantWidgetProps {
  onSelectArea: (area: PracticeAreaKey) => void;
}

export function AssistantWidget({ onSelectArea }: AssistantWidgetProps) {
  const [open, setOpen] = useState(false);

  function handleChoose(area: PracticeAreaKey) {
    onSelectArea(area);
    setOpen(false);
    document.getElementById('triagem')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open ? (
        <div className="w-80 rounded-sm border border-bronze/50 bg-obsidian text-ivory shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-bronzeLight">
                Assistente de Triagem
              </p>
              <p className="text-[11px] text-slate-400">
                Orientação inicial sobre o atendimento
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
              className="text-slate-400 hover:text-ivory"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="space-y-3 p-4 text-xs text-slate-300">
            <p className="leading-relaxed">
              Olá! Posso direcionar seu atendimento para a área correta do escritório. Qual tema melhor descreve seu caso?
            </p>
            <div className="space-y-2">
              {PRACTICE_AREAS.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => handleChoose(area.id)}
                  className="flex w-full items-center justify-between rounded-sm border border-white/10 bg-slatecard px-3 py-2 text-left text-xs text-ivory transition hover:border-bronzeLight"
                >
                  <span>{area.title}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-bronzeLight" strokeWidth={1.5} />
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              Este canal realiza apenas triagem inicial e agendamento, em conformidade com o
              Provimento 205/2021 da OAB.
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-sm border border-bronze bg-obsidian px-4 py-3 text-xs font-semibold uppercase tracking-wider text-bronzeLight shadow-lg transition hover:bg-bronze hover:text-obsidian"
        >
          <MessageSquare className="h-4 w-4" strokeWidth={1.5} />
          Triagem Online
        </button>
      )}
    </div>
  );
}
