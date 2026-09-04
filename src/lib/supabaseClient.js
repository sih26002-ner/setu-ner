import { createBrowserClient } from '@supabase/ssr'

// This client is used ONLY in client components (browser-side)
// It reads sessions from cookies automatically
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}