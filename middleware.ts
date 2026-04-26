import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const allowedOrigins = [
  'https://autometrics.cloud',
  'https://staging.autometrics.cloud',
  'http://localhost:3000' // Local development
];

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '';
  
  // CORS Check: Allow if origin matches our list, OR if it's a server-to-server request (no origin, e.g. webhooks)
  if (origin && !allowedOrigins.includes(origin)) {
    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'text/plain',
      },
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

// Applies this middleware only to API routes
export const config = {
  matcher: '/api/:path*',
};
