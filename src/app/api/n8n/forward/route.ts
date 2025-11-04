// src/app/api/n8n/forward/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whitelist de hosts permitidos para evitar SSRF.
 * Ajuste conforme seus domínios do n8n.
 */
const ALLOWED_HOSTS = new Set([
  "n8n1.vittalflow.com",
  "n8n2.vittalflow.com",
  "localhost",
  "127.0.0.1",
]);

/** Extrai e valida o alvo do forward. */
function getTarget(req: NextRequest): URL {
  // prioridade: query ?target=..., depois header x-n8n-target, por fim env
  const fromQuery = req.nextUrl.searchParams.get("target");
  const fromHeader = req.headers.get("x-n8n-target") || undefined;
  const fromEnv = process.env.N8N_WEBHOOK_URL || "";

  const raw = fromQuery || fromHeader || fromEnv;
  if (!raw) throw new Error("Alvo não informado. Use ?target= ou header x-n8n-target ou N8N_WEBHOOK_URL.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL inválida para target: ${raw}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Apenas http(s) é permitido.");
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Host não permitido: ${url.hostname}`);
  }

  return url;
}

function toTestWebhookIfNeeded(target: URL, upstreamStatus: number, upstreamText: string) {
  // Se for 404 e a mensagem indicar webhook não registrado, trocamos /webhook/ por /webhook-test/
  const looksUnregistered =
    upstreamStatus === 404 &&
    /not registered|The workflow must be active/i.test(upstreamText || "");

  if (!looksUnregistered) return null;

  // só tenta converter se o caminho tiver /webhook/<id>
  const path = target.pathname;
  const match = path.match(/^\/webhook\/(.+)$/);
  if (!match) return null;

  const testUrl = new URL(target.toString());
  testUrl.pathname = `/webhook-test/${match[1]}`;
  return testUrl;
}

export async function POST(req: NextRequest) {
  try {
    const target = getTarget(req);

    // Lemos o corpo cru para encaminhar "ao pé da letra"
    const rawBody = await req.text();

    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
      redirect: "follow",
      // Opcional: timeout via AbortController se quiser
    });

    let text = await upstream.text().catch(() => "");
    let contentType = upstream.headers.get("content-type") || "application/json";

    // Fallback automático para webhook-test se o de produção não estiver ativo
    const maybeTest = toTestWebhookIfNeeded(target, upstream.status, text);
    if (maybeTest) {
      const retry = await fetch(maybeTest.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawBody,
        redirect: "follow",
      });
      text = await retry.text().catch(() => "");
      contentType = retry.headers.get("content-type") || "application/json";
      return new NextResponse(text || "{}", {
        status: retry.status,
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
          "x-n8n-forwarded-to": maybeTest.toString(),
        },
      });
    }

    return new NextResponse(text || "{}", {
      status: upstream.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        "x-n8n-forwarded-to": target.toString(),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "proxy error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
}
