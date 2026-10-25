# passforge-protocol (TypeScript)

The client half of [`passforge-remote-v1`](../../docs/remote-protocol.md), ported from
`crates/passforge-protocol`: settings digest, blinding, finishing, the LessPass renderer
and the master-password fingerprint. It is used by the iOS app (`mobile/`).

**There is no serverless path.** The package exports nothing that turns a master password
into a password on its own: `finishPassword` needs `serverOutput` from an algorithm server
(`derive`). A frontend built on it cannot generate without a reachable server, which keeps
the PassForge rule that frontends are severed from the algorithm. The browser extension's
severance test fails if this package ever ends up in its bundle.

Correctness is pinned by golden vectors generated from the Rust crates:

```bash
cargo run -q -p passforge-protocol --example vectors > packages/passforge-protocol-js/test/vectors.json
yarn workspace passforge-protocol test
```

Crypto is `@noble/hashes` (pure JS, audited), so it runs in Node, browsers and Expo Go.
PBKDF2 at 100 000 iterations takes on the order of a second on a phone.
