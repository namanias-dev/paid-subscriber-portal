#!/usr/bin/env python3
"""Start the desktop OAuth flow for gmail.readonly. Does not read mail."""

from otp_helper import CLIENT, load_credentials, gmail_service, verify_profile

def main() -> None:
    if not CLIENT.exists():
        raise SystemExit(
            "Save the Desktop OAuth client JSON as scripts/local/shipping-gmail-otp/client_secret.json "
            "and run this again. Scope must be https://www.googleapis.com/auth/gmail.readonly only."
        )
    service = gmail_service(load_credentials())
    email = verify_profile(service)
    print(f"GMAIL_READONLY_OK {email}")


if __name__ == "__main__":
    main()
