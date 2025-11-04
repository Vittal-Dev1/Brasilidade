// src/app/api/instances/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_URL = process.env.UAZAPIGO_API_URL || "";
const ADMIN_TOKEN = process.env.UAZAPIGO_ADMIN_TOKEN || "";

/* ========= Tipos ========= */
type Normalized = {
  id: string;
  name: string;
  number: string;
  photo: string;
  connected: boolean;
  status: string;
  device: string;
  lastSeen: string | null;
};

/* ========= Utils de tipo seguro ========= */
function okEnv() {
  return !!API_URL && !!ADMIN_TOKEN;
}

type JsonLike = Record<string, unknown> | unknown[];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getProp(obj: unknown, key: string): unknown {
  if (!isObj(obj)) return undefined;
  return obj[key];
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function getString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function getBoolean(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function getFirstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = getString(c);
    if (s && s.trim() !== "") return s;
  }
  return "";
}

function getFirstArrayFromKeys(obj: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

async function safeJson(res: Response): Promise<JsonLike> {
  try {
    const txt = await res.text();
    if (!txt) return {};
    try {
      return JSON.parse(txt) as JsonLike;
    } catch {
      return { raw: txt };
    }
  } catch {
    return {};
  }
}

/* ========= Normalização (sem any) ========= */
function normalize(rawInput: unknown): Normalized | null {
  if (!rawInput) return null;

  // Acesso via helpers para evitar `any`
  const id =
    getFirstString(
      getProp(rawInput, "id"),
      getPath(rawInput, ["instance", "id"]),
      getProp(rawInput, "instanceId"),
      getProp(rawInput, "uuid"),
      getProp(rawInput, "name"),
    ) || Math.random().toString(36).slice(2);

  const name =
    getFirstString(
      getProp(rawInput, "name"),
      getPath(rawInput, ["instance", "name"]),
      getProp(rawInput, "instanceName"),
      getProp(rawInput, "sessionName"),
      getProp(rawInput, "deviceName"),
      id
    ) || "(sem nome)";

  const number =
    getFirstString(
      getProp(rawInput, "number"),
      getPath(rawInput, ["instance", "number"]),
      getProp(rawInput, "phone"),
      getPath(rawInput, ["me", "id"]),
      getPath(rawInput, ["me", "user"]),
      getProp(rawInput, "jid")
    ) || "";

  const photoCandidate =
    getProp(rawInput, "photo") ??
    getProp(rawInput, "profilePic") ??
    getProp(rawInput, "profile_picture_url") ??
    getProp(rawInput, "avatar") ??
    getProp(rawInput, "profilePicUrl") ??
    getPath(rawInput, ["me", "photo"]) ??
    getPath(rawInput, ["me", "profilePicUrl"]) ??
    getPath(rawInput, ["instance", "photo"]) ??
    "";

  let photo = "";
  if (typeof photoCandidate === "string") {
    const p = photoCandidate.trim();
    if (p.startsWith("data:image/")) {
      photo = p;
    } else if (/^https?:\/\//i.test(p)) {
      photo = p;
    } else if (p) {
      const base = API_URL.replace(/\/+$/, "");
      const rel = p.replace(/^\/+/, "");
      photo = `${base}/${rel}`;
    }
  }

  const connected =
    getBoolean(getProp(rawInput, "connected")) ??
    getBoolean(getProp(rawInput, "isConnected")) ??
    (getFirstString(getProp(rawInput, "status")) === "connected" ? true : null) ??
    (getFirstString(getProp(rawInput, "state")) === "CONNECTED" ? true : null) ??
    getBoolean(getPath(rawInput, ["instance", "connected"])) ??
    false;

  const status =
    getFirstString(
      getProp(rawInput, "status"),
      getProp(rawInput, "state"),
      getProp(rawInput, "connectionStatus"),
      connected ? "connected" : "disconnected"
    ) || (connected ? "connected" : "disconnected");

  const device =
    getFirstString(
      getProp(rawInput, "device"),
      getProp(rawInput, "platform"),
      getPath(rawInput, ["me", "platform"]),
      getPath(rawInput, ["instance", "device"])
    ) || "—";

  const lastSeenRaw =
    getProp(rawInput, "lastSeen") ??
    getProp(rawInput, "lastOnline") ??
    getPath(rawInput, ["instance", "lastSeen"]) ??
    null;

  const lastSeen =
    typeof lastSeenRaw === "string" || typeof lastSeenRaw === "number" || lastSeenRaw instanceof Date
      ? new Date(lastSeenRaw as unknown as string).toISOString()
      : null;

  return {
    id,
    name,
    number,
    photo,
    connected,
    status,
    device,
    lastSeen,
  };
}

/* ========= Handler ========= */
export async function GET() {
  try {
    if (!okEnv()) {
      return NextResponse.json(
        { items: [], error: "UAZAPIGO_API_URL ou UAZAPIGO_ADMIN_TOKEN não configurados" },
        { status: 200 }
      );
    }

    const attempts = [
      `${API_URL}/instance/all`,
      `${API_URL}/instances`,
      `${API_URL}/instance/list`,
    ];

    let data: unknown = null;

    for (const url of attempts) {
      try {
        const res = await fetch(url, {
          headers: { admintoken: ADMIN_TOKEN, Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) continue;

        const json = await safeJson(res);

        if (Array.isArray(json)) {
          data = json;
          break;
        }

        if (isObj(json)) {
          const arr =
            getFirstArrayFromKeys(json, ["instances", "data", "list", "items"]) ?? null;
          if (arr) {
            data = arr;
            break;
          }
        }
      } catch {
        // tenta próximo endpoint
      }
    }

    const items: Normalized[] = Array.isArray(data)
      ? (data
          .map((x) => normalize(x))
          .filter((v): v is Normalized => v !== null))
      : [];

    return NextResponse.json({ items }, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Falha ao obter instâncias";
    return NextResponse.json({ items: [], error: msg }, { status: 200 });
  }
}
