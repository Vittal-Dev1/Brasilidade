import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= ENV ========= */
const BASE_URL = (process.env.UAZAPI_BASE_URL || process.env.UAZAPIGO_API_URL || "").replace(/\/+$/, "");
const TOKEN =
  process.env.UAZAPIGO_TOKEN_DISPAROS ||
  process.env.UAZAPIGO_TOKEN ||
  process.env.UAZAPI_TOKEN_COMERCIAL ||
  process.env.UAZAPI_TOKEN_PESSOAL ||
  "";
// você mostrou que funciona nesse endpoint:
const SEND_MEDIA_PATH = "/send/media";

// formato do número
const NUMBER_FORMAT = (process.env.UAZAPI_NUMBER_FORMAT || "jid").toLowerCase() as "jid" | "digits";

// para absolutizar links quando for remoto
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

// debug no console
const DEBUG = (process.env.DEBUG_DISPAROS || "0") !== "0";

/* ========= TIPOS ========= */
type CSVRow = Record<string, string>;
type TemplateVariation = { base: string; variations: string[] };

type Mediatype = "document" | "image" | "video" | "audio";

type MediaRico = {
  url: string;
  filename?: string;
  mime?: string;
  mediatype?: Mediatype;
  captions?: TemplateVariation[];
};

type FileSimple = {
  url: string;
  fileName?: string; // -> docName
  caption?: string; // -> text
  mediatype?: Mediatype;
  mime?: string;
};

type ContactRow = CSVRow & { numero: string };

type BasePayload = {
  contacts: ContactRow[];
  delayMsMin?: number;
  delayMsMax?: number;
  pauseEvery?: number;
  pauseDurationMs?: number;
  startAtMs?: number;
};

type Payload = BasePayload &
  (
    | {
        files: FileSimple[];
        media?: never;
      }
    | {
        media: MediaRico[];
        files?: never;
      }
  );

/* ========= UTILS ========= */
const onlyDigits = (v: string) => (v || "").replace(/\D+/g, "");
function numeroToField(numero: string) {
  let d = onlyDigits(numero).replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return NUMBER_FORMAT === "digits" ? d : `${d}@s.whatsapp.net`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function randBetween(min = 0, max = 0) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (min > max) [min, max] = [max, min];
  return Math.floor(min + Math.random() * (max - min + 1));
}
function inferType(mime = "", fallback: Mediatype = "document"): Mediatype {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  return fallback || "document";
}
function pickRandom<T>(xs: T[]) {
  const a = (xs || []).filter(Boolean);
  if (!a.length) return null;
  return a[Math.floor(Math.random() * a.length)]!;
}
function renderTemplate<T extends Record<string, unknown>>(tpl: string, data: T) {
  let out = tpl || "";
  for (const k of Object.keys(data || {})) {
    const val = data[k];
    out = out.replaceAll(`{{${k}}}`, String(val ?? ""));
  }
  return out.trim();
}

/**
 * Detecta se a URL é local (só o seu Next vê) e o Uazapi NÃO vai conseguir baixar.
 * ex.: http://localhost:3000/uploads/...  |  http://127.0.0.1:3000/...  |  /uploads/...
 */
function isLocalUrl(u: string) {
  return (
    u.startsWith("http://localhost") ||
    u.startsWith("http://127.0.0.1") ||
    u.startsWith("/uploads/") ||
    u.startsWith("uploads/")
  );
}

/**
 * Lê o arquivo salvo no disco (ex.: public/uploads/xxxx.webp) e devolve data URI
 */
async function localFileToDataUri(
  relPath: string
): Promise<{ dataUri: string; mime: string; docName: string }> {
  // normaliza: tira / inicial porque vamos juntar com public/
  const clean = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  // normalmente upload sobe para /public/uploads/...
  const fullPath = path.join(process.cwd(), "public", clean);

  const buf = await fs.readFile(fullPath);
  const ext = path.extname(fullPath).toLowerCase();

  // mapeamento básico de mime
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
      ? "image/png"
      : ext === ".webp"
      ? "image/webp"
      : ext === ".pdf"
      ? "application/pdf"
      : ext === ".zip"
      ? "application/zip"
      : "application/octet-stream";

  const b64 = buf.toString("base64");
  const dataUri = `data:${mime};base64,${b64}`;
  const docName = path.basename(fullPath);

  return { dataUri, mime, docName };
}

/**
 * Se a URL for remota de verdade, só absolutiza.
 */
function toAbsolute(url: string, req: NextRequest) {
  try {
    const u = new URL(url);
    return u.toString();
  } catch {
    const base = PUBLIC_BASE || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    return `${base}${url.startsWith("/") ? url : "/" + url}`;
  }
}

/* ========= CHAMADA UAZAPI ========= */
type SendBody = {
  number: string;
  type: Mediatype;
  file: string; // pode ser URL pública ou data:...base64,...
  docName?: string;
  text?: string;
};

type UazapiOk = { ok?: boolean } & Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

async function sendMediaUazapi(body: SendBody): Promise<unknown> {
  const url = `${BASE_URL}${SEND_MEDIA_PATH}`;
  if (DEBUG) console.log("[Uazapi] POST", url, "\nBody:", JSON.stringify(body));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // alguns usam uma destas:
      Authorization: `Bearer ${TOKEN}`,
      apikey: TOKEN,
      token: TOKEN,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // mantém text como fallback
  }

  if (DEBUG) console.log("[Uazapi] Response", res.status, json || text);

  if (!res.ok) {
    const rec = asRecord(json);
    const errMsg =
      (rec?.error as string | undefined) ||
      (rec?.message as string | undefined) ||
      text ||
      `Uazapi ${res.status}`;
    throw new Error(errMsg);
  }

  return json ?? ({ ok: true } as UazapiOk);
}

/* ========= HANDLER ========= */
export async function POST(req: NextRequest) {
  if (!BASE_URL || !TOKEN) {
    return NextResponse.json(
      { error: "Configuração ausente. Verifique UAZAPI_BASE_URL e UAZAPIGO_TOKEN_DISPAROS." },
      { status: 500 }
    );
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const {
    contacts = [],
    delayMsMin = 500,
    delayMsMax = 1500,
    pauseEvery = 0,
    pauseDurationMs = 0,
    startAtMs,
  } = payload;

  if (!contacts.length) {
    return NextResponse.json({ error: "contacts vazio" }, { status: 400 });
  }

  // normaliza arquivos
  let files: FileSimple[] = [];
  if ("files" in payload && Array.isArray(payload.files)) {
    files = payload.files;
  } else if ("media" in payload && Array.isArray(payload.media)) {
    const media = payload.media;
    files = media.map((m) => {
      const pool = (m.captions || [])
        .flatMap((c) => [c.base, ...(c.variations || [])])
        .map((s) => (s || "").trim())
        .filter(Boolean);
      const caption = pickRandom(pool) || "";
      return {
        url: m.url,
        fileName: m.filename,
        caption,
        mediatype: m.mediatype ?? inferType(m.mime),
        mime: m.mime,
      };
    });
  }

  if (!files.length) {
    return NextResponse.json({ error: "sem arquivos" }, { status: 400 });
  }

  // se tem startAt, espera
  if (startAtMs && startAtMs > Date.now()) {
    await sleep(startAtMs - Date.now());
  }

  type ResultItem = {
    numero: string;
    number?: string;
    file?: { url: string; type: Mediatype; docName?: string; local?: boolean };
    sent: boolean;
    error?: string;
    response?: unknown;
  };

  const results: ResultItem[] = [];

  let sentCount = 0;

  for (const contato of contacts) {
    const numero = String(contato.numero || "");
    if (!numero) {
      results.push({ numero: "", sent: false, error: "contato sem número" });
      continue;
    }
    const number = numeroToField(numero);

    for (const f of files) {
      const type: Mediatype = f.mediatype ?? inferType(f.mime);
      const text = f.caption ? renderTemplate(f.caption, contato) : undefined;

      // vamos montar file + docName
      let fileToSend = "";
      let docName = type === "document" ? f.fileName || "documento.pdf" : undefined;
      let isLocal = false;

      if (isLocalUrl(f.url)) {
        // ler do disco e mandar como base64
        const rel =
          f.url.startsWith("http://localhost:3000") || f.url.startsWith("http://127.0.0.1:3000")
            ? f.url.replace("http://localhost:3000", "").replace("http://127.0.0.1:3000", "")
            : f.url;

         const { dataUri, docName: localName } = await localFileToDataUri(rel);

        fileToSend = dataUri;
        // se for document e não veio nome, usa o do arquivo
        if (type === "document" && !docName) docName = localName;
        isLocal = true;
      } else {
        // remoto de verdade
        fileToSend = toAbsolute(f.url, req);
      }

      let ok = false;
      let resp: unknown = null;
      let lastErr: unknown = null;

      // retry leve
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          resp = await sendMediaUazapi({
            number,
            type,
            file: fileToSend,
            docName,
            text,
          });
          ok = true;
        } catch (err: unknown) {
          lastErr = err;
          await sleep(600);
        }
      }

      const errorMessage =
        ok
          ? undefined
          : (() => {
              if (lastErr instanceof Error) return lastErr.message;
              try {
                return String(lastErr);
              } catch {
                return "erro";
              }
            })();

      results.push({
        numero,
        number,
        file: { url: f.url, type, docName, local: isLocal },
        sent: ok,
        error: errorMessage,
        response: ok ? resp : undefined,
      });

      sentCount++;

      if (pauseEvery > 0 && sentCount % pauseEvery === 0 && pauseDurationMs > 0) {
        await sleep(pauseDurationMs);
      }

      const wait = randBetween(delayMsMin, delayMsMax);
      if (wait > 0) await sleep(wait);
    }
  }

  const ok = results.every((r) => r.sent);

  return NextResponse.json(
    {
      ok,
      totalEnvios: results.length,
      sucesso: results.filter((r) => r.sent).length,
      falha: results.filter((r) => !r.sent).length,
      results,
    },
    { status: ok ? 200 : 207 }
  );
}
