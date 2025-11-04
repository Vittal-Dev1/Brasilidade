import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "chave-super-secreta";

export async function POST(req: Request) {
  try {
    const { token } = await req.json();
    const decoded = jwt.verify(token, SECRET);
    return NextResponse.json({ valid: true, decoded });
  } catch {
    return NextResponse.json({ valid: false }, { status: 401 });
  }
}
