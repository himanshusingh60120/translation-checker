import { NextResponse, type NextRequest } from 'next/server';

// Optional Basic Auth for the whole app: set BASIC_AUTH_USER and BASIC_AUTH_PASS in Vercel.
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      if (i >= 0 && decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) return NextResponse.next();
    } catch {
      /* fall through */
    }
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Translation QA"' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
