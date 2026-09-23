#!/usr/bin/env python3
"""Local, read-only helper for Shiprocket and Delhivery login emails.

Not part of the Notes Store deploy. Uses the Gmail API scope gmail.readonly.
It never modifies the mailbox: no send, delete, archive, label, or mark-as-read.

OAuth client JSON belongs in client_secret.json next to this file (gitignored).
The refresh token is written to token.json (gitignored, mode 600).

Usage:
  python3 auth_setup.py
  python3 otp_helper.py --provider shiprocket --after 2026-09-23T17:40:00Z
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parseaddr
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLIENT = ROOT / "client_secret.json"
TOKEN = ROOT / "token.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Domain of the From address must match. Display name is not trusted.
PROVIDERS = {
    "shiprocket": {"shiprocket.com", "shiprocket.in", "shiprocket.co"},
    "delhivery": {"delhivery.com"},
}

RESET_RE = re.compile(r"password reset|reset your password|forgot password", re.I)
ANY_SIX_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")


def parse_after(value: str) -> datetime:
    text = value.strip().replace("Z", "+00:00")
    when = datetime.fromisoformat(text)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc)


def header_map(payload: dict) -> dict[str, str]:
    headers = (payload or {}).get("headers") or []
    return {str(h.get("name", "")).lower(): str(h.get("value", "")) for h in headers}


def from_domain(from_header: str) -> str:
    _name, addr = parseaddr(from_header)
    if "@" not in addr:
        return ""
    return addr.rsplit("@", 1)[1].lower().strip()


def auth_results_ok(headers: dict[str, str], domains: set[str]) -> bool:
    blob = headers.get("authentication-results", "")
    if not blob:
        return False
    low = blob.lower()
    dkim = "dkim=pass" in low
    spf = "spf=pass" in low
    domain_hit = any(d in low for d in domains)
    return domain_hit and (dkim or spf)


def walk_text(payload: dict) -> str:
    parts = []
    mime = payload.get("mimeType") or ""
    body = (payload.get("body") or {}).get("data")
    if body and mime in ("text/plain", "text/html"):
        import base64

        parts.append(base64.urlsafe_b64decode(body.encode()).decode("utf-8", "replace"))
    for child in payload.get("parts") or []:
        parts.append(walk_text(child))
    return "\n".join(parts)


def extract_otp(subject: str, body: str) -> str | None:
    hay = f"{subject}\n{body}"
    if RESET_RE.search(hay):
        return None
    if not re.search(r"otp|verification|login code|security code|one[- ]time", hay, re.I):
        return None
    codes = list(dict.fromkeys(ANY_SIX_RE.findall(hay)))
    if len(codes) != 1:
        return None
    return codes[0]


def load_credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
        if creds and creds.scopes and "https://www.googleapis.com/auth/gmail.readonly" not in creds.scopes:
            raise SystemExit("Stored token is not limited to gmail.readonly. Delete token.json and authorize again.")
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN.write_text(creds.to_json())
        os.chmod(TOKEN, 0o600)
    if not creds or not creds.valid:
        if not CLIENT.exists():
            raise SystemExit(
                "Missing client_secret.json. Create a Desktop OAuth client with only the "
                "gmail.readonly scope and save the download next to this script. Do not commit it."
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT), SCOPES)
        creds = flow.run_local_server(port=8765, open_browser=False, prompt="consent")
        TOKEN.write_text(creds.to_json())
        os.chmod(TOKEN, 0o600)
    return creds


def gmail_service(creds):
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def verify_profile(service) -> str:
    profile = service.users().getProfile(userId="me").execute()
    return str(profile.get("emailAddress") or "")


def get_shipping_otp(*, provider: str, requested_after: datetime, service=None) -> dict:
    domains = PROVIDERS.get(provider)
    if not domains:
        raise ValueError("provider must be shiprocket or delhivery")
    if service is None:
        service = gmail_service(load_credentials())
    domain_q = " OR ".join(f"from:{d}" for d in sorted(domains))
    query = (
        f"({domain_q}) newer_than:1d "
        "(OTP OR verification OR \"login code\" OR \"one time\" OR \"one-time\") "
        "-reset -password"
    )
    listed = (
        service.users()
        .messages()
        .list(userId="me", q=query, maxResults=5, includeSpamTrash=False)
        .execute()
    )
    ids = [m["id"] for m in listed.get("messages") or []]
    newest = None
    for mid in ids:
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=mid, format="full")
            .execute()
        )
        headers = header_map(msg.get("payload") or {})
        domain = from_domain(headers.get("from", ""))
        if domain not in domains:
            continue
        if not auth_results_ok(headers, domains):
            continue
        internal = int(msg.get("internalDate") or 0) / 1000
        sent = datetime.fromtimestamp(internal, tz=timezone.utc)
        if sent < requested_after:
            continue
        subject = headers.get("subject", "")
        body = walk_text(msg.get("payload") or {})
        code = extract_otp(subject, body)
        candidate = {
            "provider": provider,
            "found": True,
            "sent_at": sent.isoformat(),
            "otp": code,
            "expires_in": None,
        }
        if newest is None or sent > datetime.fromisoformat(newest["sent_at"]):
            newest = candidate
    if not newest or not newest.get("otp"):
        return {"provider": provider, "found": False, "sent_at": None, "otp": None, "expires_in": None}
    return newest


def main() -> int:
    parser = argparse.ArgumentParser(description="Find a shipping-login OTP without printing it.")
    parser.add_argument("--provider", required=True, choices=sorted(PROVIDERS))
    parser.add_argument("--after", required=True, help="ISO timestamp. Only newer mail is eligible.")
    parser.add_argument("--handoff", help="Write the code to this file (mode 600) for the login script. The file is not a log.")
    parser.add_argument("--check", action="store_true", help="Verify OAuth and print the mailbox address only.")
    args = parser.parse_args()
    creds = load_credentials()
    service = gmail_service(creds)
    if args.check:
        print(verify_profile(service) or "NO PROFILE")
        return 0
    result = get_shipping_otp(provider=args.provider, requested_after=parse_after(args.after), service=service)
    if not result["found"] or not result["otp"]:
        print("NO MATCHING AUTHENTICATION EMAIL")
        return 1
    print(f"MATCH provider={result['provider']} sent_at={result['sent_at']}")
    if args.handoff:
        path = Path(args.handoff)
        path.write_text(result["otp"] + "\n")
        os.chmod(path, 0o600)
    return 0


if __name__ == "__main__":
    sys.exit(main())
