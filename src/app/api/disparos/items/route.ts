// src/app/api/disparos/items/route.ts
import { NextRequest } from "next/server";
import { supabase } from "../../../lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const batchId = Number(req.nextUrl.searchParams.get("batchId") || 0);
  if (!batchId) return Response.json({ items: [] });

  const { data } = await supabase
    .from("messages")
    .select("id, numero, status, error, sent_at, delivered_at, read_at, replied_at")
    .eq("batch_id", batchId)
    .order("id", { ascending: true });

  return Response.json({ items: data || [] });
}
