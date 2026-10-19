import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy (formerly "middleware"): a cheap first-line redirect for signed-out visitors.
 * It only checks that a session cookie exists; real authentication and RBAC are enforced by the
 * API on every request.
 */
const REFRESH_COOKIE = 'ctp_rt';

export function proxy(request: NextRequest) {
  if (!request.cookies.has(REFRESH_COOKIE)) {
    const url = request.nextUrl.clone();
    const staffArea = /^\/(master|admin)(\/|$)/.test(request.nextUrl.pathname);
    url.pathname = staffArea ? '/master-login' : '/login';
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/admin/:path*', '/master/:path*', '/broker/:path*', '/strategies/:path*', '/copy-trading/:path*', '/orders/:path*', '/positions/:path*', '/trades/:path*'],
};
