// lib/historyStore.ts
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

export type BatchStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "replied" | "error" | "done";

export type LiveItem = {
  id: number;
  numero: string;
  status: Exclude<BatchStatus, "done">;
  error?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  replied_at?: string | null;
};

export type Historico = {
  id: number;           // batchId
  lista_id: number | null;
  total_enviado: number;
  data: string;         // ISO
  status: BatchStatus;
  instance?: string | null;
};

type DBShape = {
  lastBatchId: number;
  batches: Historico[];
  items: Record<number, LiveItem[]>; // by batchId
};

const DATA_FILE = process.env.HIST_STORE_FILE || path.join(process.cwd(), "var", "disparos.json");
const dir = path.dirname(DATA_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function nowISO() {
  return new Date().toISOString();
}

function safeLoad(): DBShape {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const j = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return { lastBatchId: j.lastBatchId || 0, batches: j.batches || [], items: j.items || {} };
    }
  } catch {}
  return { lastBatchId: 0, batches: [], items: {} };
}

const db: DBShape = safeLoad(); // <- prefer-const resolvido
function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("historyStore persist error:", e);
  }
}

export const bus = new EventEmitter(); // emite "batch:update:{id}"

export function listBatches() {
  return db.batches.slice();
}

export function getBatch(id: number) {
  return db.batches.find((b) => b.id === id) || null;
}

export function listItems(batchId: number) {
  return db.items[batchId] ? db.items[batchId].slice() : [];
}

function recalcBatchStatus(batchId: number): BatchStatus {
  const arr = db.items[batchId] || [];
  if (arr.length === 0) return "queued";
  const hasError = arr.some((i) => i.status === "error");
  const allReplied = arr.length > 0 && arr.every((i) => i.status === "replied");
  const allFinal =
    arr.length > 0 && arr.every((i) => ["replied", "read", "delivered", "sent", "error"].includes(i.status));
  if (allReplied) return "replied";
  if (hasError && allFinal) return "error";
  // status “mais alto” observado
  if (arr.some((i) => i.status === "read")) return "read";
  if (arr.some((i) => i.status === "delivered")) return "delivered";
  if (arr.some((i) => i.status === "sent")) return "sent";
  if (arr.some((i) => i.status === "sending")) return "sending";
  return "queued";
}

export function createBatch(params: {
  lista_id: number | null;
  total_enviado: number;
  instance?: string | null;
  contacts: { numero: string }[];
}) {
  const id = ++db.lastBatchId;
  const batch: Historico = {
    id,
    lista_id: params.lista_id ?? null,
    total_enviado: params.total_enviado,
    data: nowISO(),
    status: "queued",
    instance: params.instance ?? null,
  };
  db.batches.push(batch);

  db.items[id] = (params.contacts || []).map((c, idx) => ({
    id: idx + 1,
    numero: String(c.numero),
    status: "queued",
  }));

  persist();
  bus.emit(`batch:update:${id}`, { items: listItems(id) });
  return id;
}

export function setItemStatus(
  batchId: number,
  numero: string,
  status: LiveItem["status"],
  error?: string | null,
  stamps?: Partial<Pick<LiveItem, "sent_at" | "delivered_at" | "read_at" | "replied_at">>
) {
  const arr = db.items[batchId] || [];
  const it = arr.find((x) => x.numero === numero);
  if (!it) {
    // cria se não existir
    const newItem: LiveItem = { id: arr.length + 1, numero, status, error: error ?? null };
    db.items[batchId] = [...arr, newItem];
  } else {
    it.status = status;
    if (error !== undefined) it.error = error;
    if (stamps?.sent_at) it.sent_at = stamps.sent_at;
    if (stamps?.delivered_at) it.delivered_at = stamps.delivered_at;
    if (stamps?.read_at) it.read_at = stamps.read_at;
    if (stamps?.replied_at) it.replied_at = stamps.replied_at;
  }

  // recalcula status do batch
  const b = getBatch(batchId);
  if (b) {
    b.status = recalcBatchStatus(batchId);
  }
  persist();
  bus.emit(`batch:update:${batchId}`, { items: listItems(batchId) });
}

export function setBatchSending(batchId: number) {
  const b = getBatch(batchId);
  if (!b) return;
  b.status = "sending";
  persist();
  bus.emit(`batch:update:${batchId}`, { items: listItems(batchId) });
}
