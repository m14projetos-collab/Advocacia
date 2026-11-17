import {
  body,
  cors,
  failure,
  HttpError,
  member,
  object,
  response,
  text,
  uuid,
} from "../_shared/office.ts";
import { product } from "../_shared/phase6.ts";
import { context } from "../_shared/phase5.ts";
Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      throw new HttpError(405, "Método não permitido.");
    const { db, actor } = await member(req),
      input = await body(req),
      ctx = context(input.context),
      id = uuid(input.id);
    if (input.operation === "review") {
      if (
        input.reviewed !== true ||
        !Array.isArray(input.documents) ||
        input.documents.length !== 3
      )
        throw new HttpError(400, "Revisão de três minutas obrigatória.");
      const documents = input.documents.map((value) => {
        const d = object(value);
        return {
          title: text(d.title, 100, "Título"),
          content: text(d.content, 8000, "Minuta revisada"),
        };
      });
      return response(
        await product(db, actor, "kit_review", ctx, {
          id,
          base_kit_id: uuid(input.base_kit_id),
          documents,
          reviewed: true,
        }),
        200,
        headers,
      );
    }
    const fields = object(input.fields);
    const info = await product(db, actor, "details", ctx),
      client = info.client,
      lawyer = info.profile;
    if (
      !info.case ||
      !client?.document_number ||
      !lawyer?.oab_number ||
      !lawyer?.oab_uf
    )
      throw new HttpError(
        400,
        "Kit exige caso, documento do cliente e OAB/UF no seu perfil.",
      );
    const scope = text(fields.scope, 2500, "Objeto e limites da atuação"),
      fees = text(fields.fees, 2500, "Honorários e pagamento"),
      qualification = text(
        fields.qualification,
        1500,
        "Qualificação complementar",
      ),
      address = [
        "street",
        "number",
        "complement",
        "neighborhood",
        "city",
        "state",
        "cep",
      ]
        .map((key) => client.address_json?.[key])
        .filter(Boolean)
        .join(", ");
    if (!address)
      throw new HttpError(
        400,
        "Complete o endereço do cliente na formalização antes de gerar o kit.",
      );
    const place = "Santos/SP",
      date = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "long",
      }).format(new Date());
    const party = `${client.full_name}, ${qualification}, ${String(client.document_type).toUpperCase()} ${client.document_number}, com endereço em ${address}`;
    const attorney = `${lawyer.full_name}, advogado(a), OAB/${lawyer.oab_uf} ${lawyer.oab_number}, escritório em Santos/SP, M14 Advocacia, CNPJ 62.575.046/0001-96`;
    const sign = `\n\n${place}, ${date}.\n\n________________________________\n${client.full_name}\n\n________________________________\n${lawyer.full_name} — OAB/${lawyer.oab_uf} ${lawyer.oab_number}`;
    const documents = [
      {
        title: "Procuração",
        content: `PROCURAÇÃO — MINUTA PARA REVISÃO\n\nOUTORGANTE: ${party}.\nOUTORGADO(A): ${attorney}.\n\nObjeto: ${scope}.\nPoderes gerais para o foro, nos limites do mandato. Poderes especiais do art. 105 do CPC não são incluídos automaticamente; sua necessidade deve ser analisada e expressamente documentada pelo advogado e outorgante.\nEsta minuta não autoriza recebimento de valores, transação, renúncia ou confissão por cláusula genérica.${sign}`,
      },
      {
        title: "Contrato de Honorários",
        content: `CONTRATO DE HONORÁRIOS — MINUTA PARA REVISÃO\n\nCONTRATANTE: ${party}.\nCONTRATADO(A): ${attorney}.\n\n1. Objeto e limites: ${scope}.\n2. Honorários, forma de pagamento e condições acordadas: ${fees}.\n3. A atuação é obrigação de meio, sem promessa de resultado. Custas e despesas, hipóteses de rescisão, recursos e atos fora do objeto devem ser discriminados e ajustados pelas partes antes da assinatura.\n4. O cliente fornecerá informações e documentos verdadeiros; comunicações e dados serão tratados sob sigilo profissional.\n5. Revisão obrigatória: conferir tabela de honorários aplicável, proporcionalidade, cláusulas de rescisão e condições particulares. Lacunas devem ser resolvidas antes da assinatura.${sign}`,
      },
      {
        title: "Declaração de Hipossuficiência",
        content: `DECLARAÇÃO DE HIPOSSUFICIÊNCIA — MINUTA CONDICIONADA À VERACIDADE\n\nEu, ${party}, declaro, sob as penas da lei e após orientação individual, que não tenho condições de arcar com custas e despesas processuais sem prejuízo do meu sustento e de minha família, para requerer a gratuidade da justiça quando cabível.\nA declaração não garante deferimento. A condição econômica e documentos devem ser conferidos pelo declarante e advogado. Não assinar se o conteúdo não corresponder à realidade.${sign}`,
      },
    ];
    return response(
      await product(db, actor, "kit_save", ctx, {
        id,
        inputs: { scope, fees, qualification },
        documents,
      }),
      200,
      headers,
    );
  } catch (error) {
    return failure(error, headers);
  }
});
