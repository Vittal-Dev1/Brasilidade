"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Save, Send, RefreshCw, CheckCircle2, TriangleAlert,
  ChevronDown, Wand2, Settings2, ClipboardCheck, Plus, Trash2, Upload
} from "lucide-react";
import type { ComponentType } from "react";

type Vars = Record<string, string>;
const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

type IconProps = { className?: string };
type IconComponent = ComponentType<IconProps>;

function getErrMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return String(e); } catch { return "Erro desconhecido"; }
}

function Section({
  title, subtitle, icon: Icon, children, defaultOpen = true
}: {
  title: string;
  subtitle?: string;
  icon?: IconComponent;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
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
        <ChevronDown className={cx("h-5 w-5 text-zinc-400 transition-transform", open && "rotate-180")} />
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

const PROD_WEBHOOK = "https://n8n1.vittalflow.com/webhook/6a87862b-2728-4e19-9c7c-3c993efa2f3c";

function normalizePromptText(s: string) {
  const straight = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\t/g, " ");
  const stripRight = straight.split("\n").map(l => l.replace(/[ \u00A0]+$/g, "")).join("\n");
  const collapse = stripRight.replace(/\n{3,}/g, "\n\n");
  return collapse.trim();
}

export default function PromptStudioPage() {
  const [title, setTitle] = useState("Mensagem Comercial — WhatsApp");
  const [prompt, setPrompt] = useState(
    "Você é um copywriter. Gere uma mensagem curta, clara e profissional.\n" +
    "Sem emojis. Máx. 250 caracteres. Use variáveis livremente (ex.: {{nome}}, {{cidade}}, {{produto}})."
  );

  // VARIÁVEIS 100% definidas por você
  const [vars, setVars] = useState<Vars>({
    nome: "Fulano32131",
    cidade: "São Paulo",
    produto: "Plano Pro",
  });

  // por padrão usamos o proxy (sem CORS). Você pode trocar para a URL completa do n8n.
  const [webhookUrl, setWebhookUrl] = useState("/api/n8n/forward?target=" + encodeURIComponent(PROD_WEBHOOK));
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<null | { type: "ok" | "err"; text: string }>(null);

  const payload = useMemo(() => ({
    source: "prompt-studio",
    preset: { title, prompt, variables: vars },
    timestamp: new Date().toISOString(),
  }), [title, prompt, vars]);

  // helpers de variável
  const addVar = () => {
    const base = "nova_variavel"; // prefer-const
    let k = base;
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(vars, k)) k = `${k}_${n++}`;
    setVars(prev => ({ ...prev, [k]: "" }));
  };

  const updateKey = (oldKey: string, newKey: string) => {
    const key = newKey.trim();
    if (!key || key === oldKey) return;
    if (Object.prototype.hasOwnProperty.call(vars, key)) return;
    setVars(prev => {
      const clone: Vars = {};
      for (const [k, v] of Object.entries(prev)) clone[k === oldKey ? key : k] = v;
      return clone;
    });
  };

  const updateVal = (key: string, value: string) => setVars(prev => ({ ...prev, [key]: value }));
  const removeVar = (key: string) => setVars(prev => { const n = { ...prev }; delete n[key]; return n; });

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setToast({ type: "ok", text: "JSON copiado" });
    } catch {
      setToast({ type: "err", text: "Não consegui copiar" });
    } finally {
      setTimeout(() => setToast(null), 1800);
    }
  };

  async function post(url: string): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  const postToN8n = async () => {
    setLoading(true);
    try {
      // 1) Tenta a URL configurada (proxy recomendado)
      let res = await post(webhookUrl);
      let text = await res.text().catch(() => "");
      if (!res.ok) {
        // 2) Se for o famoso 404 de webhook de produção inativo, tenta automaticamente webhook-test
        const looksNotRegistered = res.status === 404 && /not registered|The workflow must be active/i.test(text);
        const idMatch = decodeURIComponent(webhookUrl).match(/\/webhook\/([a-f0-9-]{36})/i);
        if (looksNotRegistered && idMatch) {
          const testUrl = webhookUrl.replace("/webhook/", "/webhook-test/");
          res = await post(testUrl);
          text = await res.text().catch(() => "");
        }
      }

      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      setToast({ type: "ok", text: "Enviado ao n8n. Predefinição salva!" });
    } catch (e: unknown) {
      setToast({ type: "err", text: getErrMsg(e) });
    } finally {
      setLoading(false);
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <div className="min-h-dvh bg-[radial-gradient(1200px_800px_at_20%_-10%,rgba(139,92,246,0.14),transparent),radial-gradient(1000px_700px_at_120%_10%,rgba(236,72,153,0.10),transparent)] bg-zinc-950 text-white">
      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-white/10 backdrop-blur bg-zinc-950/70">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Prompt Studio • n8n</h1>
              <p className="text-[11px] text-zinc-400">Defina o prompt e envie para seu fluxo n8n.</p>
            </div>
          </div>

          <button
            onClick={postToN8n}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-gradient-to-br from-violet-600 to-fuchsia-600 hover:brightness-110 disabled:opacity-60"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar para n8n
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* PROMPT */}
        <Section title="Prompt" subtitle="Cole/edite seu prompt. Ele será enviado como predefinição para o seu fluxo." icon={Sparkles}>
          <label className="block space-y-1.5 mb-4">
            <span className="text-xs font-medium text-zinc-400">Título da predefinição</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-violet-500/60"
              placeholder="Ex.: Mensagem Comercial"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Texto do prompt</span>
            <textarea
              rows={10}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-violet-500/60"
              placeholder="Escreva aqui seu prompt..."
            />
          </label>
        </Section>

        {/* VARIÁVEIS */}
        <Section title="Variáveis" subtitle="Crie suas próprias variáveis (chave → valor). Enviaremos exatamente o que você definir." icon={ClipboardCheck}>
          <div className="space-y-3">
            {Object.entries(vars).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/10 p-3 bg-white/[0.02]">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                  <input
                    defaultValue={k}
                    onBlur={(e) => updateKey(k, e.target.value.trim())}
                    className="md:col-span-2 rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100"
                  />
                  <input
                    value={v}
                    onChange={(e) => updateVal(k, e.target.value)}
                    className="md:col-span-3 rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100"
                  />
                </div>
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => removeVar(k)}
                    className="inline-flex items-center gap-1 text-xs rounded-lg border border-zinc-800 px-2 py-1 hover:bg-white/5 text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remover
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={addVar}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-sm hover:bg-white/5 text-zinc-200"
            >
              <Plus className="h-4 w-4" /> Adicionar variável
            </button>
          </div>
        </Section>

        {/* ENTREGA */}
        <Section title="Entrega" subtitle="Defina o endpoint do n8n (webhook) e visualize o payload." icon={Settings2}>
          <label className="block space-y-1.5 mb-3">
            <span className="text-xs font-medium text-zinc-400">Webhook do n8n (ou proxy)</span>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://n8n.../webhook/xxxx  (ou /api/n8n/forward?target=...)"
              className="w-full rounded-xl bg-zinc-950/60 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-violet-500/60"
            />
            <p className="text-[11px] text-zinc-500">
              Dica: use <code>/api/n8n/forward?target=&lt;sua-url-do-n8n&gt;</code> para evitar CORS no navegador.
            </p>
          </label>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Pré-visualização do payload</span>
              <button
                onClick={copyJson}
                className="text-xs inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-1 hover:bg-zinc-900"
                title="Copiar JSON"
              >
                <Upload className="h-3.5 w-3.5" /> Copiar JSON
              </button>
            </div>
            <pre className="mt-3 text-xs text-zinc-300 whitespace-pre-wrap">
{JSON.stringify(payload, null, 2)}
            </pre>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={postToN8n}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-gradient-to-br from-violet-600 to-fuchsia-600 hover:brightness-110 disabled:opacity-60"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar para n8n
            </button>
            <button
              onClick={() => setPrompt(p => normalizePromptText(p))}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm hover:bg-white/5 text-zinc-200"
            >
              <Save className="h-4 w-4" /> Normalizar prompt
            </button>
          </div>
        </Section>
      </main>

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
