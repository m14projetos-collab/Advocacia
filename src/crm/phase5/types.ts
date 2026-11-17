import { Case, Client, Lead } from "../types";
import { Appointment, Payment } from "../phase4/types";
export interface Context {
  lead_id?: string;
  client_id?: string;
  case_id?: string;
}
export interface HubCase extends Case {
  cnj_number: string | null;
  is_confidential: boolean;
  ai_summary: string | null;
  updated_at: string;
}
export interface Message {
  id: string;
  lead_id: string | null;
  client_id: string | null;
  case_id: string | null;
  direction: string;
  content: string;
  send_state: string;
  provider: string;
  created_at: string;
  remote_phone: string | null;
  provider_media_id: string | null;
}
export interface Call {
  id: string;
  notes: string;
  outcome: string;
  direction: string;
  duration_seconds: number | null;
  created_at: string;
  case_id: string | null;
}
export interface Document {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}
export interface Run {
  id: string;
  task: string;
  content: string | null;
  status: string;
  created_at: string;
  case_id: string | null;
}
export interface HubSnapshot {
  lead_id: string | null;
  client_id: string | null;
  case_id: string | null;
  lead: Lead | null;
  client: Client | null;
  case: HubCase | null;
  cases: HubCase[];
  phone: string | null;
  actor: { role: string; full_name: string };
  messages: Message[];
  calls: Call[];
  documents: Document[];
  ai_runs: Run[];
  appointments: Appointment[];
  payments: Payment[];
  lookups: {
    id: string;
    status: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }[];
  has_more: boolean;
}
export const contextFromUrl = (): Context => {
  const params = new URLSearchParams(window.location.search);
  const ctx: Context = {};
  for (const key of ["lead_id", "client_id", "case_id"] as const) {
    const value = params.get(key);
    if (value && /^[0-9a-f-]{36}$/i.test(value)) ctx[key] = value;
  }
  return ctx;
};
export function contextLink(
  path: string,
  ctx: Context,
  extra: Record<string, string> = {},
) {
  return path + "?" + new URLSearchParams({ ...ctx, ...extra }).toString();
}
