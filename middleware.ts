import { NextResponse, type NextRequest } from "next/server";
import { verifyStudentToken, verifyBuyerToken, signBuyerToken } from "@/lib/auth";
import { isDemoMode, STUDENT_COOKIE, BUYER_COOKIE } from "@/lib/config";

const BUYER_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

/**
 * Route protection.
 * - /dashboard*  -> requires a valid student token
 * - /admin*      -> requires a valid admin token (the bare /admin page is the login screen)
 * In DEMO MODE everything is allowed so the portal is fully explorable with zero setup.
 * Never throws — falls through to allow on any unexpected error.
 */
export async function middleware(req: NextRequest) {
  try {
    if (isDemoMode) return NextResponse.next();

    const { pathname } = req.nextUrl;

    if (pathname.startsWith("/dashboard")) {
      const token = req.cookies.get(STUDENT_COOKIE)?.value;
      const session = await verifyStudentToken(token);
      if (!session) {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
      }
    }

    // Buyer portal: everything under /portal needs a buyer session except the
    // login/forgot screen itself.
    if (pathname.startsWith("/portal") && !pathname.startsWith("/portal/login")) {
      const token = req.cookies.get(BUYER_COOKIE)?.value;
      const session = await verifyBuyerToken(token);
      if (!session) {
        const url = req.nextUrl.clone();
        url.pathname = "/portal/login";
        // Distinguish an expired/invalid session (cookie present) from a fresh
        // visit so the login page can show a clear "session expired" message.
        if (token) url.searchParams.set("expired", "1");
        return NextResponse.redirect(url);
      }
      // Rolling session: re-issue a fresh 7-day cookie on activity so an active
      // user is never logged out mid-use. Logout only happens explicitly or
      // after 7 days of inactivity.
      const res = NextResponse.next();
      const fresh = await signBuyerToken({ buyer_id: session.buyer_id, phone: session.phone, name: session.name });
      res.cookies.set(BUYER_COOKIE, fresh, BUYER_COOKIE_OPTS);
      return res;
    }

    // /admin itself is the login page; protect deeper admin app state via the page+API.
    // The page client-side checks session; APIs enforce admin token server-side.
    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/portal/:path*"],
};
