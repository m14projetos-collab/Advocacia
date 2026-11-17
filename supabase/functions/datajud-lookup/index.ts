import {
  body,
  cors,
  failure,
  HttpError,
  member,
  object,
  response,
} from "../_shared/office.ts";
import { action, context, external } from "../_shared/phase5.ts";
import { tribunal, validCnj } from "../_shared/cnj.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req);
    const input = await body(req),
      ctx = context(input.context);
    const snapshot = await action(db, actor, "snapshot", ctx);
    if (!snapshot.case) throw new HttpError(400, "Selecione um caso.");
    if (snapshot.case.is_confidential !== false)
      throw new HttpError(
        409,
        "Caso classificado como sigiloso. Use upload privado; a API Pública não disponibiliza o conteúdo protegido.",
      );
    const number = validCnj(String(snapshot.case.cnj_number ?? "")),
      alias = tribunal(number),
      key = Deno.env.get("DATAJUD_API_KEY");
    if (!key)
      throw new HttpError(
        503,
        "Chave pública DataJud não configurada no backend.",
      );
    const r = await external(
      `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `APIKey ${key}`,
        },
        body: JSON.stringify({
          size: 5,
          query: { match: { numeroProcesso: number } },
          _source: [
            "numeroProcesso",
            "nivelSigilo",
            "classe",
            "assuntos",
            "orgaoJulgador",
            "movimentos",
            "dataHoraUltimaAtualizacao",
            "tribunal",
          ],
        }),
      },
    );
    const payload = object(await r.json()),
      hits = object(payload.hits).hits as {
        _source: Record<string, unknown>;
      }[];
    const matches = (hits ?? [])
      .map((x) => x._source)
      .filter((x) => x && x.numeroProcesso === number);
    const publicHit = matches.find((x) => x.nivelSigilo === 0);
    const status = publicHit
      ? "public"
      : matches.some((x) => Number(x.nivelSigilo) > 0)
        ? "restricted"
        : "not_found";
    const metadata = publicHit
      ? {
          source: "CNJ / DataJud",
          tribunal: publicHit.tribunal,
          number,
          classe: publicHit.classe,
          assuntos: publicHit.assuntos,
          orgaoJulgador: publicHit.orgaoJulgador,
          last_update: publicHit.dataHoraUltimaAtualizacao,
          movimentos: Array.isArray(publicHit.movimentos)
            ? publicHit.movimentos.slice(-10)
            : [],
        }
      : {
          source: "CNJ / DataJud",
          number,
          message:
            "Sem resultado público confirmado. Pode haver sigilo, atraso da base, numeração ou cobertura do tribunal; ausência não prova segredo de justiça. Utilize os documentos privados.",
        };
    return response(
      await action(db, actor, "datajud_store", ctx, { status, metadata }),
      200,
      headers,
    );
  } catch (error) {
    return failure(error, headers);
  }
});
