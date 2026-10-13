# PassForge Remote Algorithm Protocol — `passforge-remote-v1`

PassForge generates passwords on the client. A client can optionally ask an
**algorithm server** to take part in the derivation. Servers are interchangeable:
any server that implements this API works with any PassForge client, and a
client can switch servers at any time (different server or algorithm ⇒
different passwords). Without a server the client uses its built-in default
algorithm (LessPass, unchanged) — the **serverless** mode.

## Goals

- **Zero knowledge.** The server never sees the site, login, master password,
  counter, character-set options, salt fields — nor the final password. It
  receives one 32-byte value per request that is unlinkable across sites and
  across users, and returns 32+ bytes the client mixes with a key that never
  leaves the device.
- **Stateless.** No accounts, no sessions, no storage, no request logging.
- **API-only coupling.** Client and server share nothing but this document.
- **Settings live on the client.** The server never stores or receives them in
  clear; they only influence the request through a hash.

## Client derivation

Notation: `‖` concatenation, `u32be(n)` 4-byte big-endian, `lp(x) = u32be(len(x)) ‖ x`
(UTF-8 bytes for strings), `hex()` lowercase hex.

1. **Settings digest** (hashed settings):

   ```
   flags = (lowercase?1:0) | (uppercase?2:0) | (digits?4:0) | (symbols?8:0)      // one byte
   fields = salt_fields sorted by (key, value)
   settings_digest = SHA-256( "passforge-settings-v1"
                              ‖ u32be(counter) ‖ flags ‖ u32be(length)
                              ‖ u32be(len(fields)) ‖ for f in fields: lp(f.key) ‖ lp(f.value) )
   ```

2. **Blinding** (hashed site + login + master password + settings, combined):

   ```
   salt = "passforge-remote-v1" ‖ lp(site) ‖ lp(login) ‖ settings_digest
   okm  = PBKDF2-HMAC-<digest>(master_password, salt, iterations, 64 bytes)
   blinded_input = okm[0..32]     // sent to the server
   local_key     = okm[32..64]    // never leaves the device
   ```

   `digest` and `iterations` are the effective crypto config of the entry
   (per-entry override, else the global default). `keylen` is ignored in
   remote mode. The three inputs are hashed together on purpose: separate
   hashes of the login or master password would let a server recognize the
   same user across sites.

3. **Request:** `POST {server}/v1/derive` with `blinded_input`.

4. **Finish:**

   ```
   entropy = HMAC-SHA256(local_key, "passforge-finish-v1" ‖ server_output)    // 32 bytes
   password = render_password(hex(entropy), options)                         // LessPass renderer
   ```

   Because `local_key` is secret, the server cannot compute the password
   from its own output.

## HTTP API

All bodies are JSON (`Content-Type: application/json`). Servers SHOULD allow
any origin (CORS `*`) so browser clients can call them, and MUST NOT log
request bodies.

### `GET /v1/info`

```json
{
  "protocol": "passforge-remote-v1",
  "name": "PassForge reference server",
  "version": "12.0.0",
  "default_algorithm": "argon2id-v1",
  "algorithms": [
    { "id": "argon2id-v1", "description": "Argon2id m=64MiB t=3 p=1", "portable": true }
  ]
}
```

`portable: true` means any server implementing the same algorithm id gives
the same output. `portable: false` means the output depends on a server secret
(e.g. a pepper): only that server can reproduce it — losing the server means
losing those passwords.

### `POST /v1/derive`

Request:

```json
{ "algorithm": "argon2id-v1", "input": "<64 hex chars>" }
```

`algorithm` may be omitted or `null` to use the server's `default_algorithm`.
`input` MUST be exactly 32 bytes of lowercase or uppercase hex.

Response `200`:

```json
{ "algorithm": "argon2id-v1", "output": "<hex, at least 32 bytes>" }
```

`algorithm` echoes the id actually used, so a client relying on the default
can show (and pin) it.

Errors: `400` `{ "error": "..." }` for malformed input or unknown algorithm,
`413` for oversized bodies, `503` when overloaded.

## Reference algorithms (`passforge-server`)

All take the 32 raw bytes of `input` and output 32 bytes.

| id | definition | portable |
|----|-----------|----------|
| `argon2id-v1` (default) | Argon2id v0x13, m=65536 KiB, t=3, p=1, password=`input`, salt=`"passforge-argon2id-v1"`, 32-byte tag | yes |
| `pbkdf2-sha512-v1` | PBKDF2-HMAC-SHA512(`input`, `"passforge-pbkdf2-sha512-v1"`, 210000, 32) | yes |
| `hmac-pepper-v1` | HMAC-SHA256(server pepper, `"passforge-pepper-v1"` ‖ `input`); only offered when a pepper is configured | no |

## Threat model notes

- The server learns only that *some* client asked for a derivation, plus
  network metadata (IP, timing). Use a trusted server or Tor/VPN if that
  matters.
- A malicious server can return wrong output (passwords change) but cannot
  learn them. Clients cannot detect a lying server; switching servers or
  algorithms is indistinguishable from it — by design.
- Every deterministic scheme is open to offline guessing by someone who also
  knows site, login and output. Blinding with PBKDF2 keeps each guess as
  expensive as local LessPass, and the server never sees the output.
- Use HTTPS for any non-localhost server.
