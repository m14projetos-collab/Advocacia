import { HttpError } from "./office.ts";
export function validCnj(input: string) {
  const value = input.replace(/\D/g, "");
  if (!/^\d{20}$/.test(value))
    throw new HttpError(400, "CNJ deve ter 20 dígitos.");
  const base = value.slice(0, 7) + value.slice(9) + "00";
  let rest = 0;
  for (const digit of base) rest = (rest * 10 + Number(digit)) % 97;
  if (Number(value.slice(7, 9)) !== 98 - rest)
    throw new HttpError(400, "Dígitos verificadores do CNJ inválidos.");
  return value;
}
export function tribunal(cnj: string) {
  const segment = Number(cnj[13]),
    number = Number(cnj.slice(14, 16));
  if (segment === 8) {
    const states = [
      "ac",
      "al",
      "ap",
      "am",
      "ba",
      "ce",
      "dft",
      "es",
      "go",
      "ma",
      "mt",
      "ms",
      "mg",
      "pa",
      "pb",
      "pr",
      "pe",
      "pi",
      "rj",
      "rn",
      "rs",
      "ro",
      "rr",
      "sc",
      "se",
      "sp",
      "to",
    ];
    if (number >= 1 && number <= 27) return "tj" + states[number - 1];
  }
  if (segment === 4 && number >= 1 && number <= 6) return "trf" + number;
  if (segment === 5 && number >= 1 && number <= 24) return "trt" + number;
  if (segment === 3 && number === 0) return "stj";
  throw new HttpError(
    400,
    "Tribunal sem endpoint suportado nesta integração. Consulte o portal oficial e anexe os documentos privados.",
  );
}
