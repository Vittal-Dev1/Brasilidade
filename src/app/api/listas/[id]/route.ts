// ./src/app/api/listas/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "../../../lib/supabaseServer";

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

type ListaRow = {
  id: number;
  nome: string;
  templates: TemplateVariation[] | null;
  reply_templates: TemplateVariation[] | null;
  contatos: Contato[] | null;
  settings: Settings | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/* ==================== GET ==================== */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceRoleClient();
  try {
    const { id } = await context.params;
    const listId = Number(id);
    if (!listId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const { data, error } = await supabase
      .from("listas_disparos")
      .select("*")
      .eq("id", listId)
      .maybeSingle<ListaRow>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });

    const out: ListaRow = {
      ...data,
      nome: data.nome ?? "",
      templates: data.templates ?? [],
      reply_templates: data.reply_templates ?? [],
      contatos: data.contatos ?? [],
      settings: data.settings ?? {},
    };

    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* ==================== PUT ==================== */
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceRoleClient();
  try {
    const { id } = await context.params;
    const listId = Number(id);
    if (!listId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const body = (await req.json()) as ListaBody;
    if (!body?.nome?.trim() || !Array.isArray(body.templates) || !Array.isArray(body.contatos)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const { data: exists, error: exErr } = await supabase
      .from("listas_disparos")
      .select("id")
      .eq("id", listId)
      .maybeSingle<{ id: number }>();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    if (!exists) return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });

    const payload: Partial<ListaRow> = {
      nome: body.nome.trim(),
      templates: body.templates,
      reply_templates: body.replyTemplates ?? null,
      contatos: body.contatos,
      settings: body.settings ?? {},
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: upErr, status } = await supabase
      .from("listas_disparos")
      .update(payload)
      .eq("id", listId)
      .select("id")
      .maybeSingle<{ id: number }>();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    if (!updated && status !== 204) {
      return NextResponse.json({ error: "Falha ao atualizar" }, { status: 500 });
    }

    return NextResponse.json({ id: updated?.id ?? listId, updated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
