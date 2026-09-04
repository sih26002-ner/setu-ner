import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Define which routes require authentication and which roles can access them
const PROTECTED_ROUTES = {
  '/dashboard/field': ['field_officer', 'super_admin'],
  '/dashboard/driver': ['driver', 'super_admin'],
  '/dashboard/admin': ['district_admin', 'super_admin'],
  '/dashboard/super': ['super_admin'],
  '/api/incidents': ['field_officer', 'district_admin', 'super_admin'],
  '/api/trips': ['driver', 'district_admin', 'super_admin'],
  '/api/alerts': ['district_admin', 'super_admin'],
  '/api/admin/ingest-roads': ['super_admin'],
}

// Public PAGES - exact match, no login required
const PUBLIC_ROUTES = ['/', '/login', '/map']

// Public API PREFIXES - any route starting with these is readable without login
// Only put read-only, non-sensitive data endpoints here
const PUBLIC_API_PREFIXES = ['/api/map/']

export async function middleware(request) {
 
  const { pathname } = request.nextUrl

  // Allow public routes through immediately - no auth check needed
    const isPublicRoute =
    PUBLIC_ROUTES.some(route => pathname === route) ||
    PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))

  if (isPublicRoute) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  // Create a Supabase client that can read/write cookies in middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired - this is critical for long sessions
  // Do NOT use getSession() here - it is not reliable in middleware
  // getUser() makes a network call to Supabase to validate the token
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  // No valid session - redirect to login
  if (!user || userError) {
    // If it is an API route, return 401 JSON instead of redirect
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'You must be logged in to access this resource',
        },
        { status: 401 }
      )
    }
    // For page routes, redirect to login with the original URL as a redirect param
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // User is authenticated - now check role-based access
  // Fetch the user's profile to get their role
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, district_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // Authenticated but no profile - edge case (should not happen with our trigger)
    // Send them to login to re-authenticate
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  // Check if this specific route has role restrictions
  const matchedProtectedRoute = Object.keys(PROTECTED_ROUTES).find(route =>
    pathname.startsWith(route)
  )

  if (matchedProtectedRoute) {
    const allowedRoles = PROTECTED_ROUTES[matchedProtectedRoute]
    if (!allowedRoles.includes(profile.role)) {
      // User authenticated but wrong role - redirect to their correct dashboard
      const roleDashboardMap = {
        field_officer: '/dashboard/field',
        driver: '/dashboard/driver',
        district_admin: '/dashboard/admin',
        super_admin: '/dashboard/super',
      }
      const correctDashboard = roleDashboardMap[profile.role] || '/login'
      return NextResponse.redirect(new URL(correctDashboard, request.url))
    }
  }

  // All checks passed - allow the request through
  // Attach user info to request headers so downstream routes can read it
  // without making another database call
  supabaseResponse.headers.set('x-user-id', user.id)
  supabaseResponse.headers.set('x-user-role', profile.role)
  supabaseResponse.headers.set('x-user-district', profile.district_id || '')

  return supabaseResponse
}

// Tell Next.js which routes this middleware should run on
// Exclude static files, images, and Next.js internals for performance
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}