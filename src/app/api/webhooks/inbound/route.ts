// ==================================================================
// API Route (app/api/webhooks/inbound/route.ts)
// Proxy que recebe eventos do provedor e encaminha para o n8n
// - Validação por segredo opcional (X-Webhook-Secret)
// - Normalização do payload de entrada (tentando padronizar)
// - Enriquecimento com metadados (reply_to, batchId, listaId, etc.)
// - Encaminha ao n8n e, se houver decisão de resposta, envia via provedor
// ==================================================================

export const dynamic = "force-dynamic";

// ==== Config via ENV (ajuste conforme seu deploy) ====
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || "https://seu-n8n.com/webhook/entrada-whatsapp";
const PROXY_SECRET = process.env.WEBHOOK_PROXY_SECRET || ""; // se vazio, não valida

// Credenciais do provedor para enviar respostas
const PROVIDER_TYPE = (process.env.PROVIDER_TYPE || "evolution").toLowerCase() as
  | "evolution"
  | "uazapi"
  | "outro";
const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || "https://seu-provedor.com";
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || ""; // Bearer ou apikey, conforme seu provedor

// Se quiser que este endpoint aguarde a decisão do n8n e REENVIE a resposta ao usuário
// (modo "sync") mantenha como true. Se preferir que o n8n responda por conta própria (modo "async"), use false.
const FORWARD_AND_REPLY_SYNC =
  (process.env.FORWARD_AND_REPLY_SYNC || "true").toLowerCase() === "true";

// ==== Tipos ====
export type Normalized = {
  provider?: string;
  instance?: string;
  from?: string; // msisdn de quem enviou
  to?: string; // sua instância / destinatário
  text?: string;
  timestamp?: number;
  messageId?: string;
  isGroup?: boolean;
  reply_to?: string | null; // id da msg original (se a atual é reply)
  raw: unknown; // payload bruto para auditoria
  meta?: ContextMeta | null;
};

// Resposta esperada do n8n (contrato sugerido)
// Você pode retornar só { replyText } que já funciona.
export type N8nDecision =
  | { action?: "none"; reason?: string }
  | { action?: "reply"; replyText: string; mediaUrl?: string; quoted?: boolean }
  | { replyText?: string; mediaUrl?: string; quoted?: boolean }; // retrocompat

type ContextMeta = {
  batchId?: number | null;
  listaId?: number | null;
  contatoId?: number | null;
  campanhaId?: number | null;
  [k: string]: unknown;
};

// ==== Handlers HTTP ====
export async function GET() {
  return new Response("OK", { status: 200 });
}

export async function POST(req: Request) {
  try {
    // 1) Validação opcional por segredo
    if (PROXY_SECRET) {
      const h = req.headers.get("x-webhook-secret");
      if (!h || h !== PROXY_SECRET) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    // 2) Ler payload bruto do provedor
    const raw: unknown = await req.json().catch(() => ({}));

    // 3) Normalizar
    const normalized = normalizeIncoming(raw);

    // 4) Enriquecer com metadados próprios (opcional: Supabase/DB)
    const meta = await lookupContext(normalized.messageId, normalized.reply_to).catch(() => null);
    const enriched: Normalized = { ...normalized, meta };

    // 5) Encaminhar ao n8n
    const n8nRes = await safeFetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });

    if (!n8nRes.ok) {
      const txt = await n8nRes.text();
      return json({ error: `n8n respondeu ${n8nRes.status}`, body: txt }, 502);
    }

    // 6) Se modo sync, ler decisão do n8n e opcionalmente responder via provedor
    if (FORWARD_AND_REPLY_SYNC) {
      const decisionUnknown = await n8nRes.json().catch<unknown>(() => ({} as const));
      const decision = coerceDecision(decisionUnknown);

      const replyText = decision.replyText;
      const action = decision.action;

      if ((action === "reply" || replyText) && replyText?.trim()) {
        const quoted = decision.quoted ?? true;
        const mediaUrl = decision.mediaUrl;

        const sent = await sendReplyViaProvider({
          type: PROVIDER_TYPE,
          baseUrl: PROVIDER_BASE_URL,
          token: PROVIDER_TOKEN,
          to: normalized.from!, // responder para quem mandou
          text: replyText,
          quotedMessageId: quoted
            ? normalized.messageId || normalized.reply_to || undefined
            : undefined,
          mediaUrl,
        });

        if (!sent.ok) {
          return json({ ok: false, error: sent.error || "Falha ao enviar resposta" }, 502);
        }

        return json({ ok: true, mode: "sync", replied: true });
      }

      // n8n decidiu não responder
      return json({ ok: true, mode: "sync", replied: false });
    }

    // 7) Modo async: n8n é quem envia
    return json({ ok: true, mode: "async" });
  } catch (e) {
    const msg = getErrMsg(e);
    return json({ error: msg }, 500);
  }
}

// ==== Normalização ====
function normalizeIncoming(raw: unknown): Normalized {
  const r = raw as Record<string, unknown> | null;

  // Evolution-like
  const message = r && (r["message"] as Record<string, unknown> | undefined);
  if (message && (isStr(message["text"]) || isStr(message["id"]))) {
    return {
      provider: "evolution",
      instance: isStr(r?.["instance"]) ? (r!["instance"] as string) : undefined,
      from: isStr(message["from"]) ? (message["from"] as string) : undefined,
      to: isStr(message["to"]) ? (message["to"] as string) : undefined,
      text:
        (isStr(message["text"]) && (message["text"] as string)) ||
        (isStr(message["body"]) && (message["body"] as string)) ||
        (isStr(message["message"]) && (message["message"] as string)) ||
        undefined,
      timestamp: toNum(message["timestamp"]) ?? Date.now(),
      messageId: isStr(message["id"]) ? (message["id"] as string) : undefined,
      isGroup: Boolean(message["isGroup"]),
      reply_to: isStr(message["replyToMessageId"])
        ? (message["replyToMessageId"] as string)
        : null,
      raw,
    };
  }

  // Uazapi-like
  const dataObj = r && (r["data"] as Record<string, unknown> | undefined);
  if (dataObj && (dataObj["message"] || dataObj["key"])) {
    const key = dataObj["key"] as Record<string, unknown> | undefined;
    const dataMessage = dataObj["message"] as Record<string, unknown> | undefined;

    const extText =
      (dataMessage?.["extendedTextMessage"] as Record<string, unknown> | undefined)?.["text"];
    const imgCaption =
      (dataMessage?.["imageMessage"] as Record<string, unknown> | undefined)?.["caption"];

    // Narrowing seguro do quoted → stanzaId (string|null)
    const replyTo = getQuotedStanzaId((dataObj as Record<string, unknown>)["quoted"]);

    return {
      provider: "uazapi",
      instance:
        (isStr(r?.["instance"]) && (r!["instance"] as string)) ||
        (isStr(dataObj["instance"]) && (dataObj["instance"] as string)) ||
        undefined,
      from:
        (isStr(key?.["remoteJid"]) && (key!["remoteJid"] as string)) ||
        (isStr(dataObj["from"]) && (dataObj["from"] as string)) ||
        undefined,
      to:
        (isStr(key?.["participant"]) && (key!["participant"] as string)) ||
        (isStr(dataObj["to"]) && (dataObj["to"] as string)) ||
        undefined,
      text:
        (isStr(dataMessage?.["conversation"]) && (dataMessage!["conversation"] as string)) ||
        (isStr(extText) && (extText as string)) ||
        (isStr(imgCaption) && (imgCaption as string)) ||
        "",
      timestamp: toNum(dataObj["messageTimestamp"]) ?? Date.now(),
      messageId: isStr(key?.["id"]) ? (key!["id"] as string) : undefined,
      isGroup: String((key?.["remoteJid"] as string | undefined) ?? "").includes("@g.us"),
      reply_to: replyTo, // garantido string|null (sem {})
      raw,
    };
  }

  // Fallback genérico
  return {
    provider: (isStr(r?.["provider"]) && (r!["provider"] as string)) || "unknown",
    instance: isStr(r?.["instance"]) ? (r!["instance"] as string) : undefined,
    from: isStr(r?.["from"]) ? (r!["from"] as string) : undefined,
    to: isStr(r?.["to"]) ? (r!["to"] as string) : undefined,
    text:
      (isStr(r?.["text"]) && (r!["text"] as string)) ||
      (isStr(r?.["body"]) && (r!["body"] as string)) ||
      "",
    timestamp: toNum(r?.["timestamp"]) ?? Date.now(),
    messageId:
      (isStr(r?.["messageId"]) && (r!["messageId"] as string)) ||
      (isStr(r?.["id"]) && (r!["id"] as string)) ||
      undefined,
    isGroup: Boolean(r?.["isGroup"]),
    reply_to: (isStr(r?.["reply_to"]) && (r!["reply_to"] as string)) || null,
    raw,
  };
}

// ==== Enriquecimento (DB/lookup) ====
// Substitua por sua consulta real (ex.: Supabase) usando messageId/reply_to
async function lookupContext(
  messageId?: string,
  replyTo?: string | null
): Promise<ContextMeta | null> {
  void messageId;
  void replyTo;
  // Exemplo: buscar por messageId → { batchId, listaId, contato, campanha }
  // Retorne null se não achar.
  return null;
}

// ==== Envio via Provedor ====
async function sendReplyViaProvider(opts: {
  type: "evolution" | "uazapi" | "outro";
  baseUrl: string;
  token: string;
  to: string; // msisdn/jid destino
  text: string;
  quotedMessageId?: string;
  mediaUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!opts.token) return { ok: false, error: "Token do provedor ausente" };

    const base = opts.baseUrl.replace(/\/$/, "");
    const url = `${base}/messages/send`;

    if (opts.type === "evolution") {
      const body: Record<string, unknown> = {
        to: opts.to,
        text: opts.text,
      };
      if (opts.quotedMessageId) body.replyTo = opts.quotedMessageId;
      if (opts.mediaUrl) body.mediaUrl = opts.mediaUrl;

      const r = await safeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, error: `Evolution status ${r.status}` };
      return { ok: true };
    }

    if (opts.type === "uazapi") {
      const body: Record<string, unknown> = {
        chatId: opts.to, // alguns pedem jid completo ("5511999999999@s.whatsapp.net")
        text: opts.text,
      };
      if (opts.quotedMessageId) body.quotedMsgId = opts.quotedMessageId;
      if (opts.mediaUrl) body.mediaUrl = opts.mediaUrl;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: opts.token, // uazapi costuma usar header apikey
      };

      const r = await safeFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, error: `Uazapi status ${r.status}` };
      return { ok: true };
    }

    // Outro provedor — padronize aqui
    const r = await safeFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        to: opts.to,
        text: opts.text,
        replyTo: opts.quotedMessageId,
        mediaUrl: opts.mediaUrl,
      }),
    });
    if (!r.ok) return { ok: false, error: `status ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getErrMsg(e) };
  }
}

// ==== util: fetch com retry exponencial simples ====
async function safeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 2
): Promise<Response> {
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= retries) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 15000); // 15s timeout
      const res = await fetch(input, { ...init, signal: ctrl.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      lastErr = e;
      await wait(300 * Math.pow(2, attempt));
      attempt++;
    }
  }
  throw (lastErr as Error) ?? new Error("safeFetch failed");
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getErrMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" ? m : JSON.stringify(m);
  }
  try {
    return String(e);
  } catch {
    return "Unknown error";
  }
}

// ==== util: resposta JSON ====
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ==== helpers de narrowing ====
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Extrai com segurança o stanzaId (quoted → stanzaId) como string|null
function getQuotedStanzaId(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const stanza = (v as Record<string, unknown>)["stanzaId"];
  return typeof stanza === "string" ? stanza : null;
}

// ==== Coerção segura da decisão do n8n ====
function coerceDecision(d: unknown): {
  action?: "none" | "reply";
  replyText?: string;
  mediaUrl?: string;
  quoted?: boolean;
} {
  if (!d || typeof d !== "object") return {};
  const r = d as Record<string, unknown>;

  const actionRaw = r["action"];
  const action =
    actionRaw === "reply" ? "reply" : actionRaw === "none" ? "none" : undefined;

  const replyText =
    typeof r["replyText"] === "string" ? (r["replyText"] as string) : undefined;

  const mediaUrl =
    typeof r["mediaUrl"] === "string" ? (r["mediaUrl"] as string) : undefined;

  const quoted =
    typeof r["quoted"] === "boolean" ? (r["quoted"] as boolean) : undefined;

  return { action, replyText, mediaUrl, quoted };
}
