// src/app/api/webhook/route.ts
import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ===== Helpers ===== */
const WEBHOOK_SECRET = process.env.UAZAPIGO_WEBHOOK_SECRET || "";

const ts = () => new Date().toISOString();
const onlyDigits = (n: string) => (n || "").replace(/\D/g, "");

/* ===== Tipos ===== */
type Status = "queued" | "sending" | "sent" | "delivered" | "read" | "replied" | "error" | "done";

type MessageRowStatus = { status: Status };

type ContatoRow = { numero?: string; nome?: string } & Record<string, unknown>;

type ListaRow = { id: number; contatos: unknown };

type AuditData = Record<string, unknown> | unknown;

/* ===== Acesso seguro ===== */
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function get(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key as keyof typeof cur];
  }
  return cur;
}
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asBoolean(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = asString(v);
    if (s && s.trim() !== "") return s;
  }
  return null;
}
function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = asNumber(v);
    if (n !== null) return n;
    const parsed = Number(v as unknown as string);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Normaliza para dígitos; se não vier com 55 e tiver 10–12 dígitos, prefixa 55 */
function normalizeNumero(raw?: string | null): string | null {
  if (!raw) return null;
  const d = onlyDigits(String(raw).split("@")[0]);
  if (!d) return null;
  if (d.startsWith("55")) return d;
  if (d.length >= 10 && d.length <= 12) return "55" + d;
  return d; // deixa como está se for outro DDI
}

/** Extrai número de vários formatos possíveis enviados por provedores */
function extractNumero(body: unknown): string | null {
  const candidates = [
    get(body, ["to"]),
    get(body, ["from"]),
    get(body, ["sender"]),
    get(body, ["number"]),
    get(body, ["waId"]),
    get(body, ["remoteJid"]),
    get(body, ["contact", "wa_id"]),
    get(body, ["contact", "number"]),
    get(body, ["message", "from"]),
    get(body, ["data", "to"]),
    get(body, ["data", "from"]),
  ].filter(Boolean);

  for (const c of candidates) {
    const n = normalizeNumero(String(c));
    if (n) return n;
  }
  return null;
}

/** Extrai ID da msg do provedor (para idempotência) */
function extractProviderId(body: unknown): string | null {
  const val =
    firstString(
      get(body, ["id"]),
      get(body, ["messageId"]),
      get(body, ["data", "id"]),
      get(body, ["data", "messageId"]),
      get(body, ["key", "id"]),
    ) ?? null;
  return val;
}

/** Extrai batchId se você estiver devolvendo no payload ao enviar */
function extractBatchId(body: unknown): number | null {
  const n = firstNumber(get(body, ["batchId"]), get(body, ["data", "batchId"]), get(body, ["payload", "batchId"]));
  return n && n > 0 ? n : null;
}

/** Retorna 1=sent 2=delivered 3=read quando houver */
function extractAck(body: unknown): 0 | 1 | 2 | 3 {
  const rawAck = firstNumber(get(body, ["ack"]), get(body, ["status", "ack"]), get(body, ["data", "ack"]));
  if (rawAck === 1 || rawAck === 2 || rawAck === 3) return rawAck;
  return 0;
}

/** Diz se a mensagem veio “de mim” (enviada pela nossa conta) */
function extractFromMe(body: unknown): boolean {
  return Boolean(
    asBoolean(get(body, ["fromMe"])) ??
      asBoolean(get(body, ["data", "fromMe"])) ??
      asBoolean(get(body, ["key", "fromMe"]))
  );
}

/** Detecta se é resposta de cliente / texto inbound */
function detectInboundText(body: unknown, fromMe: boolean): boolean {
  if (fromMe) return false;
  return Boolean(
    get(body, ["text"]) ||
      get(body, ["message", "text"]) ||
      get(body, ["content"]) ||
      get(body, ["message", "conversation"]) ||
      get(body, ["data", "message", "text"])
  );
}

/** Se for reply, tenta achar a msg original */
function extractReplyToId(body: unknown): string | null {
  const val =
    firstString(
      get(body, ["quotedMsgId"]),
      get(body, ["context", "id"]),
      get(body, ["message", "contextInfo", "stanzaId"]),
      get(body, ["data", "context", "id"])
    ) ?? null;
  return val;
}

/** Insere um registro em message_events (auditoria), sempre */
async function auditEvent(messageId: number | null, kind: string, data: AuditData) {
  await supabase.from("message_events").insert({
    message_id: messageId,
    kind,
    data,
    created_at: ts(),
  });
}

/** Tenta atualizar status agregado do batch quando possível */
async function maybeUpdateBatchStatus(batchId: number) {
  if (!batchId) return;
  const { data, error } = await supabase
    .from("messages")
    .select("status", { count: "exact" })
    .eq("batch_id", batchId);

  if (error || !data) return;

  // Não precisamos de 'queued' para a decisão final, então não contamos para evitar warning de variável não usada
  let sending = 0,
    sent = 0,
    delivered = 0,
    read = 0,
    replied = 0,
    errorCount = 0;

  for (const m of data as MessageRowStatus[]) {
    switch (m.status) {
      case "sending":
        sending++;
        break;
      case "sent":
        sent++;
        break;
      case "delivered":
        delivered++;
        break;
      case "read":
        read++;
        break;
      case "replied":
        replied++;
        break;
      case "error":
        errorCount++;
        break;
      // 'queued' e 'done' não entram no cálculo de progresso
    }
  }

  const total = data.length;
  const progressed = sent + delivered + read + replied + errorCount;

  let status: Status = "queued";
  if (replied > 0) status = "replied";
  else if (read > 0) status = "read";
  else if (delivered > 0) status = "delivered";
  else if (sent > 0) status = "sent";
  else if (sending > 0) status = "sending";
  else status = "queued";

  // done quando todos saíram de queued/sending
  if (progressed === total && total > 0) status = "done";

  await supabase.from("batches").update(
    {
      status,
      updated_at: ts(),
    }
  ).eq("id", batchId);
}

/** Remove número das listas quando respondeu */
async function removeFromLists(numero: string) {
  const { data: listas } = await supabase.from("listas_disparos").select("id, contatos");
  for (const lista of (listas as unknown as ListaRow[]) || []) {
    const contatos = Array.isArray(lista.contatos) ? (lista.contatos as ContatoRow[]) : [];
    const hasNumber = contatos.some((c) => onlyDigits(String(c.numero ?? "")) === numero);
    if (!hasNumber) continue;

    const filtrados = contatos.filter((c) => onlyDigits(String(c.numero ?? "")) !== numero);
    const nome = (contatos.find((c) => onlyDigits(String(c.numero ?? "")) === numero)?.nome) ?? null;

    await supabase.from("listas_disparos").update({ contatos: filtrados }).eq("id", lista.id);
    await supabase.from("contatos_removidos").insert({
      numero,
      nome,
      motivo: "respondeu",
      lista_id: lista.id,
      created_at: ts(),
    });
  }
}

/** ===== Handler ===== */
export async function POST(req: Request) {
  try {
    if (WEBHOOK_SECRET) {
      const h = req.headers.get("x-webhook-secret") || "";
      if (h !== WEBHOOK_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const raw: unknown = await req.json().catch(() => ({} as unknown));
    const events: unknown[] = Array.isArray(raw) ? raw : [raw];

    for (const body of events) {
      const fromMe = extractFromMe(body);
      const numero = extractNumero(body);
      const providerId = extractProviderId(body);
      const batchId = extractBatchId(body);
      const ack = extractAck(body);
      const isInboundText = detectInboundText(body, fromMe);
      const replyTo = extractReplyToId(body);

      // Auditar bruto sem vincular (pode ajudar em debugging)
      await auditEvent(null, "webhook_raw", body as AuditData);

      // 1) Resposta do cliente (texto inbound)
      if (isInboundText && numero) {
        // Se foi reply a uma msg nossa, marque como replied
        if (replyTo) {
          const { data: msg } = await supabase
            .from("messages")
            .select("id, batch_id")
            .eq("provider_message_id", replyTo)
            .maybeSingle<{ id: number; batch_id: number | null }>();

          if (msg?.id) {
            await supabase.from("messages").update({
              status: "replied",
              replied_at: ts(),
            }).eq("id", msg.id);

            await auditEvent(msg.id, "reply", body as AuditData);

            if (msg.batch_id) await maybeUpdateBatchStatus(msg.batch_id);
            await removeFromLists(numero);
            continue;
          }
        }

        // Se não há replyTo, registre como inbound "solta" (nova conversa)
        const { data: created, error } = await supabase.from("messages").insert({
          batch_id: batchId ?? null,
          numero,
          status: "replied",
          replied_at: ts(),
          direction: "inbound",
          provider_message_id: providerId ?? null,
          payload: { meta: { source: "webhook-inbound" }, raw: body },
          created_at: ts(),
        }).select("id, batch_id").single<{ id: number; batch_id: number | null }>();

        if (!error && created?.id) {
          await auditEvent(created.id, "inbound", body as AuditData);
          if (created.batch_id) await maybeUpdateBatchStatus(created.batch_id);
          await removeFromLists(numero);
        }
        continue;
      }

      // 2) Eventos de msg “minha” (acks / erro etc.)
      if (fromMe && providerId) {
        const { data: msg } = await supabase
          .from("messages")
          .select("id, batch_id, status")
          .eq("provider_message_id", providerId)
          .maybeSingle<{ id: number; batch_id: number | null; status: Status }>();

        if (!msg?.id) {
          // sem correspondência — opcional: criar esqueleto
          // útil quando o provedor manda ack antes do insert local
          const { data: created } = await supabase.from("messages").insert({
            batch_id: batchId ?? null,
            numero: numero ?? null,
            status: "sending",
            direction: "outbound",
            provider_message_id: providerId,
            payload: { meta: { source: "webhook-ack" }, raw: body },
            created_at: ts(),
          }).select("id, batch_id").single<{ id: number; batch_id: number | null }>();

          if (created?.id) {
            await auditEvent(created.id, "ack_skipped_seed", body as AuditData);
            if (created.batch_id) await maybeUpdateBatchStatus(created.batch_id);
          }
          continue;
        }

        // Atualiza conforme ack/erro
        if (ack === 1) {
          await supabase.from("messages").update({ status: "sent", sent_at: ts() }).eq("id", msg.id);
          await auditEvent(msg.id, "ack", body as AuditData);
        } else if (ack === 2) {
          await supabase.from("messages").update({ status: "delivered", delivered_at: ts() }).eq("id", msg.id);
          await auditEvent(msg.id, "delivered", body as AuditData);
        } else if (ack === 3) {
          await supabase.from("messages").update({ status: "read", read_at: ts() }).eq("id", msg.id);
          await auditEvent(msg.id, "read", body as AuditData);
        } else if (
          get(body, ["type"]) === "message_failed" ||
          get(body, ["status"]) === "error" ||
          Boolean(get(body, ["error"]))
        ) {
          const errMsg =
            firstString(get(body, ["error", "message"]), get(body, ["error"])) || "send failed";
          await supabase
            .from("messages")
            .update({ status: "error", error: errMsg })
            .eq("id", msg.id);
          await auditEvent(msg.id, "error", body as AuditData);
        } else {
          // sem ack numérico — audita genérico
          await auditEvent(msg.id, "provider_event", body as AuditData);
        }

        if (msg.batch_id) await maybeUpdateBatchStatus(msg.batch_id);
        continue;
      }

      // 3) Sem número/sem providerId — audita e segue
      await auditEvent(null, "ignored", body as AuditData);
    }

    return NextResponse.json({ ok: true });
 } catch (e: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.error("💥 WEBHOOK ERRO:", e instanceof Error ? e.message : String(e));
  }
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Erro interno" },
    { status: 500 }
  );
}
}
