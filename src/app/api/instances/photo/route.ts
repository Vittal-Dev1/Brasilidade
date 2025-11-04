// src/app/api/instances/photo/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const API_URL = process.env.UAZAPIGO_API_URL || "";
const ADMIN_TOKEN = process.env.UAZAPIGO_ADMIN_TOKEN || "";

/* ===== Tipos ===== */
type PhotoQuery = { name?: string; number?: string; src?: string };

type JsonPhotoResponse = {
  base64?: unknown;
  data?: unknown;
  photo?: unknown;
  image?: unknown;
  raw?: unknown;
};

function isDataUrl(v: string): boolean {
  return /^data:image\/[a-zA-Z]+;base64,/.test(v);
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// Tenta vários dialetos comuns de endpoints de foto.
const PHOTO_ENDPOINTS = (q: PhotoQuery) => {
  const base = API_URL.replace(/\/+$/, "");
  const out: string[] = [];

  if (q.src) {
    // quando já temos um caminho/URL do backend
    if (/^https?:\/\//i.test(q.src)) out.push(q.src);
    else out.push(`${base}/${q.src.replace(/^\/+/, "")}`);
  }
  if (q.number) {
    out.push(`${base}/contacts/photo?number=${encodeURIComponent(q.number)}`);
    out.push(`${base}/contact/photo?number=${encodeURIComponent(q.number)}`);
  }
  if (q.name) {
    out.push(`${base}/instance/photo?name=${encodeURIComponent(q.name)}`);
    out.push(`${base}/instances/photo?name=${encodeURIComponent(q.name)}`);
  }

  // remova duplicatas
  return Array.from(new Set(out));
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name") || undefined;
    const number = searchParams.get("number") || undefined;
    const src = searchParams.get("src") || undefined;

    if (!API_URL || !ADMIN_TOKEN) {
      return NextResponse.redirect(new URL("/instance-placeholder.svg", req.url));
    }

    // Se nos mandar um data URL de cara, só repassa
    if (src && isDataUrl(src)) {
      const base64 = src.split(",")[1] || "";
      const buf = Buffer.from(base64, "base64");
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    const attempts = PHOTO_ENDPOINTS({ name, number, src });

    for (const url of attempts) {
      try {
        const res = await fetch(url, {
          headers: { admintoken: ADMIN_TOKEN, Accept: "*/*" },
          cache: "no-store",
        });

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok) continue;

        if (contentType.includes("application/json")) {
          const j = (await res.json().catch(() => ({}))) as JsonPhotoResponse;

          const b64Candidate =
            toStringOrNull(j.base64) ??
            toStringOrNull(j.data) ??
            toStringOrNull(j.photo) ??
            toStringOrNull(j.image) ??
            toStringOrNull(j.raw);

          if (b64Candidate) {
            const prefixed = /^data:image\//.test(b64Candidate)
              ? b64Candidate
              : `data:image/png;base64,${b64Candidate}`;
            const base64 = prefixed.split(",")[1] || "";
            const buf = Buffer.from(base64, "base64");
            return new NextResponse(buf, {
              status: 200,
              headers: {
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=300",
              },
            });
          }
          // se veio JSON sem base64, tenta próximo
          continue;
        }

        // imagem binária direto
        const arrayBuf = await res.arrayBuffer();
        const ct = contentType || "image/png"; // tenta inferir content-type (fallback png)
        return new NextResponse(Buffer.from(arrayBuf), {
          status: 200,
          headers: {
            "Content-Type": ct,
            "Cache-Control": "public, max-age=300",
          },
        });
      } catch {
        // Apenas prossegue para a próxima tentativa.
        continue;
      }
    }

    // fallback placeholder
    return NextResponse.redirect(new URL("/instance-placeholder.svg", req.url));
  } catch {
    return NextResponse.redirect(new URL("/instance-placeholder.svg", req.url));
  }
}
