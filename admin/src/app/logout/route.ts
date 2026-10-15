import { NextResponse, type NextRequest } from "next/server";

// Clears an expired/invalid session and returns to the login page.
export function GET(request: NextRequest) {
  const url = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("expired")) url.searchParams.set("expired", "1");
  const res = NextResponse.redirect(url);
  res.cookies.delete("hb_session");
  return res;
}
