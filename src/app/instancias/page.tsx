// src/app/instancias/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { RefreshCcw, PlugZap, Power, RotateCcw, Search, Wifi } from "lucide-react";

type InstanceItem = {
  id: string;
  name: string;
  number: string;
  photo: string;
  connected: boolean;
  status: string;
  device: string;
  lastSeen: string | null;
};

function cn(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function getErrMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" ? m : JSON.stringify(m);
  }
  try {
    return String(e);
  } catch {
    return "Erro desconhecido";
  }
}

type InstancesApiResponse = { items?: InstanceItem[]; error?: string };

export default function InstancesPage() {
  const [items, setItems] = useState<InstanceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [qLive, setQLive] = useState("");
  const [q, setQ] = useState("");
  // fallback de foto por "name" (ou id)
  const [fallbackPhoto, setFallbackPhoto] = useState<Record<string, boolean>>({});

  // debounce do filtro
  useEffect(() => {
    const t = setTimeout(() => setQ(qLive.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [qLive]);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await fetch("/api/instances", { cache: "no-store" });
      const json = (await res.json().catch(() => ({ items: [], error: "Resposta inválida" }))) as InstancesApiResponse;

      if (!res.ok) throw new Error(json?.error || "Falha ao carregar");

      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: unknown) {
      setErr(getErrMsg(e) || "Erro ao carregar");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((it) =>
      [it.name, it.number, it.status, it.device].join(" ").toLowerCase().includes(q)
    );
  }, [items, q]);

  async function act(name: string, action: "connect" | "disconnect" | "reconnect") {
    try {
      setBusy((b) => ({ ...b, [name]: true }));
      const res = await fetch(`/api/instances/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok || j?.error) throw new Error(j?.error || `Falha ao ${action}`);
      await load();
    } catch (e: unknown) {
      alert(getErrMsg(e) || `Erro ao ${action}`);
    } finally {
      setBusy((b) => ({ ...b, [name]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white">
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-600/20 flex items-center justify-center ring-1 ring-indigo-400/20 mb-3">
            <Wifi className="w-6 h-6 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Instâncias</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Gerencie conexões, veja status, dispositivo e última atividade.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              value={qLive}
              onChange={(e) => setQLive(e.target.value)}
              placeholder="Filtrar por nome, número, status…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-900/70 border border-zinc-800 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 text-sm"
          >
            <RefreshCcw className="h-4 w-4 text-indigo-400" />
            Recarregar
          </button>
        </div>

        {/* Erro */}
        {err && (
          <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-200 text-sm">
            {err}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm shadow-2xl shadow-black/30 p-4 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-zinc-800" />
                    <div className="flex-1">
                      <div className="h-4 w-40 bg-zinc-800 rounded mb-2" />
                      <div className="h-3 w-28 bg-zinc-900 rounded" />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="h-3 bg-zinc-900 rounded" />
                    <div className="h-3 bg-zinc-900 rounded w-2/3" />
                    <div className="h-3 bg-zinc-900 rounded w-1/2" />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <div className="h-9 w-28 rounded-xl bg-zinc-900" />
                    <div className="h-9 w-28 rounded-xl bg-zinc-900" />
                  </div>
                </div>
              ))
            : filtered.map((it) => {
                const isBusy = !!busy[it.name];
                const showFallback = fallbackPhoto[it.name] || !it.photo;
                const imgSrc = showFallback ? "/instance-placeholder.svg" : it.photo;

                return (
                  <div
                    key={it.id}
                    className="rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm shadow-2xl shadow-black/30 p-5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-zinc-700 relative">
                        <Image
                          src={imgSrc}
                          alt={it.name || it.number || "instance"}
                          fill
                          sizes="48px"
                          className="object-cover"
                          onError={() =>
                            setFallbackPhoto((m) => ({ ...m, [it.name]: true }))
                          }
                        />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-medium text-white">
                            {it.name || "(sem nome)"}
                          </h2>
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full ring-1",
                              it.connected
                                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/20"
                                : "bg-rose-500/15 text-rose-300 ring-rose-400/20"
                            )}
                          >
                            {it.connected ? "Conectada" : "Desconectada"}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400">{it.number || "—"}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                        <div className="text-zinc-400 mb-0.5">Status</div>
                        <div className="text-zinc-200">{it.status || "—"}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                        <div className="text-zinc-400 mb-0.5">Dispositivo</div>
                        <div className="text-zinc-200">{it.device || "—"}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 col-span-2">
                        <div className="text-zinc-400 mb-0.5">Visto por último</div>
                        <div className="text-zinc-200">
                          {it.lastSeen ? new Date(it.lastSeen).toLocaleString() : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      {it.connected ? (
                        <>
                          <button
                            onClick={() => act(it.name, "disconnect")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900/70 hover:bg-zinc-800 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 disabled:opacity-50"
                            title="Desconectar"
                          >
                            <Power className="h-4 w-4 text-rose-300" />
                            {isBusy ? "Desconectando..." : "Desconectar"}
                          </button>
                          <button
                            onClick={() => act(it.name, "reconnect")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 ring-1 ring-indigo-400/30 px-3 py-2 text-sm text-white disabled:opacity-50"
                            title="Reconectar"
                          >
                            <RotateCcw className="h-4 w-4" />
                            {isBusy ? "Reconectando..." : "Reconectar"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => act(it.name, "connect")}
                          disabled={isBusy}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 ring-1 ring-emerald-400/30 px-3 py-2 text-sm text-white disabled:opacity-50"
                          title="Conectar"
                        >
                          <PlugZap className="h-4 w-4" />
                          {isBusy ? "Conectando..." : "Conectar"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>

        {!loading && filtered.length === 0 && !err && (
          <div className="mt-10 rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm shadow-2xl shadow-black/30 p-8 text-center">
            <div className="mx-auto h-16 w-16 relative mb-3 opacity-60">
              <Image
                src="/instance-placeholder.svg"
                alt="Vazio"
                fill
                sizes="64px"
                className="object-contain"
                priority
              />
            </div>
            <p className="text-zinc-200 font-medium">Nada por aqui…</p>
            <p className="text-sm text-zinc-400">Tente ajustar o filtro ou recarregar a lista.</p>
          </div>
        )}
      </div>
    </div>
  );
}
