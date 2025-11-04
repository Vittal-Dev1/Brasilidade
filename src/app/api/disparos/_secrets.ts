import { supabase } from "../../lib/supabase";

export async function getTokenForInstance(instance: string): Promise<string> {
  // 1) env JSON { "disparos": "TOKEN...", "pessoal": "TOKEN..." }
  const raw = process.env.UAZAPIGO_TOKENS || "";
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      if (map[instance]) return map[instance];
    } catch {}
  }

  // 2) tabela Supabase (name, token)
  try {
    const { data } = await supabase
      .from("instances")
      .select("token")
      .eq("name", instance)
      .limit(1)
      .single();
    if (data?.token) return data.token;
  } catch {}

  // 3) fallback global (não recomendado)
  const fallback = process.env.UAZAPIGO_TOKEN || process.env.UAZAPI_ADMIN_TOKEN || "";
  if (!fallback) throw new Error(`Token não encontrado para a instância "${instance}"`);
  return fallback;
}
