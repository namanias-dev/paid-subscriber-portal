import unittest
from datetime import datetime, timezone

from otp_helper import auth_results_ok, extract_otp, from_domain, parse_after


class ParseTests(unittest.TestCase):
    def test_from_domain_ignores_display_name(self):
        self.assertEqual(from_domain("Shiprocket <no-reply@shiprocket.com>"), "shiprocket.com")
        self.assertEqual(from_domain("Shiprocket <evil@example.com>"), "example.com")

    def test_auth_results_require_pass_and_domain(self):
        domains = {"shiprocket.com"}
        self.assertTrue(auth_results_ok({"authentication-results": "dkim=pass header.d=shiprocket.com"}, domains))
        self.assertFalse(auth_results_ok({"authentication-results": "dkim=pass header.d=evil.com"}, domains))
        self.assertFalse(auth_results_ok({}, domains))

    def test_otp_extraction(self):
        self.assertEqual(extract_otp("Your OTP", "Your OTP is 123456"), "123456")
        self.assertIsNone(extract_otp("Reset your password", "code 123456"))
        self.assertIsNone(extract_otp("OTP", "123456 and 654321"))

    def test_after_parses_zulu(self):
        when = parse_after("2026-09-23T17:40:00Z")
        self.assertEqual(when, datetime(2026, 9, 23, 17, 40, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
