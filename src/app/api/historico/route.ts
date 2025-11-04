// ./src/app/api/historico/route.ts
import { NextRequest } from "next/server";
import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";

/* ========= Tipos ========= */
type Status = "queued" | "sending" | "sent" | "delivered" | "read" | "replied" | "error";

type Counters = {
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  error: number;
};

type Row = {
  id: number;
  batch_id: number;
  lista_id: number | null;
  lista_nome: string | null;
  instance: string | null;
  numero: string;
  status: Status;
  error: string | null;
  created_at: string; // ISO
  replied_at: string | null;
};

type Group = {
  id: number;
  lista_id: number | null;
  lista_nome: string | null;
  instance: string | null;
  total_enviado: number;
  data: string; // mais recente dentro do batch
  counters: Counters;
};

type ItemOut = {
  id: number;
  lista_id: number | null;
  lista_nome: string | null;
  instance: string | null;
  total_enviado: number;
  data: string;
  status: Status | "done";
  counters: Counters;
};

/* ========= Handler ========= */
export async function GET(req: NextRequest) {
  const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const status = String(req.nextUrl.searchParams.get("status") || "") as Status | "";
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let query = supabase
    .from("messages")
    .select(
      "batch_id, lista_id, lista_nome, instance, numero, status, error, created_at, replied_at, id"
    );

  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return Response.json({ items: [] as ItemOut[], error: error.message }, { status: 500 });
  }

  const rows: Row[] = (data as Row[]) ?? [];

  // agrega por batch
  const map = new Map<number, Group>();

  for (const r of rows) {
    const existing = map.get(r.batch_id);

    const g: Group =
      existing ??
      ({
        id: r.batch_id,
        lista_id: r.lista_id,
        lista_nome: r.lista_nome,
        instance: r.instance,
        total_enviado: 0,
        data: r.created_at,
        counters: { queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, replied: 0, error: 0 },
      } as Group);

    g.total_enviado += 1;

    // manter a data mais recente do grupo
    if (new Date(r.created_at).getTime() > new Date(g.data).getTime()) {
      g.data = r.created_at;
    }

    // incrementa contador do status garantido pelo tipo
    g.counters[r.status] += 1;

    map.set(r.batch_id, g);
  }

  let items: ItemOut[] = Array.from(map.values()).map((x) => {
    const c = x.counters;
    const statusHeader: Status | "done" =
      c.replied > 0
        ? "replied"
        : c.read > 0
        ? "read"
        : c.delivered > 0
        ? "delivered"
        : c.sent > 0
        ? "sent"
        : c.error > 0
        ? "error"
        : c.queued + c.sending > 0
        ? "queued"
        : "done";

    return {
      id: x.id,
      lista_id: x.lista_id,
      lista_nome: x.lista_nome,
      instance: x.instance,
      total_enviado: x.total_enviado,
      data: x.data,
      status: statusHeader,
      counters: x.counters,
    };
  });

  if (q) {
    items = items.filter(
      (it) =>
        String(it.id).includes(q) ||
        String(it.lista_id ?? "").includes(q) ||
        String(it.lista_nome ?? "").toLowerCase().includes(q)
    );
  }

  // mais recente primeiro; se empatar na data, ordena por id desc
  items.sort(
    (a, b) =>
      new Date(b.data).getTime() - new Date(a.data).getTime() || (b.id ?? 0) - (a.id ?? 0)
  );

  return Response.json({ items });
}
