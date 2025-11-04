// app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'arquivo ausente' }, { status: 400 });
    }

    // (opcional) validação de tamanho
    const MAX = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX) {
      return NextResponse.json({ error: 'arquivo muito grande' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = path.extname(file.name) || '';
    const base = path.basename(file.name, ext);
    const slug =
      base
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-') || 'file';

    const hash = crypto.randomBytes(6).toString('hex');
    const filename = `${slug}-${hash}${ext || ''}`;

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, filename), buffer);

    // Next serve 'public' estatico => URL pública
    const url = `/uploads/${filename}`;

    return NextResponse.json({
      url,
      mime: file.type || 'application/octet-stream',
      filename: file.name,
      size: file.size,
    });
  } catch (e: unknown) {
  const message =
    e instanceof Error ? e.message : typeof e === "string" ? e : "falha no upload";
  return NextResponse.json({ error: message }, { status: 500 });
}
}
