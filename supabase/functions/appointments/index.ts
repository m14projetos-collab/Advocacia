import {
  body,
  cors,
  failure,
  HttpError,
  member,
  object,
  response,
  rpc,
  text,
  uuid,
} from "../_shared/office.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    const input = await body(req);
    const data = object(input.appointment);
    const appointment = {
      title: text(data.title, 240, "Título"),
      type: text(data.type, 20, "Tipo"),
      status: text(data.status, 20, "Status"),
      starts_at: text(data.starts_at, 40, "Início"),
      ends_at: text(data.ends_at, 40, "Fim"),
      lead_id: data.lead_id ? uuid(data.lead_id) : null,
      case_id: data.case_id ? uuid(data.case_id) : null,
      payment_required: data.payment_required === true,
      meeting_url: data.meeting_url
        ? text(data.meeting_url, 1000, "Link")
        : null,
    };
    if (appointment.meeting_url) {
      const url = new URL(appointment.meeting_url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new HttpError(400, "Use link de reunião HTTPS.");
    }
    const result = await rpc(db, "office_save_appointment", {
      p_actor: actor,
      p_id: uuid(input.id),
      p_data: appointment,
      p_expected_updated_at: input.expected_updated_at
        ? text(input.expected_updated_at, 40, "Versão")
        : null,
    });
    return response({ appointment: result }, 200, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
