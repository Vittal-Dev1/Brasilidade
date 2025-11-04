// ./src/app/conexao/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Wifi, RefreshCcw, Loader2, CheckCircle2, AlertTriangle, Activity } from "lucide-react";

type QRStatus = "connected" | "connecting" | "desconhecido" | "disconnected" | string;

function looksLikeDataURL(s: string) {
  return /^data:image\/[a-zA-Z]+;base64,/.test(s);
}

export default function ConexaoPage() {
  const [instance, setInstance] = useState("disparos");
  const [qrData, setQrData] = useState<string | null>(null);
  const [status, setStatus] = useState<QRStatus>("Desconhecido");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ found: boolean } | null>(null);
  const [probing, setProbing] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function criarInstancia() {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/conexao?action=create&instance=${encodeURIComponent(instance)}`);
      const data = await res.json();
      if (res.ok) {
        setTokenInfo({ found: true });
      } else {
        setErrorMsg(typeof data === "string" ? data : JSON.stringify(data, null, 2));
      }
    } catch {
      setErrorMsg("Erro ao criar instância.");
    }
  }

  async function gerarQRCode() {
    setLoading(true);
    setErrorMsg(null);
    setQrData(null);
    try {
      const res = await fetch(`/api/conexao?action=qr&instance=${encodeURIComponent(instance)}`);
      const data = await res.json();
      if (res.ok && data.qrCode) {
        setQrData(String(data.qrCode));
      } else if (res.ok && data.connected) {
        setStatus("connected");
      } else {
        setErrorMsg(typeof data === "string" ? data : JSON.stringify(data, null, 2));
      }
    } catch {
      setErrorMsg("Erro inesperado ao gerar QR Code.");
    } finally {
      setLoading(false);
    }
  }

  const atualizarStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/conexao?action=status&instance=${encodeURIComponent(instance)}`);
      const data = await res.json();
      const state: QRStatus =
        data?.state ||
        data?.instance?.status ||
        (data?.status?.connected ? "connected" : data?.status ? "connecting" : "Desconhecido");
      setStatus(state || "Desconhecido");

      const maybeQr =
        data?.instance?.qrcode ||
        data?.qrcode ||
        data?.qrCode ||
        data?.base64;
      if (maybeQr) {
        const img = String(maybeQr).startsWith("data:image")
          ? String(maybeQr)
          : `data:image/png;base64,${String(maybeQr)}`;
        setQrData(img);
      }
    } catch {
      setStatus("Desconhecido");
    }
  }, [instance]);

  const diagnostico = useCallback(async () => {
    setProbing(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/conexao?action=probe&instance=${encodeURIComponent(instance)}`);
      const data = await res.json();
      setErrorMsg(typeof data === "string" ? data : JSON.stringify(data, null, 2));
    } finally {
      setProbing(false);
    }
  }, [instance]);

  const checarToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/conexao?action=token&instance=${encodeURIComponent(instance)}`);
      setTokenInfo({ found: res.ok });
    } catch {
      setTokenInfo({ found: false });
    }
  }, [instance]);

  // auto-poll quando estiver connecting
  useEffect(() => {
    if (status === "connecting") {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(() => {
        void atualizarStatus();
      }, 1000);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
  }, [status, atualizarStatus]);

  // inicial
  useEffect(() => {
    void atualizarStatus();
    void checarToken();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [atualizarStatus, checarToken]);

  const isDataURL = useMemo(() => (qrData ? looksLikeDataURL(qrData) : false), [qrData]);

  const StatusPill = ({ value }: { value: string }) => {
    type IconType = React.ComponentType<{ className?: string }>;
    const map: Record<string, { label: string; cls: string; Icon: IconType }> = {
      connected: {
        label: "Conectado",
        cls: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20",
        Icon: CheckCircle2,
      },
      connecting: {
        label: "Conectando…",
        cls: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20",
        Icon: Activity,
      },
      Desconhecido: {
        label: "Desconhecido",
        cls: "bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-500/30",
        Icon: AlertTriangle,
      },
      disconnected: {
        label: "Desconectado",
        cls: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20",
        Icon: AlertTriangle,
      },
    };
    const info = map[value] || map.Desconhecido;
    const Icon = info.Icon;
    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${info.cls}`}>
        <Icon className="w-3.5 h-3.5" />
        {info.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-600/20 flex items-center justify-center ring-1 ring-indigo-400/20 mb-3">
            <Wifi className="w-6 h-6 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Conectar WhatsApp</h1>
          <p className="text-sm text-zinc-400 mt-1">Informe a instância e gere o QR Code quando quiser.</p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm shadow-2xl shadow-black/40 p-6">
          {/* Row de controles */}
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500"
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
              placeholder="nome da instância"
            />
            <button
              onClick={() => void criarInstancia()}
              className="px-4 py-2 rounded-xl text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
            >
              Criar
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => void gerarQRCode()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-indigo-600 hover:bg-indigo-700 ring-1 ring-indigo-400/30"
            >
              {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCcw className="w-4 h-4" />}
              Gerar QR Code
            </button>

            <button onClick={() => void atualizarStatus()} className="text-indigo-300/90 hover:text-indigo-200 text-sm">
              Atualizar Status
            </button>

            <button
              onClick={() => void diagnostico()}
              disabled={probing}
              className="ml-auto text-zinc-400 hover:text-zinc-200 text-sm"
              title="Rodar diagnóstico"
            >
              {probing ? "Diagnosticando..." : "Diagnóstico"}
            </button>
          </div>

          {/* QR */}
          {qrData && (
            <div className="mt-5 rounded-2xl border border-zinc-200/70 bg-white p-4 flex items-center justify-center">
              {isDataURL ? (
                <Image
                  src={qrData}
                  alt="QR Code"
                  width={320}
                  height={320}
                  draggable={false}
                  unoptimized
                  style={{
                    imageRendering: "pixelated" as React.CSSProperties["imageRendering"],
                  }}
                  className="w-[320px] h-[320px] block select-none"
                />
              ) : (
                <div className="bg-white p-2 rounded-xl">
                  <QRCode value={qrData} size={320} />
                </div>
              )}
            </div>
          )}

          {/* status + token quick info */}
          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Status:</span>
              <StatusPill value={String(status)} />
            </div>

            <div className="flex items-center gap-3">
              {tokenInfo?.found ? (
                <span className="text-xs text-emerald-300/90">token ok</span>
              ) : (
                <span className="text-xs text-zinc-500">token?</span>
              )}
            </div>
          </div>

          {/* erros visíveis */}
          {errorMsg && (
            <pre className="mt-4 text-xs whitespace-pre-wrap bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-zinc-300 overflow-x-auto">
              {errorMsg}
            </pre>
          )}
        </div>

        {/* rodapé */}
        <div className="text-center text-[11px] text-zinc-500 mt-4">
          Dica: aproxime a câmera e mantenha o QR <span className="underline decoration-dotted">plano no centro</span>.
        </div>
      </div>
    </div>
  );
}
