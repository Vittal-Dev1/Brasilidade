"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileImage, RefreshCw, Send, PlusCircle, Trash2, Loader2,
  CheckCircle2, TriangleAlert, Eye, Moon, SunMedium, ChevronDown, ListChecks,
  Info, ImagePlus, Link as LinkIcon, GripVertical, Sparkles,
} from "lucide-react";

/* ================== Tipos ================== */
type Row = Record<string, string>; // contatos vindos do backend (lista salva)
type ListaResumo = { id: number; nome: string; created_at?: string };
type TemplateVariation = { base: string; variations: string[] };

type MediaItem = {
  id: string;
  url: string;       // preenchida após upload
  mime: string;
  filename: string;
  size?: number;
  captions: TemplateVariation[]; // legenda opcional
  uploading?: boolean;
  error?: string | null;
};

type DelayUnit = "ms" | "s" | "min";
type ListaCarregada = { id: number; nome: string; contatos: Row[] };
type Contact = Row & { numero: string };

/* ================== Helpers ================== */
const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");
const onlyDigits = (v: string) => (v || "").replace(/\D+/g, "");

// aceita valores indefinidos/unknown sem quebrar tipagem
function normalizeMsisdn(raw: unknown): string | null {
  const d = onlyDigits(String(raw ?? "")).replace(/^0+/, "");
  const withDdi = d.length === 10 || d.length === 11 ? `55${d}` : d;
  if (withDdi.length < 12 || withDdi.length > 13) return null;
  return withDdi;
}
function toMs(value: number, unit: DelayUnit): number {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  if (unit === "s") return Math.round(v * 1000);
  if (unit === "min") return Math.round(v * 60_000);
  return Math.round(v);
}

// Janela 08:00–18:00
const START_HOUR = 8;
const END_HOUR = 18;
function setTime(date: Date, h: number, m = 0, s = 0, ms = 0) {
  const d = new Date(date);
  d.setHours(h, m, s, ms);
  return d;
}
function nextStartWithinWindow(from = new Date()): Date {
  const d = new Date(from);
  const start = setTime(d, START_HOUR);
  const end = setTime(d, END_HOUR);
  if (d < start) return start;
  if (d >= start && d < end) return d;
  const tomorrow = new Date(d);
  tomorrow.setDate(d.getDate() + 1);
  return setTime(tomorrow, START_HOUR);
}

/* ================== UI bits ================== */
function Section({
  title, subtitle, icon: Icon, children, collapsible = true, defaultOpen = true, badge,
}: {
  title: string; subtitle?: string; icon?: React.ElementType<{ className?: string }>;
  children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/2 transition rounded-3xl"
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20">
              <Icon className="h-4 w-4 text-violet-300" />
            </div>
          )}
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
            {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {badge}
          {collapsible && (
            <ChevronDown className={cx("h-5 w-5 text-zinc-400 transition-transform", open && "rotate-180")} />
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="px-5 pb-5"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100",
        "placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-violet-500/60",
        props.className
      )}
    />
  );
}
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100",
        "placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-violet-500/60",
        props.className
      )}
    />
  );
}
function GhostButton({
  className, type = "button", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { type?: "button" | "submit" | "reset" }) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        "inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm hover:bg-white/5 text-zinc-200",
        className
      )}
    />
  );
}
function PrimaryButton({
  className, type = "button", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { type?: "button" | "submit" | "reset" }) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white",
        "bg-gradient-to-br from-violet-600 to-fuchsia-600 hover:brightness-110 disabled:opacity-60",
        className
      )}
    />
  );
}

/* ================== Página ================== */
export default function EnvioArquivosPage() {
  const [dark, setDark] = useState(true);
  const [loading, setLoading] = useState(false);

  // progresso fake (UX) enquanto espera resposta
  const [progress, setProgress] = useState(0);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSim = () => { if (simRef.current) { clearInterval(simRef.current); simRef.current = null; } };
  const startSim = (until = 90, step = 2, everyMs = 120) => {
    stopSim();
    setProgress((p) => (p > 0 && p < until ? p : 1));
    simRef.current = setInterval(() => setProgress((p) => (p < until ? p + step : p)), everyMs);
  };
  const completeProgress = (resetDelayMs = 800) => { stopSim(); setProgress(100); setTimeout(() => setProgress(0), resetDelayMs); };

  // toast
  const [toast, setToast] = useState<null | { type: "ok" | "err"; text: string }>(null);
  const showOk = (text: string) => setToast({ type: "ok", text });
  const showErr = (text: string) => setToast({ type: "err", text });

  // contatos (da lista)
  const [rows, setRows] = useState<Row[]>([]);
  const csvKeys = useMemo(() => Object.keys(rows[0] || {}), [rows]);

  // listas
  const [listas, setListas] = useState<ListaResumo[]>([]);
  const [listaNome, setListaNome] = useState("");
  const [listaSelecionada, setListaSelecionada] = useState<number | null>(null);

  // delay / janela / cadência
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("ms");
  const [delayMin, setDelayMin] = useState(1000);
  const [delayMax, setDelayMax] = useState(5000);
  const [pauseEvery, setPauseEvery] = useState(20);
  const [pauseDurationMin, setPauseDurationMin] = useState(10);
  const [cadence, setCadence] = useState<number[]>([]);
  const toggleCadence = (d: number) =>
    setCadence((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  // mídia
  const [media, setMedia] = useState<MediaItem[]>([]);
  const addMediaItem = (m: MediaItem) => setMedia((prev) => [...prev, m]);
  const removeMediaItem = (id: string) => setMedia((prev) => prev.filter((m) => m.id !== id));
  const moveMedia = (from: number, to: number) => {
    setMedia((prev) => {
      const arr = [...prev];
      const [it] = arr.splice(from, 1);
      arr.splice(to, 0, it);
      return arr;
    });
  };

  // IA opcional para legenda
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInstruction, setAiInstruction] = useState(
    "Escreva uma legenda curta e objetiva para WhatsApp. Sem emojis. Máx. 200 caracteres. Use variáveis se existirem (ex.: {{nome}})."
  );
  const [aiLoading, setAiLoading] = useState(false);

  const previewRow: Row = useMemo(
    () => rows[0] || { nome: "Fulano", numero: "11999998888", cidade: "Vitória da Conquista" },
    [rows]
  );

  /* ================== Fetch listas ================== */
  const fetchListas = useCallback(async () => {
    try {
      const res = await fetch("/api/listas", { cache: "no-store" });
      const data = (await res.json()) as ListaResumo[] | { error?: string };
      if (Array.isArray(data)) setListas(data);
    } catch (e: unknown) {
      console.error(e);
    }
  }, []);
  useEffect(() => { fetchListas(); }, [fetchListas]);

  const carregarLista = useCallback(async (id: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/listas/${id}`, { cache: "no-store" });
      const txt = await res.text();
      const data = JSON.parse(txt) as ListaCarregada | { error?: string };
      if (!res.ok) {
        const errMsg = "error" in data && data.error ? data.error : "Falha ao carregar lista";
        throw new Error(errMsg);
      }
      const lista = data as ListaCarregada;
      setRows(Array.isArray(lista.contatos) ? lista.contatos : []);
      setListaNome(lista.nome || "");
      setListaSelecionada(lista.id);
      showOk(`Lista #${lista.id} carregada (${lista.contatos?.length ?? 0} contatos)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showErr(msg || "Erro ao carregar lista");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ================== Upload robusto (qualquer tipo) ================== */
  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;

    for (const f of Array.from(files)) {
      const id = crypto.randomUUID();
      const preliminary: MediaItem = {
        id,
        url: "",
        mime: f.type || "application/octet-stream",
        filename: f.name,
        size: f.size,
        captions: [{ base: "", variations: [] }],
        uploading: true,
        error: null,
      };
      addMediaItem(preliminary);

      try {
        const fd = new FormData();
        fd.append("file", f);

        const resp = await fetch("/api/upload", { method: "POST", body: fd });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(text || `HTTP ${resp.status}`);
        }

        const ct = resp.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await resp.text().catch(() => "");
          throw new Error(
            "Upload retornou um conteúdo inesperado (não-JSON)." +
              (text ? ` Trecho: ${text.slice(0, 180)}...` : "")
          );
        }

        const j = (await resp.json()) as Partial<Pick<MediaItem, "url" | "mime" | "filename" | "size">>;
        if (!j?.url) throw new Error("Resposta sem URL de arquivo.");

        setMedia((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  url: j.url!,
                  mime: j.mime || m.mime,
                  filename: j.filename || m.filename,
                  size: typeof j.size === "number" ? j.size : m.size,
                  uploading: false,
                  error: null,
                }
              : m
          )
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setMedia((prev) =>
          prev.map((m) => (m.id === id ? { ...m, uploading: false, error: msg || "Falha no upload" } : m))
        );
        showErr(`Falha ao enviar ${f.name}: ${msg || ""}`);
      }
    }
  };

  /* ================== Legendas (variáveis e IA) ================== */
  const addCaptionVar = (mIdx: number, capIdx: number, v: string, isVariation = false, vIdx?: number) => {
    setMedia((prev) => {
      const next = [...prev];
      const ins = `{{${v}}}`;
      const item = next[mIdx];
      const cap = item.captions[capIdx];
      if (!isVariation) {
        const msg = cap.base || "";
        cap.base = msg + (msg.endsWith(" ") || msg.endsWith("\n") ? "" : " ") + ins;
      } else if (typeof vIdx === "number") {
        const msg = cap.variations[vIdx] || "";
        cap.variations[vIdx] = msg + (msg.endsWith(" ") || msg.endsWith("\n") ? "" : " ") + ins;
      }
      next[mIdx] = { ...item, captions: [...item.captions] };
      return next;
    });
  };

  const renderCaptionPreview = (tpl: TemplateVariation) => {
    const pool = [tpl.base, ...tpl.variations].filter((t) => t && t.trim() !== "");
    const txt = pool.length ? pool[0] : "";
    let out = txt;
    for (const k of Object.keys(previewRow || {})) {
      out = out.replaceAll(`{{${k}}}`, String(previewRow?.[k] ?? `{{${k}}}`));
    }
    return out;
  };

  const generateCaptionWithAI = async (mIdx: number, capIdx: number) => {
    setAiLoading(true);
    try {
      const prompt = [
        "Você é um copywriter de WhatsApp. Gere UMA legenda curta e objetiva.",
        "Sem emojis. Máx. 200 caracteres. Apenas o texto final.",
        "",
        "Diretriz:",
        aiInstruction,
        "",
        "Dados do contato (exemplo):",
        JSON.stringify(previewRow, null, 2),
      ].join("\n");

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: "gpt-4o-mini" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { message?: string };
      const msg = (j?.message || "").toString().trim();
      if (!msg) throw new Error("Retorno vazio da IA");

      setMedia((prev) => {
        const next = [...prev];
        const item = next[mIdx];
        const cap = item.captions[capIdx];
        cap.variations = [...cap.variations, msg];
        next[mIdx] = { ...item, captions: [...item.captions] };
        return next;
      });
      showOk("Legenda gerada e adicionada às variações");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showErr(msg || "Erro ao gerar legenda");
    } finally {
      setAiLoading(false);
    }
  };

  /* ================== Envio ================== */
  const submitCommon = () => {
    const normalized: Contact[] = rows.reduce<Contact[]>((acc, r) => {
      const n = normalizeMsisdn(r.numero);
      if (n) acc.push({ ...r, numero: n });
      return acc;
    }, []);

    if (!listaSelecionada || !normalized.length) {
      showErr("Selecione uma lista válida com contatos.");
      return null;
    }
    if (!media.length) {
      showErr("Adicione ao menos um arquivo.");
      return null;
    }
    const anyUploading = media.some((m) => m.uploading);
    if (anyUploading) {
      showErr("Aguarde os uploads terminarem antes de enviar.");
      return null;
    }
    const invalid = media.find((m) => !m.url || m.error);
    if (invalid) {
      showErr(`Arquivo com erro: ${invalid.filename}`);
      return null;
    }

    const minMs = toMs(Math.max(0, Math.min(delayMin, delayMax)), delayUnit);
    const maxMs = toMs(Math.max(delayMin, delayMax), delayUnit);
    const pauseMs = Math.max(0, pauseDurationMin) * 60 * 1000;
    const startAtMs = nextStartWithinWindow(new Date()).getTime();

    return {
      listaId: listaSelecionada,
      listaNome,
      contacts: normalized, // Contact[]
      startAtMs,
      cadenceDays: cadence,
      delayMsMin: minMs,
      delayMsMax: maxMs,
      pauseEvery: Math.max(0, pauseEvery),
      pauseDurationMs: pauseMs,
      media: media.map((m) => ({
        url: m.url,
        mime: m.mime,
        filename: m.filename,
        size: m.size,
        captions: m.captions,
      })),
    };
  };

  const handleSend = async () => {
    const payload = submitCommon();
    if (!payload) return;

    setLoading(true);
    startSim(92);
    try {
      const res = await fetch("/api/disparos-arquivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt);
      const j = JSON.parse(txt) as { ok: boolean; batchId?: number };
      if (!j.ok) throw new Error("Falha ao iniciar disparos");
      showOk(`📤 Disparos de arquivos iniciados (batch #${j.batchId ?? "—"})`);
      completeProgress();
    } catch (e: unknown) {
      stopSim(); setProgress(0);
      const msg = e instanceof Error ? e.message : String(e);
      showErr(msg || "Falha no disparo");
    } finally {
      setLoading(false);
    }
  };

  const delayUnitLabel = (u: DelayUnit) => (u === "ms" ? "ms" : u === "s" ? "s" : "min");

  /* ================== Render ================== */
  return (
    <div className="min-h-dvh bg-[radial-gradient(1200px_800px_at_20%_-10%,rgba(139,92,246,0.14),transparent),radial-gradient(1000px_700px_at_120%_10%,rgba(236,72,153,0.10),transparent)] bg-zinc-950">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-white/10 backdrop-blur bg-zinc-950/70">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600" />
            <div>
              <h1 className="text-lg font-semibold text-white">Disparador de Arquivos</h1>
              <p className="text-[11px] text-zinc-400">Envio de mídia (imagens, PDFs, ZIP, EXE, etc.) para listas salvas</p>
            </div>
          </div>
          <GhostButton onClick={() => setDark((d) => !d)} title={dark ? "Tema claro" : "Tema escuro"}>
            {dark ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            Tema
          </GhostButton>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-28 space-y-8">
        {/* 1) Lista */}
        <Section
          title="1) Lista"
          subtitle="Selecione uma lista salva. Esta página não usa planilha."
          icon={ListChecks}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Selecionar lista salva">
              <div className="relative">
                <select
                  className="w-full appearance-none rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 focus:ring-2 focus:ring-violet-500/60"
                  value={listaSelecionada ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id) carregarLista(id);
                  }}
                  disabled={loading}
                >
                  <option value="">— Escolha uma lista —</option>
                  {listas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} (#{l.id})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => listaSelecionada && carregarLista(listaSelecionada)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500"
                  title="Recarregar"
                  disabled={loading || !listaSelecionada}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </Field>

            <Field label="Nome da lista (opcional)">
              <Input
                value={listaNome}
                onChange={(e) => setListaNome(e.target.value)}
                placeholder="Ex.: Campanha Novembro"
              />
            </Field>
          </div>

          {csvKeys.length > 0 && (
            <div className="mt-3 text-[11px] text-zinc-400 flex items-center gap-2">
              <Info className="h-3.5 w-3.5" />
              Variáveis disponíveis (vindas da lista):&nbsp;
              <span className="text-zinc-300">{csvKeys.map((k) => `{{${k}}}`).join(", ")}</span>
            </div>
          )}
        </Section>

        {/* 2) Arquivos + legendas */}
        <Section
          title="2) Arquivos"
          subtitle="Selecione qualquer arquivo (imagens, documentos, zip, executáveis, etc.). Legenda é opcional."
          icon={FileImage}
          badge={
            aiEnabled ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-violet-600/20 text-violet-200 border border-violet-500/30">
                <Sparkles className="h-3 w-3" /> IA legendas
              </span>
            ) : null
          }
        >
          {/* IA toggle */}
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 mb-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-violet-600/20">
                  <Sparkles className="h-4 w-4 text-violet-300" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">IA para gerar variações de legenda (opcional)</h4>
                  <p className="text-xs text-zinc-400">Gere sugestões curtas e adicione às variações.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-300">Habilitar</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={aiEnabled}
                  onClick={() => setAiEnabled(!aiEnabled)}
                  className={cx("relative inline-flex h-6 w-11 items-center rounded-full transition", aiEnabled ? "bg-violet-600" : "bg-zinc-700")}
                >
                  <span className={cx("inline-block h-5 w-5 transform rounded-full bg-white transition", aiEnabled ? "translate-x-5" : "translate-x-1")} />
                </button>
              </div>
            </div>
            {aiEnabled && (
              <div className="mt-3">
                <Field label="Instrução (prompt)">
                  <Textarea rows={2} value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)} />
                </Field>
              </div>
            )}
          </div>

          {/* picker */}
          <div className="flex flex-wrap gap-2 mb-4">
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl px-3 py-2 bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white text-sm font-medium hover:brightness-110">
              <ImagePlus className="h-4 w-4" /> Selecionar arquivos
              <input type="file" className="hidden" multiple onChange={(e) => onPickFiles(e.target.files)} />
            </label>
          </div>

          {/* grid de mídia */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {media.map((m, mIdx) => (
              <div key={m.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <GripVertical className="h-4 w-4 text-zinc-500" />
                    Arquivo {mIdx + 1} • <span className="text-zinc-400">{m.filename}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <GhostButton onClick={() => moveMedia(mIdx, Math.max(0, mIdx - 1))} disabled={mIdx === 0}>↑</GhostButton>
                    <GhostButton onClick={() => moveMedia(mIdx, Math.min(media.length - 1, mIdx + 1))} disabled={mIdx === media.length - 1}>↓</GhostButton>
                    <button className="text-rose-400 hover:text-rose-300" onClick={() => removeMediaItem(m.id)} title="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* preview seguro */}
                <div className="rounded-xl border border-white/10 overflow-hidden mb-3 bg-black/20">
                  {m.mime.startsWith("image/") && m.url ? (
                    <Image
                      src={m.url}
                      alt={m.filename}
                      width={800}
                      height={224}
                      unoptimized
                      className="w-full h-56 object-cover"
                    />
                  ) : m.uploading ? (
                    <div className="p-4 text-sm text-zinc-300 flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Enviando {m.filename}...
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-zinc-300 flex items-center gap-2">
                      <FileImage className="h-5 w-5" />
                      {m.mime || "arquivo"} — {m.filename}
                      {m.url && (
                        <a href={m.url} target="_blank" className="ml-auto text-violet-300 inline-flex items-center gap-1" rel="noreferrer">
                          <LinkIcon className="h-4 w-4" /> abrir
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {m.uploading && (
                  <div className="text-xs text-amber-300 mb-3 inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                  </div>
                )}
                {m.error && (
                  <div className="text-xs text-rose-300 mb-3 inline-flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4" /> {m.error}
                  </div>
                )}

                {/* legendas */}
                {m.captions.map((cap, capIdx) => (
                  <div key={capIdx} className="rounded-xl border border-white/10 p-3 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-zinc-400">Legenda {capIdx + 1} (opcional)</span>
                      <div className="flex gap-2">
                        {aiEnabled && (
                          <GhostButton onClick={() => generateCaptionWithAI(mIdx, capIdx)} disabled={aiLoading}>
                            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            Gerar com IA
                          </GhostButton>
                        )}
                        <GhostButton
                          onClick={() => {
                            setMedia((prev) => {
                              const next = [...prev];
                              next[mIdx].captions.push({ base: "", variations: [] });
                              return next;
                            });
                          }}
                        >
                          <PlusCircle className="h-4 w-4" /> Nova legenda
                        </GhostButton>
                      </div>
                    </div>

                    {/* variáveis rápidas */}
                    {csvKeys.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs text-zinc-400">Variáveis:</span>
                        {[..."nome numero".split(" "), ...csvKeys.filter((k) => !["nome", "numero"].includes(k)).slice(0, 8)].map(
                          (k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => addCaptionVar(mIdx, capIdx, k)}
                              className={cx(
                                "px-2 py-0.5 rounded-lg text-xs",
                                ["nome", "numero"].includes(k)
                                  ? "bg-violet-600 text-white hover:brightness-110"
                                  : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                              )}
                              title={`Inserir {{${k}}}`}
                            >
                              {`{{${k}}}`}
                            </button>
                          )
                        )}
                      </div>
                    )}

                    <Textarea
                      rows={2}
                      value={cap.base}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMedia((prev) => {
                          const next = [...prev];
                          next[mIdx].captions[capIdx] = { ...cap, base: v };
                          return next;
                        });
                      }}
                      placeholder="Legenda base (opcional)"
                    />

                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-400">Variações (aleatórias)</span>
                        <button
                          type="button"
                          onClick={() => {
                            setMedia((prev) => {
                              const next = [...prev];
                              next[mIdx].captions[capIdx] = {
                                ...cap,
                                variations: [...(cap.variations || []), ""],
                              };
                              return next;
                            });
                          }}
                          className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
                        >
                          <PlusCircle className="h-4 w-4" /> Adicionar
                        </button>
                      </div>

                      {(cap.variations || []).map((vv, vIdx) => (
                        <div key={vIdx} className="flex gap-2 mt-2">
                          <Textarea
                            rows={2}
                            value={vv}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMedia((prev) => {
                                const next = [...prev];
                                next[mIdx].captions[capIdx].variations[vIdx] = val;
                                return next;
                              });
                            }}
                            placeholder={`Variação ${vIdx + 1}`}
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setMedia((prev) => {
                                const next = [...prev];
                                next[mIdx].captions[capIdx].variations =
                                  next[mIdx].captions[capIdx].variations.filter((_, ii) => ii !== vIdx);
                                return next;
                              });
                            }}
                            className="text-rose-400 hover:text-rose-300"
                            title="Remover"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* preview legenda */}
                    <div className="mt-3 rounded-xl border border-white/10 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Eye className="h-4 w-4 text-zinc-400" />
                        <p className="text-xs text-zinc-400">Exemplo (contato 1)</p>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm text-zinc-200">{renderCaptionPreview(cap)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        {/* 3) Envio */}
        <Section title="3) Envio" subtitle="Janela 08:00–18:00 • Cadência opcional" icon={ListChecks}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Field label="Unidade do delay" hint="Aplica-se ao min e máx">
              <select
                className="w-full appearance-none rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 focus:ring-2 focus:ring-violet-500/60"
                value={delayUnit}
                onChange={(e) => setDelayUnit(e.target.value as DelayUnit)}
              >
                <option value="ms">Milissegundos (ms)</option>
                <option value="s">Segundos (s)</option>
                <option value="min">Minutos (min)</option>
              </select>
            </Field>
            <Field label={`Delay min (${delayUnitLabel(delayUnit)})`}>
              <Input
                type="number"
                min={0}
                step={delayUnit === "ms" ? 1 : 0.1}
                value={delayMin}
                onChange={(e) => setDelayMin(Number(e.target.value))}
              />
            </Field>
            <Field label={`Delay máx (${delayUnitLabel(delayUnit)})`}>
              <Input
                type="number"
                min={0}
                step={delayUnit === "ms" ? 1 : 0.1}
                value={delayMax}
                onChange={(e) => setDelayMax(Number(e.target.value))}
              />
            </Field>
            <Field label="Pausa a cada (msgs)">
              <Input type="number" min={0} value={pauseEvery} onChange={(e) => setPauseEvery(Number(e.target.value))} />
            </Field>
            <Field label="Duração pausa (min)">
              <Input
                type="number"
                min={0}
                value={pauseDurationMin}
                onChange={(e) => setPauseDurationMin(Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="mt-3 space-y-2">
            <span className="block text-sm text-zinc-400">Cadência (dias)</span>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleCadence(d)}
                  className={cx(
                    "px-3 py-1 rounded-lg text-xs border transition",
                    cadence.includes(d)
                      ? "bg-violet-600 text-white border-violet-500"
                      : "bg-zinc-900/60 text-zinc-300 border-zinc-700 hover:bg-zinc-800/60"
                  )}
                >
                  D+{d}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              Envios acontecem apenas entre 08:00 e 18:00. Após 18:00, pausa e retoma no próximo dia às 08:00.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-4">
            <PrimaryButton
              onClick={handleSend}
              disabled={loading || !listaSelecionada || !media.length || !rows.length}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar arquivos
            </PrimaryButton>
          </div>

          {progress > 0 && (
            <div className="mt-6 rounded-2xl border border-white/10 p-4">
              <p className="text-sm mb-2 text-zinc-400">Progresso</p>
              <div className="h-2 rounded-xl overflow-hidden bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  style={{ width: `${Math.min(progress, 100)}%`, transition: "width .25s ease" }}
                />
              </div>
            </div>
          )}
        </Section>

        {/* 4) Preview de contatos */}
        <Section title="4) Preview" subtitle="Primeiros contatos da lista" icon={Eye}>
          <div className="rounded-2xl overflow-hidden border border-white/10">
            <table className="w-full text-sm text-zinc-200">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">nome</th>
                  <th className="text-left px-4 py-3">numero</th>
                </tr>
              </thead>
              <tbody>
                {(rows.slice(0, 5).length ? rows.slice(0, 5) : []).map((r, i) => (
                  <tr key={i} className="odd:bg-white/[0.03]">
                    <td className="px-4 py-3">{i + 1}</td>
                    <td className="px-4 py-3">{r.nome ?? "—"}</td>
                    <td className="px-4 py-3">{r.numero ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>

      {/* Sticky bar */}
      <div className="fixed bottom-4 left-0 right-0 z-40">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 backdrop-blur p-3 flex flex-wrap gap-2 items-center justify-between">
            <div className="text-xs text-zinc-400">
              {listaSelecionada ? <span>Lista #{listaSelecionada}</span> : <span>Nenhuma lista selecionada</span>}
              {rows.length ? <span className="ml-2">• {rows.length} contato(s)</span> : null}
              {media.length ? <span className="ml-2">• {media.length} arquivo(s)</span> : null}
              {aiEnabled && <span className="ml-2 text-violet-300">• IA legendas</span>}
            </div>
            <div className="flex gap-2">
              <PrimaryButton
                onClick={handleSend}
                disabled={loading || !listaSelecionada || !media.length || !rows.length}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div
              className={cx(
                "flex items-center gap-2 rounded-2xl px-4 py-3 shadow-xl",
                toast.type === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
              )}
            >
              {toast.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
              <span className="text-sm font-medium">{toast.text}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
