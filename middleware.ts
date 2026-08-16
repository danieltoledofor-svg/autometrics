import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const allowedOrigins = [
  'https://autometrics.cloud',
  'https://www.autometrics.cloud',
  'https://staging.autometrics.cloud',
  'http://localhost:3000'
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── CORS (API routes) ─────────────────────────────────────────────────────
  // Page route protection is handled client-side via useAuthGuard (Supabase
  // stores sessions in localStorage, not cookies, so middleware cannot verify them)
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
  matcher: '/api/:path*',
};
