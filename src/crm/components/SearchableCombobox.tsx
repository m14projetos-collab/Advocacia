import { useEffect, useId, useRef, useState } from "react";
export interface SearchOption {
  value: string;
  label: string;
  keywords?: string;
  description?: string;
  active?: boolean;
  recent?: string;
}
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export function matchesOption(option: SearchOption, query: string) {
  const hay = normalized(
      `${option.label} ${option.keywords ?? ""} ${option.description ?? ""}`,
    ),
    q = normalized(query.trim());
  return (
    hay.includes(q) ||
    (Boolean(q.replace(/[^a-z0-9]/g, "")) &&
      hay.replace(/[^a-z0-9]/g, "").includes(q.replace(/[^a-z0-9]/g, "")))
  );
}
export function SearchableCombobox({
  label,
  value,
  options,
  onChange,
  emptyLabel = "Sem vínculo",
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const sorted = [...options].sort(
    (a, b) =>
      Number(b.active !== false) - Number(a.active !== false) ||
      (b.recent ?? "").localeCompare(a.recent ?? ""),
  );
  const all = [
    ...(!required ? [{ value: "", label: emptyLabel }] : []),
    ...sorted,
  ].filter((option) => matchesOption(option, query));
  const shown = all.slice(0, 40),
    selected = options.find((o) => o.value === value);
  useEffect(() => {
    const listener = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", listener);
    return () => document.removeEventListener("pointerdown", listener);
  }, []);
  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? "Selecione um registro da lista." : "",
    );
  }, [value, required]);
  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
    setIndex(0);
    input.current?.focus();
  }
  return (
    <div
      className="crm-combobox"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="crm-combobox-control">
        <input
          ref={input}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && shown[index] ? `${id}-option-${index}` : undefined
          }
          disabled={disabled}
          value={open ? query : (selected?.label ?? "")}
          placeholder={selected?.label ?? emptyLabel}
          onClick={() => {
            setOpen(true);
            setIndex(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setIndex((i) =>
                !open
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        shown.length - 1,
                        i + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
              );
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (shown[index]) choose(shown[index].value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              setQuery("");
            }
          }}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={`Mostrar opções de ${label}`}
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
            setIndex(0);
            input.current?.focus();
          }}
        >
          ⌄
        </button>
      </div>
      {open && (
        <div className="crm-combobox-popup">
          <ul id={`${id}-list`} role="listbox" aria-label={label}>
            {shown.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={i === index ? "is-highlighted" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(o.value)}
              >
                <span>{o.label}</span>
                {o.description && <small>{o.description}</small>}
              </li>
            ))}
            {shown.length === 0 && (
              <li role="presentation">Nenhum registro encontrado.</li>
            )}
          </ul>
          <small>
            {all.length > 40
              ? "Exibindo 40 resultados. Digite para refinar."
              : `${all.length} opções · ↑ ↓ e Enter para selecionar`}
          </small>
        </div>
      )}
    </div>
  );
}
