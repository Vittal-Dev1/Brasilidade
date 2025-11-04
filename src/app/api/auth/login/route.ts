import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "chave-super-secreta";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (email === "brazilidadeia@gmail.com" && password === "brazilidadeia5555") {
    const token = jwt.sign({ email }, SECRET, { expiresIn: "2h" });
    return NextResponse.json({ token });
  }

  return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
}