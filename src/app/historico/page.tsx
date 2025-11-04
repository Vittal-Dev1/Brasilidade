"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, RefreshCw, Search, ChevronRight, X, Loader2,
  Calendar as CalendarIcon, Download
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

/* ================== Tipos ================== */
type Historico = {
  id: number;                // batchId
  lista_id: number | null;
  total_enviado: number;     // total previsto
  data: string;              // ISO
  status?: string;           // queued|sending|sent|delivered|read|replied|error|done
  instance?: string | null;
};

export type LiveItem = {
  id: number;
  numero: string;
  status: "queued"|"sending"|"sent"|"delivered"|"read"|"replied"|"error";
  error?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  replied_at?: string | null;
};

/* ================== Utils ================== */
const cn = (...xs: (string|false|undefined|null)[]) => xs.filter(Boolean).join(" ");
const isNumStr = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);

function toISO(value: string | number | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value; // sec→ms
    return new Date(ms).toISOString();
  }
  if (isNumStr(value)) {
    const n = Number(value);
    const ms = n < 1_000_000_000_000 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
const dateNum = (isoLike: string) => {
  const n = Date.parse(isoLike);
  return Number.isFinite(n) ? n : Date.now();
};

const safeParseJSON = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return null; }
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/* ---- Canon de número ---- */
const onlyDigits = (v: string) => (v || "").replace(/\D+/g, "");
function normalizeMsisdn(raw: string): string | null {
  if (!raw) return null;
  const d = onlyDigits(String(raw)).replace(/^0+/, "");
  const withDdi = d.length === 10 || d.length === 11 ? `55${d}` : d;
  if (withDdi.length < 12 || withDdi.length > 13) return null;
  return withDdi;
}
/** Canon usado para chaves/dedupe */
function canonMsisdn(raw: string): string {
  return normalizeMsisdn(raw) || onlyDigits(String(raw)) || String(raw || "").trim();
}

/* ---- Badge de status ---- */
function StatusBadge({ value }: { value?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued:   { label: "Na fila",   cls: "bg-zinc-700/40 text-zinc-200 ring-1 ring-zinc-500/30" },
    sending:  { label: "Enviando…", cls: "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20" },
    sent:     { label: "Enviada",   cls: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20" },
    delivered:{ label: "Entregue",  cls: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20" },
    read:     { label: "Lida",      cls: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/20" },
    replied:  { label: "Respondida",cls: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20" },
    error:    { label: "Erro",      cls: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20" },
    done:     { label: "Concluída", cls: "bg-emerald-600/15 text-emerald-300 ring-1 ring-emerald-500/25" },
  };
  const info = (value && map[value]) || map.queued;
  return <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium", info.cls)}>{info.label}</span>;
}

/* ---- Soma por status (sem any) ---- */
function sumByStatus(items: LiveItem[]): Record<LiveItem["status"], number> {
  const m: Record<LiveItem["status"], number> = {
    queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, replied: 0, error: 0,
  };
  for (const it of items) {
    m[it.status] += 1;
  }
  return m;
}

/* ---- Normalizador de histórico (sem any) ---- */
function normalizeHistoricoRow(raw: unknown): Historico | null {
  if (!isObj(raw)) return null;

  const idRaw = raw["id"] ?? raw["batch_id"] ?? raw["batchId"];
  const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;

  let lista_id: number | null = null;
  if (raw["lista_id"] != null || raw["list_id"] != null) {
    const li = raw["lista_id"] ?? raw["list_id"];
    const n = typeof li === "number" ? li : Number(li);
    lista_id = Number.isFinite(n) ? n : null;
  }

  const totRaw = raw["total_enviado"] ?? raw["total"] ?? raw["count"] ?? raw["expected"] ?? 0;
  const total_enviado = typeof totRaw === "number" ? totRaw : Number(totRaw);

  const dSrc =
    raw["data"] ?? raw["created_at"] ?? raw["createdAt"] ?? raw["first_at"] ?? raw["scheduled_at"] ?? Date.now();
  const dataISO = toISO(dSrc as string | number | Date);

  const stRaw = raw["status"] ?? raw["final_status"] ?? raw["state"] ?? "";
  const status = typeof stRaw === "string" ? stRaw.trim() || undefined : undefined;

  const instanceRaw = raw["instance"] ?? raw["instance_name"] ?? null;
  const instance = (typeof instanceRaw === "string" ? instanceRaw : null) ?? null;

  return { id, lista_id, total_enviado: Number.isFinite(total_enviado) ? total_enviado : 0, data: dataISO, status, instance };
}

/* ---- Fallback Uazapi ---- */
function parseUazapiFallback(err?: string | null) {
  const s = (err ?? "").toString();
  const isFallback = /fallback/i.test(s) && /not\s*found/i.test(s);
  let url: string | null = null;

  const mJson = s.match(/\{[^}]*"url"\s*:\s*"([^"]+)"/i);
  if (mJson?.[1]) url = mJson[1];
  if (!url) {
    const mUrl = s.match(/https?:\/\/[^\s"']+/i);
    if (mUrl?.[0]) url = mUrl[0];
  }

  return { isFallback, url };
}

/* ---- Label amigável ---- */
function deriveLiveStatus(raw: LiveItem): { code: string; label: string } {
  const fb = parseUazapiFallback(raw.error);
  if ((raw.status === "sent" || raw.status === "error") && fb.isFallback) {
    return { code: "sent", label: "Enviada (fallback)" };
  }
  const map: Record<LiveItem["status"], string> = {
    queued: "Na fila",
    sending: "Enviando…",
    sent: "Enviada",
    delivered: "Entregue",
    read: "Lida",
    replied: "Respondida",
    error: "Erro",
  };
  const label = map[raw.status] ?? "Na fila";
  return { code: raw.status, label };
}

/* ---- Coalesce fallback -> sent + ranking ---- */
function coalesceStatus(it: LiveItem): LiveItem {
  const fb = parseUazapiFallback(it.error);
  if (it.status === "error" && fb.isFallback) return { ...it, status: "sent" };
  return it;
}
const STATUS_SCORE: Record<LiveItem["status"], number> = {
  error: 0, queued: 1, sending: 2, sent: 3, delivered: 4, read: 5, replied: 6,
};
function bestTimestamp(it: LiveItem): number {
  const t =
    Date.parse(it.replied_at || "") ||
    Date.parse(it.read_at || "") ||
    Date.parse(it.delivered_at || "") ||
    Date.parse(it.sent_at || "");
  return Number.isFinite(t) ? t : 0;
}
/* ---- Deduplicar por número canônico ---- */
function dedupeByNumero(arr: LiveItem[]): LiveItem[] {
  const byNum = new Map<string, LiveItem>();
  for (const raw of arr) {
    const key = canonMsisdn(raw.numero);
    if (!key) continue;

    const it = coalesceStatus(raw);
    const prev = byNum.get(key);
    if (!prev) { byNum.set(key, it); continue; }

    const a = STATUS_SCORE[it.status];
    const b = STATUS_SCORE[prev.status];
    if (a > b) { byNum.set(key, it); continue; }
    if (a < b) continue;

    if (bestTimestamp(it) >= bestTimestamp(prev)) byNum.set(key, it);
  }
  return Array.from(byNum.values());
}

/* ---- Status geral do batch (a partir de liveAug) ---- */
function deriveBatchStatus(items: LiveItem[]) {
  if (!items.length) return "queued";
  const anyQueued = items.some(i => i.status === "queued" || i.status === "sending");
  if (anyQueued) return "sending";
  const anyReplied = items.some(i => i.status === "replied");
  if (anyReplied) return "replied";
  const anyDeliveredOrBetter = items.some(i => ["sent","delivered","read","replied"].includes(i.status));
  const anyErrorOnly = items.every(i => i.status === "error");
  if (anyErrorOnly && !anyDeliveredOrBetter) return "error";
  const allTerminal = items.every(i => ["sent","delivered","read","replied","error"].includes(i.status));
  if (allTerminal) return "done";
  return "sending";
}

/* ================== Página ================== */
export default function HistoricoPage() {
  const [items, setItems] = useState<Historico[]>([]);
  const [loading, setLoading] = useState(true);

  // filtros
  const [qRaw, setQRaw] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  useEffect(() => { const t = setTimeout(()=>setQ(qRaw.trim()), 300); return ()=>clearTimeout(t); }, [qRaw]);

  // cache nomes de lista
  const [listaNames, setListaNames] = useState<Map<number, string>>(new Map());

  // drawer
  const [selected, setSelected] = useState<Historico | null>(null);

  // live (bruto) e visão aumentada
  const [live, setLive] = useState<LiveItem[]>([]);
  const [liveAug, setLiveAug] = useState<LiveItem[]>([]);
  const [liveError, setLiveError] = useState("");

  // conjunto de números ainda presentes na lista
  const [remainingSet, setRemainingSet] = useState<Set<string>>(new Set());
  const remainingSetRef = useRef<Set<string>>(new Set());
  useEffect(() => { remainingSetRef.current = remainingSet; }, [remainingSet]);

  // refs
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // transição para “saiu da lista”
  const initialRemainingRef = useRef<Set<string>>(new Set());
  const prevRemainingRef = useRef<Set<string>>(new Set());
  const remainingInitializedRef = useRef(false);

  const updateRemainingSet = useCallback((next: Set<string>) => {
    if (!remainingInitializedRef.current) {
      initialRemainingRef.current = new Set(next);
      prevRemainingRef.current = new Set(next);
      remainingInitializedRef.current = true;
    } else {
      prevRemainingRef.current = new Set(remainingSetRef.current);
    }
    setRemainingSet(next);
  }, []);

  /* ------- fetch histórico ------- */
  const fetchHistorico = useCallback(async () => {
    setLoading(true);
    const ctrl = new AbortController();
    try {
      const qs = new URLSearchParams();
      qs.set("order", "desc");
      qs.set("limit", "300");
      if (q) qs.set("q", q);
      if (status) qs.set("status", status);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);

      const res = await fetch(`/api/historico?${qs.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
        signal: ctrl.signal,
      });

      const text = await res.text();
      const parsed = safeParseJSON(text);

      let arrSrcUnknown: unknown[] = [];
      if (isObj(parsed) && Array.isArray(parsed.items)) {
        arrSrcUnknown = parsed.items as unknown[];
      } else if (Array.isArray(parsed)) {
        arrSrcUnknown = parsed as unknown[];
      }

      const arr = (arrSrcUnknown.map(normalizeHistoricoRow).filter((x): x is Historico => x !== null))
        .sort((a, b) => {
          const da = dateNum(a.data), db = dateNum(b.data);
          if (db !== da) return db - da;
          return (b.id ?? 0) - (a.id ?? 0);
        });

      setItems(arr);

      const need = Array.from(new Set(arr.map(i => i.lista_id).filter((v): v is number => typeof v === "number")));
      await Promise.all(need.map(async (id) => {
        if (listaNames.has(id)) return;
        try {
          const r = await fetch(`/api/listas/${id}`, { cache: "no-store" });
          const t = await r.text();
          const j = safeParseJSON(t);
          if (isObj(j) && typeof j.id === "number" && typeof j.nome === "string") {
            setListaNames(prev => new Map(prev).set(j.id as number, j.nome as string));
          }
        } catch { /* ignore */ }
      }));
    } finally {
      setLoading(false);
    }
    return () => ctrl.abort();
  }, [q, status, from, to, listaNames]);

  useEffect(() => { fetchHistorico(); }, [fetchHistorico]);
  useEffect(() => { const t = setInterval(fetchHistorico, 15000); return () => clearInterval(t); }, [fetchHistorico]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") fetchHistorico(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchHistorico]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "histRefresh") fetchHistorico(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [fetchHistorico]);

  /* ------- Drawer: Live (SSE + polling + lista) ------- */
  useEffect(() => {
    if (!selected) {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setLive([]); setLiveAug([]); setRemainingSet(new Set()); setLiveError("");
      remainingInitializedRef.current = false;
      initialRemainingRef.current = new Set();
      prevRemainingRef.current = new Set();
      return;
    }

    const id = selected.id;

    // buscar quem ainda está na lista (a cada 5s)
    let listTimer: ReturnType<typeof setInterval> | null = null;
    const fetchRemainingFromList = async () => {
      try {
        if (!selected?.lista_id) { updateRemainingSet(new Set()); return; }
        const r = await fetch(`/api/listas/${selected.lista_id}?only=contatos`, { cache: "no-store" });
        const t = await r.text();
        const j = safeParseJSON(t);
        const contatos = (isObj(j) && Array.isArray(j.contatos)) ? (j.contatos as unknown[]) :
                         (Array.isArray(j) ? (j as unknown[]) : []);
        const set = new Set<string>();
        for (const c of contatos) {
          if (!isObj(c)) continue;
          const nSrc = (typeof c["numero"] === "string" && c["numero"]) ||
                       (typeof c["msisdn"] === "string" && c["msisdn"]) ||
                       (typeof c["phone"] === "string" && c["phone"]) || "";
          const n = normalizeMsisdn(String(nSrc));
          if (n) set.add(n);
        }
        updateRemainingSet(set);
      } catch { /* ignore */ }
    };
    fetchRemainingFromList();
    listTimer = setInterval(fetchRemainingFromList, 5000);

    // função central: inferir "replied" (só quando sai) + fallback + dedup
    const applyAugment = (arrIn: LiveItem[]) => {
      const mapped = arrIn.map((it) => {
        if (it.status === "replied") return coalesceStatus(it);
        const key = canonMsisdn(it.numero);

        if (remainingInitializedRef.current && key) {
          const wasInList = prevRemainingRef.current.has(key) || initialRemainingRef.current.has(key);
          const isNowInList = remainingSetRef.current.has(key);
          if (wasInList && !isNowInList) {
            return coalesceStatus({
              ...it,
              status: "replied",
              replied_at: it.replied_at ?? new Date().toISOString(),
            });
          }
        }
        return coalesceStatus(it);
      });
      setLiveAug(dedupeByNumero(mapped));
    };

    // polling
    const poll = async () => {
      try {
        const r = await fetch(`/api/disparos/items?batchId=${id}`, { cache: "no-store" });
        const t = await r.text();
        const j = safeParseJSON(t);
        const arr: LiveItem[] =
          (isObj(j) && Array.isArray(j.items) ? (j.items as LiveItem[]) :
           Array.isArray(j) ? (j as LiveItem[]) : []);
        setLive(arr);
        applyAugment(arr);
        setLiveError("");
      } catch { setLiveError("Falha ao atualizar itens."); }
    };
    poll();
    const pollId = setInterval(poll, 2000);
    pollRef.current = pollId as unknown as ReturnType<typeof setInterval>;

    // SSE
    try {
      const es = new EventSource(`/api/disparos/stream?batchId=${id}`);
      esRef.current = es;
      es.addEventListener("snapshot", (ev: MessageEvent) => {
        try {
          const data = safeParseJSON(ev.data);
          if (isObj(data) && Array.isArray(data.items)) {
            const itemsArr = data.items as LiveItem[];
            setLive(itemsArr);
            applyAugment(itemsArr);
          }
          setLiveError("");
        } catch { /* ignore */ }
      });
      es.addEventListener("error", () => setLiveError("Stream indisponível — usando atualização automática."));
    } catch { /* ignore */ }

    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (listTimer) clearInterval(listTimer);
      remainingInitializedRef.current = false;
      initialRemainingRef.current = new Set();
      prevRemainingRef.current = new Set();
    };
  }, [selected, updateRemainingSet]); // deps completas e estáveis

  // reaplica augment quando o array live muda
  useEffect(() => {
    if (!live.length) { setLiveAug([]); return; }
    const mapped = live.map((it) => {
      if (it.status === "replied") return coalesceStatus(it);
      const key = canonMsisdn(it.numero);
      if (remainingInitializedRef.current && key) {
        const wasInList = prevRemainingRef.current.has(key) || initialRemainingRef.current.has(key);
        const isNowInList = remainingSetRef.current.has(key);
        if (wasInList && !isNowInList) {
          return coalesceStatus({
            ...it,
            status: "replied",
            replied_at: it.replied_at ?? new Date().toISOString(),
          });
        }
      }
      return coalesceStatus(it);
    });
    setLiveAug(dedupeByNumero(mapped));
  }, [live, remainingSet]); // inclui remainingSet como sugerido pelo ESLint

  /* ------- filtros locais (lista principal) ------- */
  const filtered = useMemo(() => {
    return items.filter((it) => {
      const hay = [
        `#${it.id}`, it.lista_id ?? "",
        listaNames.get(it.lista_id ?? -1) ?? "",
        it.instance ?? "", it.status ?? "",
      ].join(" ").toLowerCase();

      const okQ = q ? hay.includes(q.toLowerCase()) : true;
      const d = dateNum(it.data);
      const okFrom = from ? d >= new Date(from).getTime() : true;
      const okTo = to ? d <= new Date(to).getTime() + 86_400_000 - 1 : true;
      const okS = status ? it.status === status : true;
      return okQ && okFrom && okTo && okS;
    });
  }, [items, q, status, from, to, listaNames]);

  /* ------- KPIs (lista) ------- */
  const kpis = useMemo(() => {
    const total = filtered.length;
    const enviadasPrev = filtered.reduce((acc, i) => acc + (i.total_enviado || 0), 0);
    const concluidas = filtered.filter(i => ["done","replied"].includes(i.status || "")).length;
    const erros = filtered.filter(i => i.status === "error").length;
    return { total, enviadasPrev, concluidas, erros };
  }, [filtered]);

  /* ================== UI ================== */
  const StatCard = ({ title, value }: { title: string; value: string }) => (
    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/50 p-4">
      <p className="text-xs text-zinc-400">{title}</p>
      <h3 className="mt-1 text-xl font-semibold text-white">{value}</h3>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-6 pt-10 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600/25 ring-1 ring-indigo-400/30 flex items-center justify-center">
              <Clock className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Histórico de Disparos</h1>
              <p className="text-sm text-zinc-400">Acompanhe campanhas, status e resultados.</p>
            </div>
          </div>
          <button
            onClick={fetchHistorico}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-sm hover:bg-zinc-900"
          >
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Campanhas" value={String(kpis.total)} />
        <StatCard title="Mensagens prev." value={String(kpis.enviadasPrev)} />
        <StatCard title="Concluídas" value={String(kpis.concluidas)} />
        <StatCard title="Erros" value={String(kpis.erros)} />
      </div>

      {/* Filtros */}
      <div className="max-w-7xl mx-auto px-6 mt-6">
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/50 p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-xs text-zinc-400">Buscar</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <Search className="h-4 w-4 text-zinc-500" />
                <input
                  value={qRaw}
                  onChange={(e)=>setQRaw(e.target.value)}
                  placeholder="ID, Lista, Instância, Status…"
                  className="bg-transparent outline-none text-sm flex-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400">Status</label>
              <select
                value={status}
                onChange={(e)=>setStatus(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm outline-none"
              >
                <option value="">Todos</option>
                {['queued','sending','sent','delivered','read','replied','done','error'].map(s=> <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400">De</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <CalendarIcon className="h-4 w-4 text-zinc-500" />
                <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} className="bg-transparent outline-none text-sm flex-1" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400">Até</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <CalendarIcon className="h-4 w-4 text-zinc-500" />
                <input type="date" value={to} onChange={(e)=>setTo(e.target.value)} className="bg-transparent outline-none text-sm flex-1" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="max-w-7xl mx-auto px-6 mt-6">
        <div className="rounded-3xl border border-zinc-800/70 overflow-hidden bg-zinc-900/40">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60">
              <tr>
                <th className="text-left px-4 py-3">Batch</th>
                <th className="text-left px-4 py-3">Lista</th>
                <th className="text-left px-4 py-3">Total</th>
                <th className="text-left px-4 py-3">Instância</th>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"> </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-400"><Loader2 className="inline h-4 w-4 animate-spin mr-2"/>Carregando…</td></tr>
              ) : filtered.length ? (
                filtered.map((h) => {
                  const d = new Date(h.data);
                  const listName = h.lista_id ? (listaNames.get(h.lista_id) ?? `#${h.lista_id}`) : "—";
                  return (
                    <tr key={h.id} className="odd:bg-zinc-900/30">
                      <td className="px-4 py-3 font-medium">#{h.id}</td>
                      <td className="px-4 py-3">{listName}</td>
                      <td className="px-4 py-3">{h.total_enviado}</td>
                      <td className="px-4 py-3">{h.instance ?? "—"}</td>
                      <td className="px-4 py-3">{isNaN(d.getTime()) ? "—" : d.toLocaleString()}</td>
                      <td className="px-4 py-3"><StatusBadge value={h.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setSelected(h)} className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-200">
                          Ver detalhes <ChevronRight className="h-4 w-4"/>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-400">Nenhum registro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer de detalhes */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          >
            <motion.aside
              initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }}
              transition={{ type: "spring", stiffness: 280, damping: 32 }}
              className="absolute right-0 top-0 h-full w-full max-w-xl bg-zinc-950 border-l border-zinc-800 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Batch #{selected.id}</h3>
                  <p className="text-xs text-zinc-400">
                    Lista {selected.lista_id ? (listaNames.get(selected.lista_id) ?? `#${selected.lista_id}`) : "—"}
                    {" • "}
                    {new Date(selected.data).toLocaleString()}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5"/></button>
              </div>

              {/* Resumo */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl border border-zinc-800/60 p-3">
                  <p className="text-xs text-zinc-400">Total previsto</p>
                  <p className="text-xl font-semibold">{selected.total_enviado}</p>
                </div>
                <div className="rounded-xl border border-zinc-800/60 p-3">
                  <p className="text-xs text-zinc-400">Status</p>
                  <div className="mt-1"><StatusBadge value={deriveBatchStatus(liveAug)}/></div>
                </div>
              </div>

              {/* KPIs live */}
              <div className="grid grid-cols-4 gap-3 mt-4">
                {(() => {
                  const s = sumByStatus(liveAug);
                  const Box = ({t,v}:{t:string;v:number}) => (
                    <div className="rounded-xl border border-zinc-800/60 p-3">
                      <p className="text-xs text-zinc-400">{t}</p>
                      <p className="text-lg font-semibold">{v}</p>
                    </div>
                  );
                  return (
                    <>
                      <Box t="Sent" v={s.sent} />
                      <Box t="Delivered" v={s.delivered} />
                      <Box t="Read" v={s.read} />
                      <Box t="Respondidas" v={s.replied} />
                    </>
                  );
                })()}
              </div>

              {/* Gráfico */}
              <div className="rounded-2xl border border-zinc-800/60 mt-4 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-400">Andamento (ao vivo)</p>
                  <button
                    className="text-xs inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1 hover:bg-zinc-900"
                    onClick={()=>{
                      const rows = liveAug.map((x,i)=>({i:i+1, numero:x.numero, status:x.status, erro:x.error||""}));
                      const csv = ["#;numero;status;erro",
                        ...rows.map(r=>`${r.i};${r.numero};${r.status};${(r.erro||"").replaceAll?.(";"," ").replaceAll?.("\n"," ")}`),
                      ].join("\n");
                      const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `batch_${selected.id}.csv`; a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="h-3.5 w-3.5"/> Exportar CSV
                  </button>
                </div>
                <div className="h-24 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={liveAug.map((x, i) => ({
                      i,
                      v: (x.status==='sent'||x.status==='delivered'||x.status==='read'||x.status==='replied') ? 1 : (x.status==='error'? -1 : 0)
                    }))}>
                      <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {liveError && (
                  <div className="mt-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-md px-2 py-1">
                    {liveError}
                  </div>
                )}
              </div>

              {/* Lista live (deduplicada) */}
              <div className="rounded-2xl border border-zinc-800/60 mt-4 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900/60">
                    <tr>
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">Número</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveAug.length ? liveAug.map((it, idx) => {
                      const friendly = deriveLiveStatus(it);
                      const fb = parseUazapiFallback(it.error);
                      const key = `${canonMsisdn(it.numero)}-${idx}`;
                      return (
                        <tr key={key} className="odd:bg-zinc-900/30">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{it.numero}</td>
                          <td className="px-3 py-2">
                            <span className={cn(
                              "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                              friendly.code === "sent"
                                ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20"
                                : friendly.code === "error"
                                ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20"
                                : friendly.code === "replied"
                                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20"
                                : "bg-zinc-700/40 text-zinc-200 ring-1 ring-zinc-500/30"
                            )}>
                              {friendly.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-rose-300 text-xs truncate max-w-[260px]">
                            {fb.isFallback ? (
                              <span className="text-zinc-400">
                                usando fallback
                                {fb.url ? <> — <a href={fb.url} target="_blank" rel="noreferrer" className="underline text-indigo-300">ver URL</a></> : null}
                              </span>
                            ) : (it.error || "")}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={4} className="px-3 py-8 text-center text-zinc-400">Aguardando eventos…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-8" />
    </div>
  );
}
