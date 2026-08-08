import { NextResponse, type NextRequest } from "next/server";
import { verifyStudentToken, verifyBuyerToken, verifyAdminToken, signBuyerToken, signStudentToken } from "@/lib/auth";
import { isDemoMode, STUDENT_COOKIE, BUYER_COOKIE, ADMIN_COOKIE, SESSION_MAX_AGE } from "@/lib/config";

const ROLLING_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

/**
 * Aggressive scrapers that hammer unauthenticated force-dynamic pages.
 * Social preview UAs (facebookexternalhit, WhatsApp, Twitterbot, Slackbot) are
 * intentionally NOT matched — they need real HTML/OG tags.
 */
const AGGRESSIVE_BOT_RE =
  /AhrefsBot|SemrushBot|DotBot|MJ12bot|Bytespider|PetalBot|GPTBot|CCBot|ClaudeBot|DataForSeo|magpie-crawler|Amazonbot|Applebot-Extended|cohere-ai|Diffbot|ImagesiftBot|meta-externalagent/i;

/** Still force-dynamic + public (no session) — expensive for scrapers. */
function isUnauthForceDynamicPublic(pathname: string): boolean {
  if (pathname === "/courses" || pathname.startsWith("/courses/")) return true;
  if (pathname === "/enroll" || pathname.startsWith("/enroll/")) return true;
  if (pathname === "/quizzes" || pathname.startsWith("/quizzes/")) return true;
  if (pathname === "/home-cinematic" || pathname.startsWith("/home-cinematic/")) return true;
  if (pathname === "/payment/status" || pathname.startsWith("/payment/")) return true;
  if (pathname === "/current-affairs/saved") return true;
  if (pathname.startsWith("/lecture/")) return true;
  return false;
}

function hasAppSession(req: NextRequest): boolean {
  return !!(
    req.cookies.get(BUYER_COOKIE)?.value ||
    req.cookies.get(STUDENT_COOKIE)?.value ||
    req.cookies.get(ADMIN_COOKIE)?.value
  );
}

/**
 * Route protection + bot short-circuit.
 * - /dashboard*  -> requires a valid student token
 * - /portal*     -> requires a valid buyer token (except login)
 * - Aggressive bots on unauthenticated force-dynamic public routes → 403
 * In DEMO MODE everything is allowed so the portal is fully explorable with zero setup.
 * Never throws — falls through to allow on any unexpected error.
 */
export async function middleware(req: NextRequest) {
  try {
    if (isDemoMode) return NextResponse.next();

    const { pathname } = req.nextUrl;
    const ua = req.headers.get("user-agent") || "";

    if (
      !hasAppSession(req) &&
      isUnauthForceDynamicPublic(pathname) &&
      AGGRESSIVE_BOT_RE.test(ua)
    ) {
      return new NextResponse("Forbidden", {
        status: 403,
        headers: { "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex" },
      });
    }

    if (pathname.startsWith("/dashboard")) {
      const token = req.cookies.get(STUDENT_COOKIE)?.value;
      const session = await verifyStudentToken(token);
      if (!session) {
        // Staff comp access: a valid admin/staff session may browse the student
        // experience for QA/training. Pass through (no student cookie re-issue).
        if (await verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        // Cookie present but invalid = expired session → graceful re-login prompt.
        if (token) url.searchParams.set("expired", "1");
        return NextResponse.redirect(url);
      }
      // Rolling session: re-issue a fresh token on activity so an active student
      // is never logged out mid-use (auto-logout only after idle TTL). Subscription
      // expiry/revoke is still enforced DB-fresh on every gated API call.
      const res = NextResponse.next();
      const fresh = await signStudentToken({
        student_id: session.student_id,
        name: session.name,
        plan: session.plan,
        expiry_date: session.expiry_date,
      });
      res.cookies.set(STUDENT_COOKIE, fresh, ROLLING_COOKIE_OPTS);
      return res;
    }

    // Buyer portal: everything under /portal needs a buyer session except the
    // login/forgot screen itself.
    if (pathname.startsWith("/portal") && !pathname.startsWith("/portal/login")) {
      const token = req.cookies.get(BUYER_COOKIE)?.value;
      const session = await verifyBuyerToken(token);
      if (!session) {
        if (await verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
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
      // Preserve the session/access version so rolling never resets it; the
      // version is validated DB-fresh in getBuyerSession on each page/API load.
      const fresh = await signBuyerToken({ buyer_id: session.buyer_id, phone: session.phone, name: session.name, sv: session.sv });
      res.cookies.set(BUYER_COOKIE, fresh, ROLLING_COOKIE_OPTS);
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
  matcher: [
    "/dashboard/:path*",
    "/portal/:path*",
    "/courses",
    "/courses/:path*",
    "/enroll",
    "/enroll/:path*",
    "/quizzes",
    "/quizzes/:path*",
    "/home-cinematic",
    "/home-cinematic/:path*",
    "/payment/:path*",
    "/current-affairs/saved",
    "/lecture/:path*",
  ],
};
