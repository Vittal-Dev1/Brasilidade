/* src/app/api/disparos/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= ENV ========= */
const API_BASE = (process.env.UAZAPIGO_API_URL || process.env.UAZAPI_BASE_URL || "").replace(/\/$/, "");
const TOKEN_INSTANCIA = process.env.UAZAPIGO_TOKEN || process.env.UAZAPI_TOKEN || "";
const INSTANCE_NAME =
  process.env.UAZAPIGO_INSTANCE_NAME ||
  process.env.UAZAPI_INSTANCE_NAME ||
  process.env.WHATSAPP_INSTANCE_NAME ||
  process.env.UAZAPIGO_INSTANCE_KEY ||
  process.env.UAZAPI_INSTANCE_KEY ||
  "main";

/* ========= Tipos ========= */
type Contact = { nome?: string; numero: string };

type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "error";

type MessageRowInsert = {
  batch_id: number;
  lista_id: number | null;
  lista_nome: string | null;
  numero: string;
  status: MessageStatus;
  error: string | null;
  payload: { text: string };
  created_at: string; // ISO
  scheduled_at: string; // ISO
  sent_at?: string | null;
};

type MessageRowSelect = {
  id: number;
  batch_id: number;
  numero: string;
  status: MessageStatus;
  error: string | null;
  scheduled_at: string;
  payload: { text: string };
  sent_at?: string | null;
};

type BodyCreate = {
  listaId?: number | null;
  listaNome?: string | null;
  textPool?: string[];
  contacts?: Contact[];
  cadenceDays?: number[];
  delayMsMin?: number;
  delayMsMax?: number;
  pauseEvery?: number;
  pauseDurationMs?: number;
  instanceName?: string;
  startAtMs?: number | null;
  ignoreWindow?: boolean;
  tz?: string;          // IANA: "America/Sao_Paulo"
  tzOffsetMin?: number; // (aceito no tipo para compat), não usamos no código
};

type BodyResume = {
  batchId: number;
  ignoreWindow?: boolean; // mantido no tipo por compat
};

type BodyIn = BodyCreate | BodyResume;

/* ========= Utils ========= */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (v: string) => (v || "").replace(/\D+/g, "");
const norm = (n: string) => {
  const d = digits(n ?? "");
  if (!d) return "";
  return d.startsWith("55") ? d : `55${d}`;
};
const now = () => Date.now();
const rand = (a: number, b: number) => {
  let min = Math.min(a, b);
  const max = Math.max(a, b);
  if (min < 0) min = 0;
  return min + Math.floor(Math.random() * (max - min + 1));
};

const getErrMsg = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" ? m : JSON.stringify(m);
  }
  try {
    return String(e);
  } catch {
    return "Unknown error";
  }
};

/* ========= Timezone helpers (janela 08–18 no fuso informado) ========= */
function getLocalHour(t: number, tz?: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: tz || "UTC",
  });
  return Number(fmt.format(new Date(t)));
}
function inWindow(t: number, tz?: string, startH = 8, endH = 18) {
  const h = getLocalHour(t, tz);
  return h >= startH && h < endH;
}
function next0800(t: number, tz?: string) {
  const z = tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: z,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(t))
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const yyyy = Number(parts.year);
  const mm = Number(parts.month);
  const dd = Number(parts.day);

  // 08:00 local convertido pra epoch
  const eightLocal = new Date(Date.UTC(yyyy, mm - 1, dd, 8, 0, 0, 0));
  const offsetMin = -new Date(
    eightLocal.toLocaleString("en-US", { timeZone: z })
  ).getTimezoneOffset();
  const eightEpoch = eightLocal.getTime() - offsetMin * 60_000;

  if (t <= eightEpoch) return eightEpoch;

  // amanhã 08:00 local
  const tomorrow = new Date(eightEpoch);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.getTime();
}

/* ========= Envio via Uazapi ========= */
async function sendViaUazapi(to: string, text: string) {
  if (!API_BASE) throw new Error("UAZAPIGO_API_URL ausente");
  if (!TOKEN_INSTANCIA) throw new Error("UAZAPIGO_TOKEN ausente");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    token: TOKEN_INSTANCIA,
  };
  const body = JSON.stringify({ number: to, text });

  const parseBody = async (res: Response): Promise<unknown> => {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch {}
    }
    const txt = await res.text().catch(() => "");
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
    }
  };

  const tryPost = async (url: string) => {
    const res = await fetch(url, { method: "POST", headers, body });
    const data = await parseBody(res);
    return { res, data };
  };

  const normalizeCandidates = (baseOrFull: string) => {
    const clean = baseOrFull.replace(/\/+$/, "");
    const hasEndpoint = /\/(send\/text|message\/text|sendText)$/i.test(clean);
    return hasEndpoint
      ? [clean]
      : [`${clean}/send/text`, `${clean}/message/text`, `${clean}/sendText`];
  };

  const tried: { url: string; status: number; data: unknown }[] = [];
  const firstBatch = normalizeCandidates(API_BASE);

  for (const url of firstBatch) {
    const { res, data } = await tryPost(url);
    tried.push({ url, status: res.status, data });
    if (res.ok) return;

    if (res.status === 404) {
      const headerFallback =
        res.headers.get("x-fallback-url") || res.headers.get("X-Fallback-URL");
      const bodyFallback =
        data &&
        typeof data === "object" &&
        "step" in data &&
        (data as { step?: unknown }).step === "fallback" &&
        "url" in data &&
        typeof (data as { url?: unknown }).url === "string"
          ? String((data as { url?: string }).url)
          : null;

      const fb = headerFallback || bodyFallback;
      if (fb) {
        const fbBatch = normalizeCandidates(fb);
        for (const alt of fbBatch) {
          const r2 = await tryPost(alt);
          tried.push({ url: alt, status: r2.res.status, data: r2.data });
          if (r2.res.ok) return;
        }
      }
    }
  }

  const lines = tried.map((t) => {
    const d = typeof t.data === "string" ? t.data : JSON.stringify(t.data);
    return `${t.status} ${t.url} -> ${d}`;
  });
  throw new Error(`Falha ao enviar (tentativas):\n${lines.join("\n")}`);
}

/* ========= Persistência do batch ========= */
async function insertBatchRow(params: {
  instanceName: string;
  source: "csv" | "lista";
  listaId?: number | null;
  listaNome?: string | null;
  status?: string;
}): Promise<number> {
  const fullPayload: Record<string, unknown> = {
    instance_name: params.instanceName,
    source: params.source,
    status: params.status ?? "queued",
    lista_id: params.listaId ?? null,
    lista_nome: params.listaNome ?? null,
  };

  for (const k of Object.keys(fullPayload)) {
    if (fullPayload[k] == null) delete fullPayload[k];
  }

  let res = await supabase
    .from("batches")
    .insert(fullPayload)
    .select("id")
    .single();

  if (!res.error && res.data?.id) return res.data.id as number;

  const msg = res.error?.message ?? "";
  const code = (res.error as { code?: string } | null)?.code ?? "";

  if (code === "42703" || /column .* does not exist/i.test(msg)) {
    const minimal: Record<string, unknown> = {
      instance_name: params.instanceName,
      source: params.source,
    };
    res = await supabase.from("batches").insert(minimal).select("id").single();
    if (!res.error && res.data?.id) return res.data.id as number;
  }

  throw new Error(res.error?.message ?? "Falha ao criar batch em 'batches'");
}

/* ========= Construção das mensagens ========= */
function buildRows(
  batchId: number,
  contacts: Contact[],
  textPool: string[],
  startAtMs: number,
  cadenceDays: number[],
  listaId?: number | null,
  listaNome?: string | null
): MessageRowInsert[] {
  const rows: MessageRowInsert[] = [];

  for (const c of contacts) {
    const numero = norm(c.numero);
    if (!numero) continue;

    const moments = [startAtMs, ...cadenceDays.map((d) => startAtMs + d * 86400000)];
    for (const when of moments) {
      for (const t of textPool) {
        const text = (t || "")
          .replaceAll("{{nome}}", String(c.nome || ""))
          .replaceAll("{{numero}}", String(c.numero || ""));

        rows.push({
          batch_id: batchId,
          lista_id: listaId ?? null,
          lista_nome: listaNome ?? null,
          numero,
          status: "queued",
          error: null,
          payload: { text },
          created_at: new Date().toISOString(),
          scheduled_at: new Date(when).toISOString(),
        });
      }
    }
  }
  return rows;
}

/* ========= Inserção e retorno de IDs ========= */
async function createRows(
  batchId: number,
  contacts: Contact[],
  textPool: string[],
  startAtMs: number,
  cadenceDays: number[],
  listaId?: number | null,
  listaNome?: string | null
): Promise<{ ids: number[] }> {
  const rows = buildRows(
    batchId,
    contacts,
    textPool,
    startAtMs,
    cadenceDays,
    listaId,
    listaNome
  );
  if (!rows.length) return { ids: [] };

  const insertRes = await supabase.from("messages").insert(rows).select("id");
  if (insertRes.error) throw new Error(insertRes.error.message);

  const ids = (insertRes.data as Array<{ id: number }>).map((r) => r.id);
  return { ids };
}

/* ========= Jitter / Pausa ========= */
async function applyJitterAndPause(
  ids: number[],
  minGapMs: number,
  maxGapMs: number,
  pauseEvery: number,
  pauseDurationMs: number
) {
  if (!ids.length) return;

  const sel = await supabase
    .from("messages")
    .select("id, scheduled_at")
    .in("id", ids)
    .order("scheduled_at", { ascending: true });

  if (sel.error) throw new Error(sel.error.message);
  const rows = (sel.data as Array<{ id: number; scheduled_at: string }>) ?? [];
  if (!rows.length) return;

  let cursor = Math.max(now(), new Date(rows[0].scheduled_at).getTime());
  let count = 0;

  for (const r of rows) {
    if (count > 0) {
      const gap =
        minGapMs >= maxGapMs
          ? Math.max(0, minGapMs)
          : Math.max(0, rand(minGapMs, maxGapMs));
      cursor += gap;

      if (pauseEvery > 0 && count % pauseEvery === 0) {
        cursor += Math.max(0, pauseDurationMs);
      }
    }

    const r2 = await supabase
      .from("messages")
      .update({ scheduled_at: new Date(cursor).toISOString() })
      .eq("id", r.id);

    if (r2.error) throw new Error(r2.error.message);
    count++;
  }
}

/* ========= Processamento (não depende de janela; só do horário agendado) ========= */
async function processChunk(
  batchId: number,
  limit = 15,
  timeBudgetMs = 18000
) {
  const startClock = now();
  const slackMs = 1500;

  while (now() - startClock < timeBudgetMs) {
    const nowIso = new Date(Date.now() + slackMs).toISOString();

    const q = await supabase
      .from("messages")
      .select("id, numero, payload, scheduled_at, status")
      .eq("batch_id", batchId)
      .in("status", ["queued", "sending"])
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (q.error) throw new Error(q.error.message);
    const jobs = (q.data as MessageRowSelect[]) || [];
    if (!jobs.length) return { processed: 0, reason: "no-jobs" as const };

    for (const j of jobs) {
      const to = j.numero;
      const text = (j.payload?.text ?? "").toString();

      await supabase
        .from("messages")
        .update({ status: "sending", error: null })
        .eq("id", j.id);

      let ok = false;
      let last: unknown = null;

      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          await sendViaUazapi(to, text);
          ok = true;
        } catch (e) {
          last = getErrMsg(e);
          await sleep(600 * attempt);
        }
      }

      await supabase
        .from("messages")
        .update(
          ok
            ? { status: "sent", error: null, sent_at: new Date().toISOString() }
            : { status: "error", error: String(last).slice(0, 2000) }
        )
        .eq("id", j.id);

      if (now() - startClock >= timeBudgetMs) {
        return { processed: jobs.length, reason: "time-budget" as const };
      }
    }
  }
  return { processed: 0, reason: "time-budget" as const };
}

/* ========= GET (status do batch) ========= */
export async function GET(req: NextRequest) {
  const batchId = Number(req.nextUrl.searchParams.get("batchId") || 0);
  if (!batchId) return NextResponse.json({ error: "missing batchId" }, { status: 400 });

  const sel = await supabase
    .from("messages")
    .select("status, error")
    .eq("batch_id", batchId);

  if (sel.error) {
    return NextResponse.json({ ok: false, error: sel.error.message }, { status: 500 });
  }

  const data = (sel.data as MessageRowSelect[] | null) ?? [];
  const sent = data.filter((r) => r.status === "sent").length;
  const failed = data.filter((r) => r.status === "error").length;
  const queued = data.filter((r) => r.status === "queued" || r.status === "sending").length;

  return NextResponse.json({
    ok: true,
    batchId,
    sent,
    failed,
    queued,
    inProgress: queued > 0,
    errors: data.filter((r) => !!r.error).slice(-10),
  });
}

/* ========= POST ========= */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    if (!API_BASE || !TOKEN_INSTANCIA) {
      return NextResponse.json({ ok: false, error: "config_missing" }, { status: 500 });
    }

    // Reprocessar chunk existente
    if ("batchId" in body && body.batchId) {
      const bid = Number(body.batchId);
      // ignoreWindow era aceito, mas processChunk não usa (nem usava); removido para evitar warning
      const result = await processChunk(bid, 15, 18000);
      return NextResponse.json({ ok: true, resume: true, batchId: bid, processedNow: result });
    }

    // Novo disparo
    const {
      listaId = null,
      listaNome = null,
      textPool = [],
      contacts = [],
      cadenceDays = [],
      delayMsMin = 1000,
      delayMsMax = 5000,
      pauseEvery = 0,
      pauseDurationMs = 0,
      instanceName,
      startAtMs,
      ignoreWindow = false,
      tz,
      // tzOffsetMin removido da desestruturação para evitar warning
    } = body as BodyCreate;

    const templates = Array.isArray(textPool)
      ? textPool.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    if (!templates.length)
      return NextResponse.json({ ok: false, error: "empty_templates" }, { status: 400 });

    if (!Array.isArray(contacts) || contacts.length === 0)
      return NextResponse.json({ ok: false, error: "empty_contacts" }, { status: 400 });

    const resolvedInstanceName = (instanceName ?? INSTANCE_NAME ?? "").trim();
    if (!resolvedInstanceName) {
      return NextResponse.json(
        { ok: false, error: "config_missing_instance_name" },
        { status: 500 }
      );
    }

    const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    let startAt = typeof startAtMs === "number" && startAtMs > 0 ? startAtMs : now();
    if (!ignoreWindow && !inWindow(startAt, zone)) {
      startAt = next0800(startAt, zone);
    }

    // 1) batch
    const source: "csv" | "lista" = listaId ? "lista" : "csv";
    const batchId = await insertBatchRow({
      instanceName: resolvedInstanceName,
      source,
      listaId,
      listaNome,
      status: "queued",
    });

    // 2) mensagens
    const { ids } = await createRows(
      batchId,
      contacts,
      templates,
      startAt,
      Array.isArray(cadenceDays) ? cadenceDays : [],
      listaId,
      listaNome
    );
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: "no_valid_numbers" }, { status: 400 });
    }

    // 3) jitter/pausa
    const minGap = Math.max(0, Math.min(delayMsMin, delayMsMax));
    const maxGap = Math.max(delayMsMin, delayMsMax);
    await applyJitterAndPause(
      ids,
      minGap,
      maxGap,
      Math.max(0, pauseEvery),
      Math.max(0, pauseDurationMs)
    );

    // 4) processar um pedaço agora
    const processedNow = await processChunk(batchId, 15, 18000);

    return NextResponse.json({
      ok: true,
      batchId,
      queued: ids.length,
      processedNow,
      tz: zone,
      tip: "Para continuar o processamento em serverless, faça POST novamente com { batchId } (polling do front).",
    });
  } catch (e: unknown) {
    console.error("[disparos:POST:error]", e);
    return NextResponse.json({ ok: false, error: getErrMsg(e) }, { status: 500 });
  }
}
