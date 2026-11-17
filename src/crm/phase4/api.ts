import { supabase } from "../../lib/supabase";
export async function invoke<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase!.functions.invoke(name, { body });
  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null);
      if (payload?.error) throw new Error(String(payload.error));
    }
    throw new Error(
      "Não foi possível concluir. Confira sua sessão e tente novamente.",
    );
  }
  return data as T;
}
