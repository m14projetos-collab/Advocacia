export const OFFICE_ZONE = "America/Sao_Paulo";
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: OFFICE_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function officeInput(iso: string) {
  const values = Object.fromEntries(
    parts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
export function officeDate(iso = new Date().toISOString()) {
  return officeInput(iso).slice(0, 10);
}
export function fromOfficeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Data/hora inválida.");
  const target = Date.parse(`${value}:00Z`);
  if (
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 16) !== value
  )
    throw new Error("Data/hora inválida.");
  let candidate = target;
  for (let i = 0; i < 3; i++)
    candidate +=
      target -
      Date.parse(`${officeInput(new Date(candidate).toISOString())}:00Z`);
  if (officeInput(new Date(candidate).toISOString()) !== value)
    throw new Error("Horário inexistente no fuso de São Paulo.");
  return new Date(candidate).toISOString();
}
export function monthBounds(month: string) {
  const [year, number] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  return {
    start: fromOfficeInput(`${month}-01T00:00`),
    end: fromOfficeInput(`${next}-01T00:00`),
  };
}
export function monthDays(month: string) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1, 1));
  const offset = (date.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [
    ...Array(offset).fill(null),
    ...Array.from(
      { length: count },
      (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  ] as (string | null)[];
}
export function dayBounds(day: string) {
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: fromOfficeInput(`${day}T00:00`),
    end: fromOfficeInput(`${next.toISOString().slice(0, 10)}T00:00`),
  };
}
