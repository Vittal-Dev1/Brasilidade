// src/app/lib/supabaseServer.ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';

function pickEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

function required(name: string, ...aliases: string[]) {
  const v = pickEnv(name, ...aliases);
  if (!v) throw new Error(`Missing env: ${name}${aliases.length ? ` (or ${aliases.join(', ')})` : ''}`);
  return v;
}

export function getServiceRoleClient() {
  // aceita SUPABASE_URL (server) ou NEXT_PUBLIC_SUPABASE_URL (public)
  const url = required('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
