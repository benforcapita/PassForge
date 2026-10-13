import hashlib
import hmac
import json
import struct
import urllib.error
import urllib.request

from lesspass.password import _render_password

PROTOCOL = "passforge-remote-v1"
DEFAULT_CRYPTO = {"digest": "sha256", "iterations": 100000}


class RemoteError(Exception):
    pass


def normalize_server_url(url):
    normalized = url.strip().rstrip("/")
    if not normalized.startswith(("http://", "https://")):
        raise RemoteError("algorithm server URL must start with http:// or https://")
    return normalized


def _lp(value):
    encoded = value.encode("utf-8")
    return struct.pack(">I", len(encoded)) + encoded


def settings_digest(profile):
    flags = sum(
        bit for key, bit in (
            ("lowercase", 1), ("uppercase", 2), ("digits", 4), ("symbols", 8)
        ) if profile[key]
    )
    fields = sorted(profile.get("salt_fields", []), key=lambda item: (item["key"], item["value"]))
    payload = b"passforge-settings-v1" + struct.pack(">I", profile["counter"])
    payload += bytes([flags]) + struct.pack(">I", profile["length"])
    payload += struct.pack(">I", len(fields))
    for field in fields:
        payload += _lp(field["key"]) + _lp(field["value"])
    return hashlib.sha256(payload).digest()


def blind(profile, master_password, crypto=None):
    crypto = crypto or DEFAULT_CRYPTO
    digest = crypto["digest"].lower().replace("-", "")
    if digest not in ("sha1", "sha256", "sha512"):
        digest = "sha256"
    salt = b"passforge-remote-v1" + _lp(profile["site"]) + _lp(profile["login"])
    salt += settings_digest(profile)
    key = hashlib.pbkdf2_hmac(
        digest, master_password.encode("utf-8"), salt, crypto["iterations"], 64
    )
    return key[:32], key[32:]


def finish_entropy(local_key, server_output):
    if len(server_output) < 32:
        raise RemoteError("algorithm server output must be at least 32 bytes")
    return hmac.new(
        local_key, b"passforge-finish-v1" + server_output, hashlib.sha256
    ).digest()


def finish_password(local_key, server_output, profile):
    entropy = int.from_bytes(finish_entropy(local_key, server_output), "big")
    return _render_password(entropy, profile)


def _redact(message, input_hex):
    return message.replace(input_hex, "[redacted]") if input_hex else message


def derive_remote(url, algorithm, input_hex):
    url = normalize_server_url(url)
    request = urllib.request.Request(
        url + "/v1/derive",
        data=json.dumps({"algorithm": algorithm, "input": input_hex}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode()).get("error", "request failed")
        except Exception:
            detail = "request failed"
        raise RemoteError(
            "HTTP %s: %s" % (error.code, _redact(str(detail), input_hex))
        ) from None
    except Exception as error:
        raise RemoteError(_redact(str(error), input_hex)) from None
    try:
        output = bytes.fromhex(body["output"])
    except (KeyError, TypeError, ValueError):
        raise RemoteError("invalid algorithm server response") from None
    if len(output) < 32:
        raise RemoteError("algorithm server output must be at least 32 bytes")
    return output


def generate_password_remote(profile, master_password, url, algorithm=None):
    blinded, local_key = blind(profile, master_password)
    output = derive_remote(url, algorithm, blinded.hex())
    return finish_password(local_key, output, profile)
