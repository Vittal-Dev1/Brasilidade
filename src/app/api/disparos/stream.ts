import { NextRequest } from "next/server";
import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const batchId = Number(req.nextUrl.searchParams.get("batchId") || 0);
  if (!batchId) return new Response("missing batchId", { status: 400 });

  let timer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const { data } = await supabase
          .from("messages")
          .select("id, numero, status, error, sent_at, delivered_at, read_at, replied_at")
          .eq("batch_id", batchId)
          .order("id", { ascending: true });

        const payload = { items: data || [] };
        controller.enqueue(`event: snapshot\n`);
        controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
      }

      await push();
      timer = setInterval(push, 2000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
