import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// This client is used ONLY in Server Components and API Route Handlers
// It reads the session from the incoming HTTP request cookies
// Never import this in a client component - it will throw an error
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component - safe to ignore
            // Middleware handles cookie refresh separately
          }
        },
      },
    }
  )
}

// Admin client - service_role key - ONLY for API routes that need to bypass RLS
// Example: Creating audit logs, system-level writes
export function createAdminSupabaseClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}