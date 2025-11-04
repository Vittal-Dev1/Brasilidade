import { NextResponse } from "next/server";

/** ===== Config ===== */
const API_URL = process.env.UAZAPIGO_API_URL || "https://vittalflow.uazapi.com";
const ADMIN_TOKEN = process.env.UAZAPIGO_ADMIN_TOKEN!;
const DEFAULT_INSTANCE = (process.env.UAZAPIGO_INSTANCE_KEY || "disparos").trim();

/** ===== Utils ===== */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retorna o corpo como `unknown` (nunca `any`) */
async function asJson(res: Response): Promise<unknown> {
  const txt = await res.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt } as const;
  }
}

function adminHeaders(extra?: HeadersInit): HeadersInit {
  return { Accept: "application/json", admintoken: ADMIN_TOKEN, ...(extra || {}) };
}

function tokenHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return { Accept: "application/json", token, ...(extra || {}) };
}

async function httpAdmin(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  return fetch(url, { ...init, headers: adminHeaders(init?.headers), cache: "no-store" });
}
async function httpToken(path: string, token: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  return fetch(url, { ...init, headers: tokenHeaders(token, init?.headers), cache: "no-store" });
}

/** ===== Descoberta do token da instância por nome =====
 * GET /instance/all (admintoken) -> achar registro cujo "name" bate com o nome pedido.
 */
async function findInstanceTokenByName(name: string): Promise<string | null> {
  const res = await httpAdmin("/instance/all");
  const data = await asJson(res);

  // extrai lista a partir de formatos comuns do payload: array raiz, {instances: []}, {data: []}
  const listUnknown: unknown[] = Array.isArray(data)
    ? (data as unknown[])
    : ((): unknown[] => {
        if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          const a = obj["instances"];
          if (Array.isArray(a)) return a as unknown[];
          const b = obj["data"];
          if (Array.isArray(b)) return b as unknown[];
        }
        return [];
      })();

  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(name);

  for (const it of listUnknown) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;

    const nm = rec["name"];
    if (typeof nm !== "string" || norm(nm) !== target) continue;

    // tenta token direto
    const t1 = rec["token"];
    if (typeof t1 === "string" && t1.length > 10) return t1;

    // ou dentro de "instance"
    const inst = rec["instance"];
    if (inst && typeof inst === "object") {
      const t2 = (inst as Record<string, unknown>)["token"];
      if (typeof t2 === "string" && t2.length > 10) return t2;
    }
  }

  return null;
}

/** ===== Criação de instância =====
 * POST /instance/init (admintoken) — retorna o token no payload.
 */
async function createInstance(
  instance: string
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await httpAdmin("/instance/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: instance }),
  });
  const data = await asJson(res);
  return { ok: res.ok, status: res.status, data };
}

/** ===== Status (GET /instance/status com header token) ===== */
async function getStatus(
  token: string
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await httpToken("/instance/status", token, { method: "GET" });
  const data = await asJson(res);
  return { ok: res.ok, status: res.status, data };
}

/** ===== Conectar (POST /instance/connect com header token)
 * A doc indica que o QR atualizado vem pelo /instance/status durante "connecting".
 */
async function postConnect(
  token: string,
  phone?: string
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const body = phone ? { phone } : {}; // se quiser pareamento por código, passe "phone"
  const res = await httpToken("/instance/connect", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, status: res.status, data };
}

/** ===== Fluxo: conectar e obter QR ===== */
async function connectAndFetchQR(
  instanceName: string
): Promise<{ status: number; body: unknown }> {
  // 1) pegar token
  let token = await findInstanceTokenByName(instanceName);
  if (!token) {
    const created = await createInstance(instanceName); // /instance/init
    if (!created.ok) {
      return {
        status: created.status,
        body: { error: "Falha ao criar instância", detail: created.data },
      };
    }
    // alguns servidores levam um tempinho pra aparecer no /instance/all
    await sleep(400);
    token = await findInstanceTokenByName(instanceName);
    if (!token) {
      return {
        status: 404,
        body: { error: `Token da instância "${instanceName}" não encontrado após criação.` },
      };
    }
  }

  // 2) iniciar conexão — se já estiver "connecting", o backend deve responder 200/409 etc. Não interrompe o fluxo.
  await postConnect(token);

  // 3) poll de status procurando qrcode
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const st = await getStatus(token);
    if (!st.ok && i > 6) return { status: st.status, body: st.data };

    const d = (st.data ?? {}) as Record<string, unknown>;

    // Tentativas de campos comuns para o QR
    const qrCandidate =
      (d.instance && typeof d.instance === "object"
        ? (d.instance as Record<string, unknown>)["qrcode"] ??
          (d.instance as Record<string, unknown>)["qrCode"]
        : undefined) ??
      d["qrcode"] ??
      (d.status && typeof d.status === "object"
        ? (d.status as Record<string, unknown>)["qrcode"]
        : undefined) ??
      d["qrCode"] ??
      d["base64"];

    if (typeof qrCandidate === "string" && qrCandidate.length > 20) {
      const dataUrl = qrCandidate.startsWith("data:image")
        ? qrCandidate
        : `data:image/png;base64,${qrCandidate}`;
      return { status: 200, body: { qrCode: dataUrl, origin: "status" } };
    }

    // resumo de status pro front
    const state =
      (d.instance && typeof d.instance === "object"
        ? (d.instance as Record<string, unknown>)["status"]
        : undefined) ??
      (d.status && typeof d.status === "object"
        ? ((d.status as Record<string, unknown>)["connected"] ? "connected" : "connecting")
        : undefined);

    if (state === "connected") {
      return { status: 200, body: { message: "Já está conectado", connected: true } };
    }
  }

  return { status: 504, body: { error: "QR não disponível no momento (timeout em /instance/status)" } };
}

/** ===== Handler ===== */
export async function GET(req: Request) {
  if (!ADMIN_TOKEN) {
    return NextResponse.json({ error: "UAZAPIGO_ADMIN_TOKEN ausente." }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const instance = (searchParams.get("instance") || DEFAULT_INSTANCE).trim();

  try {
    switch (action) {
      case "list": {
        const res = await httpAdmin("/instance/all");
        const data = await asJson(res);
        return NextResponse.json(data, { status: res.status });
      }

      case "create": {
        // idempotente: se já existir, não recria
        const already = await findInstanceTokenByName(instance);
        if (already) {
          return NextResponse.json({ message: "Instância já existe", instance }, { status: 200 });
        }
        const { status, data } = await createInstance(instance);
        return NextResponse.json(data, { status });
      }

      case "status": {
        const token = await findInstanceTokenByName(instance);
        if (!token) {
          return NextResponse.json(
            { error: `Token da instância "${instance}" não encontrado.` },
            { status: 404 }
          );
        }
        const r = await getStatus(token);
        return NextResponse.json(r.data, { status: r.status });
      }

      case "qr": {
        const r = await connectAndFetchQR(instance);
        return NextResponse.json(r.body, { status: r.status });
      }

      case "token": {
        const token = await findInstanceTokenByName(instance);
        return NextResponse.json(
          token ? { instance, tokenFound: true } : { instance, tokenFound: false },
          { status: token ? 200 : 404 }
        );
      }

      default:
        return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }
  } catch (e) {
    // loga sem expor stack para o cliente
    console.error("💥 Erro interno conexão:", e);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}