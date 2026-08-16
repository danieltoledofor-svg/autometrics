import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const allowedOrigins = [
  'https://autometrics.cloud',
  'https://www.autometrics.cloud',
  'https://staging.autometrics.cloud',
  'http://localhost:3000'
];

// Routes that require an authenticated Supabase session
const PROTECTED_ROUTES = [
  '/products',
  '/dashboard',
  '/planning',
  '/integration',
  '/manual-entry',
];

function isAuthenticated(request: NextRequest): boolean {
  const cookies = request.cookies.getAll();
  // Supabase v2 stores the session in a cookie named sb-<project-ref>-auth-token
  return cookies.some(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token') && c.value.length > 0
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Route protection (page routes) ───────────────────────────────────────
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  if (isProtected) {
    if (!isAuthenticated(request)) {
      const loginUrl = new URL('/', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── CORS (API routes) ─────────────────────────────────────────────────────
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const origin = request.headers.get('origin') ?? '';

  if (origin && !allowedOrigins.includes(origin)) {
    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const response = NextResponse.next();

  if (allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-client-info, apikey');

  return response;
}

export const config = {
  // Run on both page and API routes (exclude static assets and Next internals)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png|.*\\.png$).*)',
  ],
};
