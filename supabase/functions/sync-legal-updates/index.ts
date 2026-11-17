import {
  body,
  cors,
  failure,
  HttpError,
  member,
  response,
} from "../_shared/office.ts";
import { bounded, external } from "../_shared/phase5.ts";
import {
  cleanText,
  optionalContext,
  product,
  requireEnv,
  sha256,
} from "../_shared/phase6.ts";
// URLs não vêm do navegador. Mudanças de fontes exigem revisão de código/SQL.
export const SOURCES: Record<string, string> = {
  cnj: "https://www.cnj.jus.br/feed/",
  stj: "https://www.stj.jus.br/sites/portalp/Inicio",
  stf: "https://noticias.stf.jus.br/",
  tjsp: "https://www.tjsp.jus.br/Noticias",
  tjrj: "https://www.tjrj.jus.br/web/guest/noticias",
  tjmg: "https://www.tjmg.jus.br/portal-tjmg/noticias/",
  familia:
    "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
  saude: "https://www.planalto.gov.br/ccivil_03/leis/l9656.htm",
  criminal: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689.htm",
  contratos:
    "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
  etica: "https://www.oab.org.br/leisnormas/legislacao/resolucoes/02-2015",
  oab205: "https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021",
  datajud: "https://datajud-wiki.cnj.jus.br/api-publica/",
};
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req),
      input = await body(req);
    await product(db, actor, "sync_reserve");
    const knowledge = await product(db, actor, "knowledge"),
      results: { source_id: string; ok: boolean }[] = [];
    const queue = (
      knowledge.sources as {
        id: string;
        official_url: string;
        title: string;
        enabled: boolean;
      }[]
    ).filter((s) => s.enabled);
    // Máximo de três downloads simultâneos e 1 MB/fonte; falhas não apagam versões válidas.
    async function worker() {
      while (queue.length) {
        const source = queue.shift()!;
        let error: string | null = null;
        try {
          if (SOURCES[source.id] !== source.official_url)
            throw new HttpError(400, "Fonte exige revisão técnica.");
          const r = await external(
            source.official_url,
            {
              headers: {
                Accept: "text/html, application/rss+xml",
                "User-Agent": "M14LegalHub/1.0",
              },
            },
            10000,
          );
          const html = new TextDecoder().decode(
            await bounded(
              new Request("https://local.test", {
                method: "POST",
                body: r.body,
                duplex: "half",
              } as RequestInit),
              1048576,
            ),
          );
          const main =
            html.match(
              /<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i,
            )?.[1] ?? html;
          const summary = cleanText(main).slice(0, 8000);
          if (
            summary.length < 150 ||
            /access denied|checking your browser|just a moment|acesso negado|captcha/i.test(
              summary.slice(0, 800),
            )
          )
            throw new HttpError(502, "Fonte temporariamente indisponível.");
          await product(
            db,
            actor,
            "sync_result",
            {},
            {
              source_id: source.id,
              official_url: source.official_url,
              title: source.title,
              summary,
              content_hash: await sha256(summary),
            },
          );
        } catch {
          error =
            "Não foi possível consultar a fonte oficial. Última versão preservada.";
          await product(
            db,
            actor,
            "sync_result",
            {},
            { source_id: source.id, official_url: source.official_url, error },
          );
        }
        results.push({ source_id: source.id, ok: error === null });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    let datajud: Record<string, unknown> | null = null;
    const ctx = optionalContext(input.context);
    if (ctx.case_id) {
      try {
        const r = await external(
          `${requireEnv("SUPABASE_URL")}/functions/v1/datajud-lookup`,
          {
            method: "POST",
            headers: {
              Authorization: req.headers.get("authorization")!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ context: ctx }),
          },
        );
        datajud = await r.json();
      } catch {
        datajud = {
          error:
            "Consulta pública do caso não concluída. Confira classificação de sigilo, CNJ e configuração DataJud.",
        };
      }
    }
    return response({ results, datajud }, 200, headers);
  } catch (error) {
    return failure(error, headers);
  }
});
