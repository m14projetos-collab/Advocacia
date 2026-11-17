export const STAGES = [
  ["novo", "Novos"],
  ["triagem", "Em triagem"],
  ["reuniao_agendada", "Reunião agendada"],
  ["proposta", "Proposta"],
  ["fechado", "Fechados"],
  ["arquivado", "Arquivados"],
] as const;
export type Stage = (typeof STAGES)[number][0];
export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  summary: string;
  practice_area: string;
  stage: Stage;
  urgency: string;
  created_at: string;
  converted_client_id: string | null;
  last_contact_at?: string | null;
  last_inbound_at?: string | null;
}
export interface Client {
  id: string;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  updated_at?: string;
  created_at?: string;
  phone: string | null;
  email: string | null;
  address_json: Record<string, string>;
}
export interface Case {
  id: string;
  client_id: string;
  title: string;
  status: string;
  practice_area: string;
  opposing_party: string | null;
  source_lead_id: string | null;
  cnj_number?: string | null;
  created_at?: string;
}
export interface Conflict {
  case_id: string;
  full_name: string;
  party_role: string;
  match_by: string;
}
export interface Review {
  token: string;
  conflicts: Conflict[];
}
export interface ConversionInput {
  p_lead_id: string;
  p_name: string;
  p_document_type: string;
  p_document_number: string;
  p_title: string;
  p_address: Record<string, string>;
  p_opposing_name: string;
  p_opposing_document_type: string;
  p_opposing_document_number: string;
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "Não foi possível concluir. Tente novamente.";
}
