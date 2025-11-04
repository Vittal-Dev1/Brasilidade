"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileSpreadsheet,
  Save,
  RefreshCw,
  Send,
  PlusCircle,
  Trash2,
  Loader2,
  CheckCircle2,
  TriangleAlert,
  Eye,
  Moon,
  SunMedium,
  ChevronDown,
  ListChecks,
  MessageSquareText,
  Table as TableIcon,
  Sparkles,
  Info,
} from "lucide-react";

/* ================== Tipos ================== */
export type CSVRow = Record<string, string>;
type ListaResumo = { id: number; nome: string; created_at?: string };
type TemplateVariation = { base: string; variations: string[] };
type ApiLista = {
  id: number;
  nome: string;
  templates: TemplateVariation[];
  reply_message: string | null;
  contatos: CSVRow[];
  reply_templates?: TemplateVariation[];
};
type DelayUnit = "ms" | "s" | "min";

type ProcessedChunk = { processed: number; reason: "no-jobs" | "time-budget" | "outside-window" };
type StartResponse = {
  ok: boolean;
  batchId?: number;
  queued?: number;
  processedNow?: ProcessedChunk;
  tz?: string | null;
  error?: string;
  tip?: string;
};

/* ================== Helpers ================== */
const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

const onlyDigits = (v: string) => (v || "").replace(/\D+/g, "");
function normalizeMsisdn(raw: string): string | null {
  if (!raw) return null;
  const d = onlyDigits(String(raw)).replace(/^0+/, "");
  const withDdi = d.length === 10 || d.length === 11 ? `55${d}` : d;
  if (withDdi.length < 12 || withDdi.length > 13) return null;
  return withDdi;
}

function toMs(value: number, unit: DelayUnit): number {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  if (unit === "s") return Math.round(v * 1000);
  if (unit === "min") return Math.round(v * 60_000);
  return Math.round(v); // ms
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

// Clonagem defensiva
const cloneTemplates = (prev: TemplateVariation[]) =>
  prev.map((t) => ({ base: t.base, variations: [...(t.variations || [])] }));

/* ====== util: baixar modelo CSV ====== */
function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCsvModel(withExamples = false, delimiter = ","): string {
  const headers = ["nome", "numero"];
  const head = headers.join(delimiter);
  if (!withExamples) return `${head}\n`;

  const exemplos: Array<[string, string]> = [
    ["Maria Silva", "11987654321"],
    ["João Santos", "21912345678"],
    ["Fulano de Tal", "11911112222"],
  ];
  const lines = exemplos.map((r) => r.join(delimiter)).join("\n");
  return `${head}\n${lines}\n`;
}

/* ================== UI bits ================== */
function Section({
  title,
  subtitle,
  icon: Icon,
  children,
  collapsible = true,
  defaultOpen = true,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType<{ className?: string }>;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
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
  className,
  type = "button",
  ...rest
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
  className,
  type = "button",
  ...rest
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
function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 items-center rounded-full transition",
        checked ? "bg-violet-600" : "bg-zinc-700",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      title={label}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 transform rounded-full bg-white transition",
          checked ? "translate-x-5" : "translate-x-1"
        )}
      />
    </button>
  );
}
// checkbox “pill”
function TagCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cx(
        "px-3 py-1 rounded-lg text-xs border transition",
        checked
          ? "bg-violet-600 text-white border-violet-500"
          : "bg-zinc-900/60 text-zinc-300 border-zinc-700 hover:bg-zinc-800/60"
      )}
    >
      {children}
    </button>
  );
}

/* ================== Page ================== */
export default function Page() {
  const [dark, setDark] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  // progress
  const [progress, setProgress] = useState(0);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSim = () => {
    if (simRef.current) {
      clearInterval(simRef.current);
      simRef.current = null;
    }
  };
  const startSim = (until = 90, step = 2, everyMs = 120) => {
    stopSim();
    setProgress((p) => (p > 0 && p < until ? p : 1));
    simRef.current = setInterval(() => setProgress((p) => (p < until ? p + step : p)), everyMs);
  };
  const completeProgress = (resetDelayMs = 800) => {
    stopSim();
    setProgress(100);
    setTimeout(() => setProgress(0), resetDelayMs);
  };

  const [toast, setToast] = useState<null | { type: "ok" | "err"; text: string }>(null);
  const showOk = (text: string) => setToast({ type: "ok", text });
  const showErr = (text: string) => setToast({ type: "err", text });

  // dados principais
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [templates, setTemplates] = useState<TemplateVariation[]>([
    { base: "Olá {{nome}}, tudo bem?", variations: [] },
  ]);
  const [replyTemplates, setReplyTemplates] = useState<TemplateVariation[]>([
    { base: "Oi {{nome}}, recebemos sua mensagem. Já te retorno 👋", variations: [] },
  ]);

  // IA (GPT-4 mini)
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInstruction, setAiInstruction] = useState(
    "Personalize uma mensagem curta, direta e profissional para WhatsApp. Sem emojis. Máx. 250 caracteres. Use os dados disponíveis (ex.: nome, cidade, interesse) se existirem. Mantenha tom humano e convidativo."
  );
  const [aiPreview, setAiPreview] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // cadência / anti-ban
  const [cadence, setCadence] = useState<number[]>([]);
  const toggleCadence = (d: number) =>
    setCadence((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const [maxContacts, setMaxContacts] = useState(50);

  // unidade de delay
  const [delayUnit, setDelayUnit] = useState<DelayUnit>("ms");
  const [delayMin, setDelayMin] = useState(1000);
  const [delayMax, setDelayMax] = useState(5000);

  const [pauseEvery, setPauseEvery] = useState(20);
  const [pauseDurationMin, setPauseDurationMin] = useState(10);

  // listas
  const [listas, setListas] = useState<ListaResumo[]>([]);
  const [listaNome, setListaNome] = useState("");
  const [listaSelecionada, setListaSelecionada] = useState<number | null>(null);

  // dirty tracking
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => {
    if (listaSelecionada !== null) setIsDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, rows, replyTemplates]);

  const detectDelimiter = (text: string) => (text.includes(";") ? ";" : ",");

  // CSV keys (para variáveis rápidas)
  const csvKeys = useMemo(() => Object.keys(rows[0] || {}), [rows]);

  // fetch listas
  const fetchListas = useCallback(async () => {
    try {
      const res = await fetch("/api/listas", { cache: "no-store" });
      const data = (await res.json()) as ListaResumo[] | { error?: string };
      if (Array.isArray(data)) setListas(data);
    } catch {}
  }, []);
  useEffect(() => {
    fetchListas();
  }, [fetchListas]);

  const carregarLista = useCallback(async (id: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/listas/${id}`, { cache: "no-store" });
      const txt = await res.text();

      const data = JSON.parse(txt) as ApiLista | { error?: string };
      if (!res.ok) throw new Error(("error" in data && data.error) || "Falha ao carregar lista");

      const lista = data as ApiLista;
      setRows(Array.isArray(lista.contatos) ? lista.contatos : []);
      setTemplates(Array.isArray(lista.templates) ? lista.templates : [{ base: "", variations: [] }]);

      const replyFromDb =
        Array.isArray(lista.reply_templates)
          ? lista.reply_templates
          : typeof lista.reply_message === "string" && lista.reply_message.trim()
          ? [{ base: lista.reply_message, variations: [] }]
          : [{ base: "", variations: [] }];

      setReplyTemplates(replyFromDb);
      setListaNome(lista.nome || "");
      setListaSelecionada(lista.id);
      setIsDirty(false);
      showOk(`Lista #${lista.id} carregada (${lista.contatos?.length ?? 0} contatos)`);
    } catch (e) {
      showErr(e instanceof Error ? e.message : "Erro ao carregar lista");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ================== CSV ================== */
  const dropRef = useRef<HTMLDivElement>(null);
  const onFiles = useCallback((f: FileList | null) => {
    if (!f || !f[0]) return;
    const theFile = f[0];
    setFile(theFile);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      Papa.parse<CSVRow>(text, {
        header: true,
        skipEmptyLines: true,
        delimiter: detectDelimiter(text),
        transformHeader: (h) =>
          h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ""),
        complete: (res) => {
          const data = (res.data as CSVRow[]).filter(Boolean);
          setRows(data);
          setIsDirty(true);
          showOk(`Planilha carregada: ${data.length} linhas`);
        },
        error: () => showErr("Falha ao ler CSV. Verifique o arquivo."),
      });
    };
    reader.readAsText(theFile);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      onFiles(e.dataTransfer.files);
    },
    [onFiles]
  );
  const onBrowse = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onFiles(e.target.files), [onFiles]);

  /* ================== Variáveis rápidas ================== */
  const insertVar = useCallback(
    (v: string, tIndex: number, isVariation = false, vIdx?: number) => {
      setTemplates((prev) => {
        const next = cloneTemplates(prev);
        const ins = `{{${v}}}`;
        if (!isVariation) {
          const msg = next[tIndex].base || "";
          next[tIndex].base = msg + (msg.endsWith(" ") || msg.endsWith("\n") ? "" : " ") + ins;
        } else if (typeof vIdx === "number") {
          const msg = next[tIndex].variations[vIdx] || "";
          next[tIndex].variations[vIdx] = msg + (msg.endsWith(" ") || msg.endsWith("\n") ? "" : " ") + ins;
        }
        return next;
      });
      setIsDirty(true);
    },
    []
  );

  /* ================== Preview mensagens ================== */
  const previewRow: CSVRow = useMemo(
    () => rows[0] || { nome: "Fulano", numero: "+55DDD9XXXXYYYY" },
    [rows]
  );
  const renderedPreviews = useMemo(() => {
    return templates.map((tpl, idx) => {
      const pool = [tpl.base, ...tpl.variations].filter((t) => t && t.trim() !== "");
      const example = pool.length > 0 ? pool[idx % pool.length] : "";
      let out = example;
      const keys = Object.keys(previewRow || {});
      for (const k of keys) out = out.replaceAll(`{{${k}}}`, String(previewRow?.[k] ?? `{{${k}}}`));
      return out;
    });
  }, [templates, previewRow]);

  /* ================== IA (preview local) ================== */
  const handleGenerateAiPreview = useCallback(async () => {
    setAiLoading(true);
    setAiPreview("");
    try {
      const textPool = templates
        .flatMap((t) => [t.base, ...t.variations])
        .map((s) => (s || "").trim())
        .filter(Boolean);
      const baseExample = textPool[0] || "Olá {{nome}}, tudo bem?";

      const prompt = [
        "Você é um copywriter especialista em mensagens curtas para WhatsApp.",
        "Objetivo: gerar UMA mensagem personalizada, humana e direta.",
        "Regras: sem emojis; máx. 250 caracteres; 1 parágrafo; responda apenas com o texto final; sem aspas.",
        "",
        "Diretriz de personalização (instrução do usuário):",
        aiInstruction,
        "",
        "Mensagem base de referência (tom/exemplo):",
        `"""${baseExample}"""`,
        "",
        "Dados do contato em JSON:",
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

      setAiPreview(msg);
      showOk("Mensagem personalizada gerada");
    } catch (err) {
      setAiPreview("");
      showErr(err instanceof Error ? err.message : "Erro ao gerar com IA");
    } finally {
      setAiLoading(false);
    }
  }, [aiInstruction, previewRow, templates]);

  const handleInsertAiAsVariation = useCallback(() => {
    const t = aiPreview.trim();
    if (!t) {
      showErr("Gere a mensagem com IA antes de inserir.");
      return;
    }
    setTemplates((prev) => {
      const exists = prev.some((m) => m.base.trim() === t || (m.variations || []).some((v) => v.trim() === t));
      if (exists) {
        showOk("Essa variação já existe — nada a fazer.");
        return prev;
      }
      const next = cloneTemplates(prev);
      if (!next.length) next.push({ base: "", variations: [] });
      next[0] = { ...next[0], variations: [...(next[0].variations || []), t] };
      return next;
    });
    setIsDirty(true);
    showOk("Variação adicionada às mensagens");
  }, [aiPreview]);

  const handleInsertAiAsMessage = useCallback(() => {
    const t = aiPreview.trim();
    if (!t) {
      showErr("Gere a mensagem com IA antes de inserir.");
      return;
    }
    setTemplates((prev) => {
      const exists = prev.some((m) => m.base.trim() === t);
      if (exists) {
        showOk("Essa mensagem já existe.");
        return prev;
      }
      return [...cloneTemplates(prev), { base: t, variations: [] }];
    });
    setIsDirty(true);
    showOk("Mensagem criada a partir da IA");
  }, [aiPreview]);

  /* ================== Salvar / Atualizar lista ================== */
  const handleCreateLista = useCallback(async (): Promise<number | null> => {
    if (!listaNome.trim()) {
      showErr("Informe um nome para a lista");
      return null;
    }
    if (!rows.length) {
      showErr("Carregue uma planilha antes de salvar");
      return null;
    }
    try {
      setLoading(true);
      const body = { nome: listaNome, templates, replyTemplates, contatos: rows };
      const res = await fetch("/api/listas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error((j && (j.error as string)) || "Falha ao salvar lista");
      const newId = Number(j?.id);
      setListaSelecionada(newId);
      setIsDirty(false);
      await fetchListas();
      showOk(`Lista salva (id ${newId})`);
      return newId;
    } catch (e) {
      showErr(e instanceof Error ? e.message : "Erro ao salvar lista");
      return null;
    } finally {
      setLoading(false);
    }
  }, [listaNome, rows, templates, replyTemplates, fetchListas]);

  const handleSaveLista = useCallback(async (): Promise<number | null> => {
    if (!listaSelecionada) return handleCreateLista();
    try {
      setLoading(true);
      const body = { nome: listaNome, templates, replyTemplates, contatos: rows };
      const put = await fetch(`/api/listas/${listaSelecionada}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await put.json();
      if (!put.ok) throw new Error((j && (j.error as string)) || "Falha ao atualizar lista");
      setIsDirty(false);
      await fetchListas();
      showOk(`Lista #${listaSelecionada} atualizada`);
      return Number(j?.id ?? listaSelecionada);
    } catch (e) {
      showErr(e instanceof Error ? e.message : "Erro ao atualizar");
      return null;
    } finally {
      setLoading(false);
    }
  }, [listaSelecionada, listaNome, rows, templates, replyTemplates, fetchListas, handleCreateLista]);

  /* ============== Continuação serverless ============== */
  const continueServerless = useCallback(
    async (batchId: number, maxRounds = 5, waitMs = 1500) => {
      // Na Vercel, cada POST { batchId } processa um pedaço.
      for (let i = 0; i < maxRounds; i++) {
        await new Promise((r) => setTimeout(r, waitMs));
        const res = await fetch("/api/disparos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId }),
        });
        // Ignora corpo se quiser — ou leia para logs
        if (!res.ok) break;
        const j = (await res.json()) as StartResponse;
        if (!j.ok) break;
      }
    },
    []
  );

  /* ================== Disparos ================== */
  const submitCommon = (contactsIn: CSVRow[]) => {
    const normalized = contactsIn
      .slice(0, Math.max(1, maxContacts))
      .map((r) => {
        const n = normalizeMsisdn(r.numero);
        return n ? { ...r, numero: n } : null;
      })
      .filter(Boolean) as CSVRow[];

    if (!normalized.length) {
      showErr("Nenhum contato válido após normalização");
      return null;
    }

    const textPool = templates
      .flatMap((t) => [t.base, ...t.variations])
      .map((s) => (s || "").trim())
      .filter(Boolean);

    if (!textPool.length) {
      showErr("Adicione pelo menos uma mensagem");
      return null;
    }

    const startAtMs = nextStartWithinWindow(new Date()).getTime();

    const minInput = Math.max(0, Math.min(delayMin, delayMax));
    const maxInput = Math.max(delayMin, delayMax);
    const minMs = toMs(minInput, delayUnit);
    const maxMs = toMs(maxInput, delayUnit);

    const pauseMs = Math.max(0, pauseDurationMin) * 60 * 1000;

    return {
      textPool,
      contacts: normalized.map((r) => ({ nome: r.nome, numero: r.numero })),
      startAtMs,
      cadenceDays: cadence,
      delayMsMin: minMs,
      delayMsMax: maxMs,
      pauseEvery: Math.max(0, pauseEvery),
      pauseDurationMs: pauseMs,
      delayUnitUsed: delayUnit,
    };
  };

  const handleSubmitCSV = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!file) return;

    const payload = submitCommon(rows);
    if (!payload) return;

    setLoading(true);
    startSim(92);
    try {
      const res = await fetch("/api/disparos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt);

      const json = JSON.parse(txt) as StartResponse;
      if (!json.ok || !json.batchId) throw new Error(json.error || "Falha ao iniciar disparos");

      await continueServerless(json.batchId, 4, 1000);

      showOk(`📤 Disparos iniciados (batch #${json.batchId}) • TZ: ${json.tz || "?"}`);
      completeProgress();
    } catch (err) {
      stopSim();
      setProgress(0);
      showErr(err instanceof Error ? err.message : "Falha no disparo");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitLista = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!listaSelecionada && !isDirty) return showErr("Selecione ou salve uma lista");
    setLoading(true);
    startSim(88);
    try {
      let workingId = listaSelecionada;
      if (isDirty || !listaSelecionada) {
        const savedId = await handleSaveLista();
        if (!savedId) throw new Error("Falha ao salvar a lista");
        workingId = savedId;
        await carregarLista(savedId);
      }

      const payload = submitCommon(rows);
      if (!payload) throw new Error("Payload inválido");

      const res = await fetch("/api/disparos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, listaId: workingId, listaNome }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt);

      const json = JSON.parse(txt) as StartResponse;
      if (!json.ok || !json.batchId) throw new Error(json.error || "Falha ao iniciar disparos");

      await continueServerless(json.batchId, 4, 1000);

      showOk(`📤 Disparos iniciados (batch #${json.batchId}) • TZ: ${json.tz || "?"}`);
      completeProgress();
    } catch (e) {
      stopSim();
      setProgress(0);
      showErr(e instanceof Error ? e.message : "Falha no disparo");
    } finally {
      setLoading(false);
    }
  };

  /* ================== Render ================== */
  const delayUnitLabel = (u: DelayUnit) => (u === "ms" ? "ms" : u === "s" ? "s" : "min");

  return (
    <div className="min-h-dvh bg-[radial-gradient(1200px_800px_at_20%_-10%,rgba(139,92,246,0.14),transparent),radial-gradient(1000px_700px_at_120%_10%,rgba(236,72,153,0.10),transparent)] bg-zinc-950">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-white/10 backdrop-blur bg-zinc-950/70">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600" />
            <div>
              <h1 className="text-lg font-semibold text-white">Disparador</h1>
              <p className="text-[11px] text-zinc-400">Variações • Janela 08:00–18:00 • CSV/Lista</p>
            </div>
          </div>

          <GhostButton onClick={() => setDark((d) => !d)} title={dark ? "Tema claro" : "Tema escuro"}>
            {dark ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            Tema
          </GhostButton>
        </div>
      </header>

      {/* Stepper */}
      <div className="max-w-6xl mx-auto px-6">
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-3 py-6">
          {[
            { label: "Planilha", Icon: TableIcon },
            { label: "Mensagens", Icon: MessageSquareText },
            { label: "Envio", Icon: ListChecks },
            { label: "Preview", Icon: Eye },
          ].map(({ label, Icon }, i) => (
            <li key={label} className="group">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="p-2 rounded-xl bg-white/5">
                  <Icon className="h-4 w-4 text-zinc-300" />
                </div>
                <span className="text-xs font-medium text-zinc-300">
                  {i + 1}. {label}
                </span>
                {label === "Mensagens" && aiEnabled && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-violet-600/20 text-violet-200 border border-violet-500/30">
                    <Sparkles className="h-3 w-3" /> IA ativada (GPT-4 mini)
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <main className="max-w-6xl mx-auto px-6 pb-28 space-y-8">
        {/* 1) CSV */}
        <Section
          title="1) Planilha"
          subtitle="Arraste o .csv ou selecione manualmente. Cabeçalhos esperados: nome, numero (e outros opcionais)."
          icon={TableIcon}
        >
          <div
            ref={dropRef}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={cx(
              "relative rounded-2xl border-2 border-dashed p-8 flex items-center justify-center text-center transition",
              isDragging ? "border-violet-500/60 bg-violet-500/10" : "border-white/10"
            )}
          >
            <div className="flex flex-col items-center gap-3">
              <Upload className="text-zinc-400" />
              <p className="text-sm text-zinc-400">Arraste seu .csv aqui, ou</p>
              <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl px-3 py-2 bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white text-sm font-medium hover:brightness-110">
                <FileSpreadsheet className="h-4 w-4" /> Selecionar arquivo
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={onBrowse} />
              </label>

              {/* modelo csv */}
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <GhostButton
                  onClick={() => {
                    const csv = buildCsvModel(false, ",");
                    downloadTextFile("modelo_contatos.csv", csv);
                    showOk("Modelo base (.csv) baixado");
                  }}
                  title="Baixar somente cabeçalhos (nome,numero)"
                >
                  <Save className="h-4 w-4" />
                  Baixar modelo base (.csv)
                </GhostButton>

                <GhostButton
                  onClick={() => {
                    const csv = buildCsvModel(true, ",");
                    downloadTextFile("modelo_contatos_exemplo.csv", csv);
                    showOk("Modelo com exemplos (.csv) baixado");
                  }}
                  title="Baixar cabeçalhos + 3 linhas de exemplo"
                >
                  <Save className="h-4 w-4" />
                  Baixar modelo com exemplos
                </GhostButton>
              </div>

              {file && <p className="text-xs text-zinc-400">{file.name}</p>}
            </div>
          </div>

          {csvKeys.length > 0 && (
            <div className="mt-3 text-[11px] text-zinc-400 flex items-center gap-2">
              <Info className="h-3.5 w-3.5" />
              Variáveis disponíveis a partir do CSV:&nbsp;
              <span className="text-zinc-300">{csvKeys.map((k) => `{{${k}}}`).join(", ")}</span>
            </div>
          )}
        </Section>

        {/* 2) Mensagens */}
        <Section
          title="2) Mensagens"
          subtitle="Monte mensagens base e variações aleatórias"
          icon={MessageSquareText}
          badge={
            aiEnabled ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-violet-600/20 text-violet-200 border border-violet-500/30">
                <Sparkles className="h-3 w-3" /> IA (GPT-4 mini)
              </span>
            ) : null
          }
        >
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 mb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-violet-600/20">
                  <Sparkles className="h-4 w-4 text-violet-300" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">IA de personalização (GPT-4 mini)</h4>
                  <p className="text-xs text-zinc-400">
                    Gere uma variação personalizada (preview agora) e/ou use como referência para suas mensagens.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-300">Habilitar</span>
                <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} label="Habilitar GPT-4 mini" />
              </div>
            </div>

            {aiEnabled ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Instrução de personalização (prompt)">
                  <Textarea
                    rows={3}
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    placeholder="Descreva a diretriz de personalização (tom, tamanho, objetivo)..."
                  />
                </Field>

                <div>
                  <div className="text-xs text-zinc-400 mb-2">Amostra com dados do primeiro contato</div>
                  <div className="flex gap-2 flex-wrap">
                    <GhostButton onClick={handleGenerateAiPreview} disabled={aiLoading}>
                      {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Gerar exemplo com IA
                    </GhostButton>

                    <GhostButton onClick={handleInsertAiAsVariation} disabled={!aiPreview.trim()}>
                      <PlusCircle className="h-4 w-4" />
                      Inserir como variação
                    </GhostButton>

                    <PrimaryButton onClick={handleInsertAiAsMessage} disabled={!aiPreview.trim()}>
                      <PlusCircle className="h-4 w-4" />
                      Inserir como <strong>mensagem</strong>
                    </PrimaryButton>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 p-3 min-h-[72px]">
                    {aiPreview ? (
                      <pre className="whitespace-pre-wrap text-sm text-zinc-200">{aiPreview}</pre>
                    ) : (
                      <p className="text-xs text-zinc-500">Clique em “Gerar exemplo com IA” para visualizar.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-zinc-500">
                Ative o toggle para mostrar o prompt e gerar uma variação com IA (GPT-4 mini).
              </p>
            )}
          </div>

          {/* Editor de mensagens */}
          <div className="space-y-6">
            {templates.map((tpl, tIndex) => (
              <div key={tIndex} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Mensagem {tIndex + 1}
                  </span>
                  {templates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTemplates((prev) => prev.filter((_, i) => i !== tIndex));
                        setIsDirty(true);
                      }}
                      className="text-rose-400 hover:text-rose-300"
                      title="Remover mensagem"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Variáveis rápidas:</span>
                  {[..."nome numero".split(" "), ...csvKeys.filter((k) => !["nome", "numero"].includes(k)).slice(0, 8)].map(
                    (k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => insertVar(k, tIndex)}
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

                <Textarea
                  value={tpl.base}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTemplates((prev) => {
                      const next = cloneTemplates(prev);
                      next[tIndex] = { ...next[tIndex], base: v };
                      return next;
                    });
                    setIsDirty(true);
                  }}
                  rows={3}
                  placeholder="Mensagem base"
                />

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Variações (escolha aleatória)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTemplates((prev) => {
                          const next = cloneTemplates(prev);
                          next[tIndex] = {
                            ...next[tIndex],
                            variations: [...(next[tIndex].variations || []), ""],
                          };
                          return next;
                        });
                        setIsDirty(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
                    >
                      <PlusCircle className="h-4 w-4" /> Adicionar
                    </button>
                  </div>

                  {tpl.variations.map((v, vIdx) => (
                    <div key={vIdx} className="flex gap-2">
                      <Textarea
                        value={v}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTemplates((prev) => {
                            const next = cloneTemplates(prev);
                            next[tIndex] = {
                              ...next[tIndex],
                              variations: next[tIndex].variations.map((vv, ii) => (ii === vIdx ? val : vv)),
                            };
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        rows={2}
                        placeholder={`Variação ${vIdx + 1}`}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setTemplates((prev) => {
                            const next = cloneTemplates(prev);
                            next[tIndex] = {
                              ...next[tIndex],
                              variations: next[tIndex].variations.filter((_, ii) => ii !== vIdx),
                            };
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        className="text-rose-400 hover:text-rose-300"
                        title="Remover variação"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-white/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-zinc-400" />
                    <p className="text-xs text-zinc-400">Exemplo (contato 1). Variação é aleatória no envio.</p>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-zinc-200">{renderedPreviews[tIndex] || ""}</pre>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => {
                setTemplates((prev) => [...cloneTemplates(prev), { base: "", variations: [] }]);
                setIsDirty(true);
              }}
              className="inline-flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300"
            >
              <PlusCircle className="h-4 w-4" /> Adicionar mensagem
            </button>
          </div>
        </Section>

        {/* 3) Envio */}
        <Section title="3) Envio" subtitle="Salve como lista e/ou envie agora" icon={ListChecks}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome da lista">
              <Input
                value={listaNome}
                onChange={(e) => {
                  setListaNome(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Ex.: Campanha Outubro SP"
              />
            </Field>

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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-2">
            <Field label="Qtde máx. contatos" hint="Limita o lote atual">
              <Input type="number" min={1} value={maxContacts} onChange={(e) => setMaxContacts(Number(e.target.value))} />
            </Field>

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

            <div className="grid grid-cols-2 gap-4">
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
          </div>

          <div className="mt-3 space-y-2">
            <span className="block text-sm text-zinc-400">Cadência (dias)</span>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3].map((d) => (
                <TagCheckbox key={d} checked={cadence.includes(d)} onChange={() => toggleCadence(d)}>
                  D+{d}
                </TagCheckbox>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              A janela de disparo é fixa: envios acontecem apenas entre 08:00 e 18:00. Se passar das 18:00, o envio pausa e continua no próximo dia útil às 08:00.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-4">
            <GhostButton onClick={handleCreateLista} disabled={loading}>
              <Save className="h-4 w-4" /> Salvar (nova)
            </GhostButton>
            <GhostButton onClick={handleSaveLista} disabled={!listaSelecionada || loading}>
              <RefreshCw className="h-4 w-4" /> Atualizar selecionada
            </GhostButton>
            <PrimaryButton onClick={() => handleSubmitCSV()} disabled={!file || rows.length === 0 || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar (CSV)
            </PrimaryButton>
            <PrimaryButton onClick={() => handleSubmitLista()} disabled={!listaSelecionada || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar (lista)
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

        {/* 4) Preview */}
        <Section title="4) Preview" subtitle="Primeiras linhas detectadas" icon={Eye}>
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
                {(rows.slice(0, 5).length ? rows.slice(0, 5) : [previewRow]).map((r, i) => (
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
              {rows.length ? <span>{rows.length} contato(s) carregados</span> : <span>Nenhum CSV carregado</span>}
              {listaSelecionada && <span className="ml-2">• Lista #{listaSelecionada}</span>}
              {isDirty && <span className="ml-2 text-amber-400">• Alterações não salvas</span>}
              {aiEnabled && <span className="ml-2 text-violet-300">• IA (GPT-4 mini) habilitada</span>}
            </div>
            <div className="flex gap-2">
              <GhostButton onClick={handleSaveLista} disabled={loading}>
                <Save className="h-4 w-4" /> Salvar
              </GhostButton>
              <PrimaryButton onClick={() => handleSubmitLista()} disabled={!listaSelecionada || loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar lista
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
