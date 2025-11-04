// src/app/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_ANON_KEY!;

if (!url || !key) {
  // Evita erro silencioso em server routes
  console.warn("⚠️ SUPABASE_URL ou SUPABASE_ANON_KEY ausentes no .env.local");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
