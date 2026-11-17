import { Case, Client, Lead } from "../types";
import { SearchOption } from "../components/SearchableCombobox";
export const clientOptions = (clients: Client[]): SearchOption[] =>
  clients.map((c) => ({
    value: c.id,
    label: c.full_name,
    keywords: `${c.document_number ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`,
    description: [c.document_number, c.phone].filter(Boolean).join(" · "),
    recent: c.created_at,
  }));
export const leadOptions = (leads: Lead[]): SearchOption[] =>
  leads.map((l) => ({
    value: l.id,
    label: l.name,
    keywords: `${l.phone} ${l.email ?? ""}`,
    description: l.stage,
    active: !["fechado", "arquivado"].includes(l.stage),
    recent: l.created_at,
  }));
export const caseOptions = (
  cases: Case[],
  clients: Client[] = [],
): SearchOption[] =>
  cases.map((k) => {
    const c = clients.find((c) => c.id === k.client_id);
    return {
      value: k.id,
      label: k.title,
      keywords: `${k.cnj_number ?? ""} ${c?.full_name ?? ""} ${c?.document_number ?? ""} ${c?.phone ?? ""}`,
      description: [c?.full_name, k.cnj_number].filter(Boolean).join(" · "),
      active: k.status === "ativo",
      recent: k.created_at,
    };
  });
