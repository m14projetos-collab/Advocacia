export interface Appointment {
  id: string;
  title: string;
  type: "consulta" | "audiencia" | "prazo" | "interno";
  starts_at: string;
  ends_at: string;
  lead_id: string | null;
  case_id: string | null;
  meeting_url: string | null;
  payment_required: boolean;
  status: "pendente" | "confirmado" | "concluido" | "cancelado";
  updated_at: string;
}
export interface Payment {
  id: string;
  order_nsu: string;
  client_id: string;
  case_id: string | null;
  appointment_id: string | null;
  description: string;
  fee_type: string;
  amount_cents: number;
  status: string;
  checkout_url: string | null;
  checkout_state: string;
  review_required: boolean;
  created_at: string;
  due_date: string | null;
  paid_at: string | null;
}
export const APPOINTMENT_TYPES = {
  consulta: "Consulta",
  audiencia: "Audiência",
  prazo: "Prazo",
  interno: "Interno",
};
export const APPOINTMENT_STATUS = {
  pendente: "Pendente",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
export const PAYMENT_STATUS: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  settled: "Liquidado",
  canceled: "Cancelado",
  refunded: "Estornado",
  failed: "Falhou",
};
export function safeHttps(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
