// ./src/app/api/listas/route.ts
import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";

/* ==================== Tipos ==================== */
type Contato = Record<string, string>;
type TemplateVariation = { base: string; variations: string[] };
type Settings = Record<string, unknown>;

interface ListaBody {
  nome: string;
  templates: TemplateVariation[];
  replyTemplates?: TemplateVariation[] | null;
  contatos: Contato[];
  settings?: Settings;
}

/* ============================================================
   GET /api/listas
   Lista resumida das listas de disparo
   ============================================================ */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("listas_disparos")
      .select("id, nome, created_at")
      .order("id", { ascending: false });

    if (error) {
      console.error("💥 Erro Supabase (GET listas):", error);
      return NextResponse.json(
        { error: error.message || "Erro ao consultar banco" },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error("💥 GET /api/listas ERRO:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro interno no servidor" },
      { status: 500 }
    );
  }
}

/* ============================================================
   POST /api/listas
   Cria uma nova lista de disparo
   ============================================================ */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ListaBody;

    // --- Validação mínima
    if (
      !body?.nome?.trim() ||
      !Array.isArray(body.templates) ||
      !Array.isArray(body.contatos)
    ) {
      return NextResponse.json(
        { error: "Dados inválidos. Campos obrigatórios ausentes." },
        { status: 400 }
      );
    }

    const payload = {
      nome: body.nome.trim(),
      templates: body.templates,
      reply_templates: body.replyTemplates ?? null,
      contatos: body.contatos,
      settings: (body.settings ?? {}) as Settings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("listas_disparos")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("💥 Erro Supabase (POST lista):", error);
      return NextResponse.json(
        { error: error.message || "Erro ao salvar lista" },
        { status: 500 }
      );
    }

    if (!data?.id) {
      return NextResponse.json(
        { error: "Falha ao criar lista. Nenhum ID retornado." },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id, created: true });
  } catch (e) {
    console.error("💥 POST /api/listas ERRO:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro interno no servidor" },
      { status: 500 }
    );
  }
}
