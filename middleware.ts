import { NextResponse, type NextRequest } from "next/server";
import { verifyStudentToken, verifyAdminToken } from "@/lib/auth";
import { isDemoMode, STUDENT_COOKIE, ADMIN_COOKIE } from "@/lib/config";

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

    // /admin itself is the login page; protect deeper admin app state via the page+API.
    // The page client-side checks session; APIs enforce admin token server-side.
    return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
