import json
import unittest
from unittest.mock import patch

from lesspass.remote import (
    blind,
    derive_remote,
    finish_entropy,
    normalize_server_url,
    RemoteError,
    settings_digest,
)


PROFILE = {
    "site": "example.org",
    "login": "alice@example.org",
    "counter": 1,
    "length": 16,
    "lowercase": True,
    "uppercase": True,
    "digits": True,
    "symbols": True,
    "salt_fields": [{"key": "b", "value": "2"}, {"key": "a", "value": "1"}],
}


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.body).encode()


class RemoteTests(unittest.TestCase):
    def test_url_normalization(self):
        self.assertEqual(normalize_server_url("  http://localhost:8787/// "), "http://localhost:8787")
        with self.assertRaisesRegex(RemoteError, "http:// or https://"):
            normalize_server_url("localhost:8787")

    def test_rust_vectors(self):
        self.assertEqual(
            settings_digest(PROFILE).hex(),
            "21aef735d75b51c62e732e6d38088fcf70ac8bb73adb59d5da04916a0283c417",
        )
        input_bytes, local_key = blind(PROFILE, "correct horse battery staple")
        self.assertEqual(
            input_bytes.hex(),
            "a5d9cd6de9e6e665e2dbe35804538aa6382bfcf938c49eb05eb0146c500cac38",
        )
        self.assertEqual(
            finish_entropy(local_key, bytes([0x42]) * 32).hex(),
            "cf777b92594f4a7196a95f5cf67a75ea3bd3cc986b575034dfe6dae7e348673e",
        )

    def test_salt_order_and_mocked_derive(self):
        reversed_profile = dict(PROFILE, salt_fields=list(reversed(PROFILE["salt_fields"])))
        self.assertEqual(settings_digest(PROFILE), settings_digest(reversed_profile))
        with patch("lesspass.remote.urllib.request.urlopen", return_value=Response({"output": "42" * 32})) as open_url:
            self.assertEqual(derive_remote("http://localhost:8787", None, "ab" * 32), bytes([0x42]) * 32)
        self.assertEqual(open_url.call_args.kwargs["timeout"], 30)
