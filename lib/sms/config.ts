/**
 * SMS configuration — env reading (BACKEND-ONLY, secrets never returned to the
 * client) + the public login/destination URLs used inside template bodies.
 */
import { SITE_URL } from "../config";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * JustGoSMS endpoints are HTTP-only: the host (Apache 2.4.6 / PHP 5.4) accepts a
 * TCP connection on 443 but kills the TLS handshake (SSL_ERROR_SYSCALL), so HTTPS
 * fails from every egress incl. Vercel. We therefore default to http:// on
 * purpose (overridable via env). Credentials travel in the query string either
 * way — this is the gateway's own design; DLT-templated content is non-sensitive.
 */
export const SMS_API_BASE_URL = env("SMS_API_BASE_URL") || "http://justgosms.com/http-api.php";
/** Delivery-report PULL API (http-dlr.php?username&password&msg_id=). */
export const SMS_DLR_BASE_URL = env("SMS_DLR_BASE_URL") || "http://justgosms.com/http-dlr.php";
/** Route 12 is the provisioned domestic route for this account (verified via http-credit.php). */
export const SMS_DEFAULT_ROUTE = env("SMS_API_DEFAULT_ROUTE") || "12";
export const SMS_DEFAULT_SENDER_ID = env("SMS_API_DEFAULT_SENDER_ID") || "NAMIAS";

/** Wire format for the gateway `number` param. Confirm against JustGoSMS sample. */
export function smsNumberFormat(): "10digit" | "91prefix" {
  return env("SMS_NUMBER_FORMAT") === "91prefix" ? "91prefix" : "10digit";
}

/** True only when ALL gateway credentials are present (live send possible). */
export function gatewayConfigured(): boolean {
  return !!(env("SMS_API_AUTH_KEY") && env("SMS_API_USERNAME") && env("SMS_API_PASSWORD") && SMS_API_BASE_URL);
}

/**
 * Hard kill switch from env. Defaults to OFF — sending is disabled unless
 * SMS_ENABLED is explicitly "true" (set it only after a DLT id is pasted and one
 * manual test has passed).
 */
export function smsEnvEnabled(): boolean {
  return env("SMS_ENABLED") === "true";
}

export function envDailyCap(): number {
  return Math.max(0, Number(env("SMS_DAILY_CAP")) || 0);
}
export function envPerMobileDailyCap(): number {
  return Math.max(0, Number(env("SMS_PER_MOBILE_DAILY_CAP")) || 0);
}

// --- Destination URLs embedded in bodies (non-secret; short link recommended) ---
const stripProto = (u: string) => u.replace(/^https?:\/\//, "");

/** Portal login link ({login_url} for most templates). Set SMS_LOGIN_URL to a short link. */
export function portalLoginUrl(): string {
  return env("SMS_LOGIN_URL") || `${SITE_URL}/portal/login`;
}
/** Webinars list ({login_url} for T12/T13). */
export function webinarsListUrl(): string {
  return env("SMS_WEBINARS_URL") || `${SITE_URL}/webinars`;
}
/** Course / admissions page ({login_url} for T19). */
export function courseAdmissionsUrl(): string {
  return env("SMS_COURSE_URL") || `${SITE_URL}/courses`;
}

/** login_url as it appears in the message for a given template id. */
export function loginUrlForTemplate(templateId: string): string {
  if (templateId === "sameday_10am_invite" || templateId === "general_webinar_invite") return webinarsListUrl();
  if (templateId === "post_webinar_thankyou") return courseAdmissionsUrl();
  return portalLoginUrl();
}

/** A short-ish login_url sample for the DLT worst-case counter. */
export function loginUrlSample(): string {
  return stripProto(portalLoginUrl());
}

/**
 * Non-secret config snapshot for the Settings tab. NEVER returns secret values —
 * only whether each secret is configured.
 */
export function envStatus() {
  return {
    baseUrl: SMS_API_BASE_URL,
    route: SMS_DEFAULT_ROUTE,
    senderId: SMS_DEFAULT_SENDER_ID,
    numberFormat: smsNumberFormat(),
    enabledByEnv: smsEnvEnabled(),
    gatewayConfigured: gatewayConfigured(),
    authKeySet: !!env("SMS_API_AUTH_KEY"),
    usernameSet: !!env("SMS_API_USERNAME"),
    passwordSet: !!env("SMS_API_PASSWORD"),
    envDailyCap: envDailyCap(),
    envPerMobileDailyCap: envPerMobileDailyCap(),
    loginUrl: portalLoginUrl(),
    webinarsUrl: webinarsListUrl(),
    courseUrl: courseAdmissionsUrl(),
  };
}
