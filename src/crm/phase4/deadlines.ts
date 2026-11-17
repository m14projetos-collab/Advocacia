export interface DeadlineDay {
  date: string;
  counted: boolean;
  reason: string;
}
function parse(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use datas no formato AAAA-MM-DD.");
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(`Data inválida: ${value}.`);
  return date;
}
const key = (date: Date) => date.toISOString().slice(0, 10);
function next(date: Date) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + 1);
  return value;
}
export function calculateDeadline(
  base: string,
  days: number,
  excluded: string[] = [],
  mode: "start" | "dje" = "start",
) {
  let current = parse(base);
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("Informe de 1 a 365 dias úteis.");
  const dates = new Set(excluded.map((value) => key(parse(value))));
  const closed = (date: Date) =>
    date.getUTCDay() === 0 || date.getUTCDay() === 6 || dates.has(key(date));
  const suspension = (date: Date) =>
    (date.getUTCMonth() === 11 && date.getUTCDate() >= 20) ||
    (date.getUTCMonth() === 0 && date.getUTCDate() <= 20);
  let attempts = 0;
  // DJE: publicação no primeiro dia útil após disponibilização (art. 224 §2).
  if (mode === "dje") current = next(current);
  while (closed(current)) {
    current = next(current);
    if (++attempts > 5000)
      throw new Error("Calendário sem dias úteis disponíveis.");
  }
  const effectiveStart = key(current);
  const trace: DeadlineDay[] = [];
  let counted = 0;
  while (counted < days) {
    current = next(current);
    const date = key(current);
    const reason = suspension(current)
      ? "Suspensão CPC, art. 220"
      : dates.has(date)
        ? "Feriado / exclusão informada"
        : closed(current)
          ? "Fim de semana"
          : "Dia útil";
    const valid = !closed(current) && !suspension(current);
    if (valid) counted++;
    trace.push({ date, counted: valid, reason });
    if (trace.length > 5000)
      throw new Error("Contagem excede o limite do calendário.");
  }
  return { effectiveStart, dueDate: key(current), trace };
}
