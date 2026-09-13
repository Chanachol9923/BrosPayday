import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Where Google sends people back to. Swaps the one-time code for a session and
 * drops them on the page they started from.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !url || !anonKey) {
    return NextResponse.redirect(`${origin}/?signin=failed`);
  }

  const store = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) store.set(name, value, options);
      },
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/?signin=failed`);

  return NextResponse.redirect(`${origin}${next}`);
}
