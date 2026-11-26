import { NextResponse, type NextRequest } from "next/server";

/**
 * The phone mockup lives at /preview/<code>. Anything without the right code
 * gets a real 404 before the page starts rendering, and nothing under
 * /preview is ever indexed.
 */
export function proxy(request: NextRequest) {
  const code = request.nextUrl.pathname.split("/")[2] ?? "";
  const expected = process.env.MOCKUP_KEY;
  if (!expected || code !== expected) {
    return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  }
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/preview", "/preview/:path*"],
};
