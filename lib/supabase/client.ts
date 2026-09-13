'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Cloud sync is opt-in. With no keys set the app runs exactly as it always has —
 * everything in the browser, no sign-in, nothing uploaded — so a missing config is
 * a supported mode rather than a failure. See SETUP.md.
 */
export const cloudConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (!client) client = createBrowserClient(url as string, anonKey as string);
  return client;
}
