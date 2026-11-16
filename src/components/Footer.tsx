import { OFFICE_DATA } from '../data/office';

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-obsidian py-10 text-xs text-slate-400">
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6">
        <div>
          <p className="font-semibold text-ivory">{OFFICE_DATA.firmName}</p>
          <p className="mt-1 font-mono tabular-nums">
            {OFFICE_DATA.legalEntity} · CNPJ {OFFICE_DATA.cnpj}
            {OFFICE_DATA.oabNumber ? ` · OAB/SP ${OFFICE_DATA.oabNumber}` : ''}
          </p>
        </div>
        <p className="text-slate-500">
          Conteúdo meramente informativo (Provimento OAB nº 205/2021).
        </p>
      </div>
    </footer>
  );
}
