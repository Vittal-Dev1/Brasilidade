import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "chave-super-secreta";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  // ⚠️ Substituir por checagem real (banco, Supabase, etc.)
  if (email === "admin@teste.com" && password === "123456") {
    const token = jwt.sign({ email }, SECRET, { expiresIn: "2h" });
    return NextResponse.json({ token });
  }

  return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
}
