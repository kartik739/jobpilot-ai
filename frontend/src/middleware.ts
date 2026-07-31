import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Read the httpOnly access_token cookie set by the backend
  const token = request.cookies.get('access_token')?.value
  const isAuthenticated = !!token

  const isAuthPage = pathname === '/login' || pathname === '/register'

  // Redirect authenticated users away from auth pages to dashboard
  if (isAuthenticated && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Redirect unauthenticated users from protected routes to login
  if (!isAuthenticated && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!login|register|_next|api/health).*)'],
}
