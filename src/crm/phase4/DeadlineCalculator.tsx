import { FormEvent, useState } from "react";
import { calculateDeadline } from "./deadlines";
import { officeDate } from "./time";
import { message } from "../types";
export function DeadlineCalculator({
  onUse,
}: {
  onUse: (date: string) => void;
}) {
  const [base, setBase] = useState(officeDate());
  const [days, setDays] = useState("15");
  const [mode, setMode] = useState<"start" | "dje">("start");
  const [excluded, setExcluded] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<
    typeof calculateDeadline
  > | null>(null);
  function reset() {
    setResult(null);
    setError("");
    setReviewed(false);
  }
  function calculate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    try {
      if (!reviewed)
        throw new Error("Confira o calendário do tribunal antes de calcular.");
      setResult(
        calculateDeadline(
          base,
          Number(days),
          excluded.split(/[\s,;]+/).filter(Boolean),
          mode,
        ),
      );
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <details className="crm-calculator">
      <summary>Calculadora auxiliar de prazos · CPC</summary>
      <p>
        Contagem processual em dias úteis (arts. 219, 220 e 224). Exclui o
        começo, inclui o vencimento e suspende a contagem de 20/12 a 20/01,
        inclusive.
      </p>
      <p className="crm-muted">
        Informe todos os feriados, suspensões extraordinárias e dias sem
        expediente aplicáveis. O calendário do tribunal não é consultado
        automaticamente. A definição do termo inicial e o resultado exigem
        conferência jurídica.
      </p>
      <form className="crm-stack" onSubmit={calculate} onChange={reset}>
        <label>
          Referência da data
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "start" | "dje")}
          >
            <option value="start">
              Dia do começo / publicação já definida
            </option>
            <option value="dje">
              Disponibilização no DJE (calcular publicação)
            </option>
          </select>
        </label>
        <div className="crm-grid-2">
          <label>
            Data de referência
            <input
              type="date"
              required
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
          <label>
            Dias úteis
            <input
              type="number"
              min={1}
              max={365}
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        </div>
        <label>
          Feriados e exclusões (AAAA-MM-DD, um por linha)
          <textarea
            rows={3}
            value={excluded}
            onChange={(e) => setExcluded(e.target.value)}
          />
        </label>
        <label className="crm-inline-check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => {
              e.stopPropagation();
              setReviewed(e.target.checked);
              setResult(null);
            }}
          />
          Conferi o termo inicial e o calendário aplicável ao processo.
        </label>
        <button>Calcular vencimento</button>
      </form>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {result && (
        <div className="crm-result" role="status">
          <p>
            Começo / publicação:{" "}
            {result.effectiveStart.split("-").reverse().join("/")}
          </p>
          <h3>
            Vencimento auxiliar: {result.dueDate.split("-").reverse().join("/")}
          </h3>
          <button type="button" onClick={() => onUse(result.dueDate)}>
            Usar data em novo prazo
          </button>
          <details>
            <summary>Memória de cálculo</summary>
            <ol>
              {result.trace.map((day) => (
                <li key={day.date}>
                  {day.date.split("-").reverse().join("/")} · {day.reason}
                  {day.counted ? " · contado" : ""}
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </details>
  );
}
