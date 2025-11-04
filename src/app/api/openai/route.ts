// src/app/api/openai/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  prompt: string;
  model: string; // ex.: "gpt-4.1-mini"
};

function isBody(v: unknown): v is Body {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).prompt === "string" &&
    typeof (v as Record<string, unknown>).model === "string"
  );
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY não configurada no ambiente" },
        { status: 500 }
      );
    }

    const json: unknown = await req.json().catch(() => null);
    if (!isBody(json)) {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    const { prompt, model } = json;

    const client = new OpenAI({ apiKey });

    // Chat Completions para modelos compatíveis
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });

    const message = completion.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ message });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("OPENAI ROUTE ERROR:", msg);
    return NextResponse.json({ error: "Falha ao gerar mensagem" }, { status: 500 });
  }
}
