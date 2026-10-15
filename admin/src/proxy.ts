import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate: no session cookie -> login. The API still verifies the token on every call.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("hb_session")) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|logout|_next/static|_next/image|favicon.ico).*)"],
};
