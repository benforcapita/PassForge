# PassForge reference algorithm server

Stateless reference implementation of the `passforge-remote-v1` API, offering Argon2id and PBKDF2-SHA512 plus an optional server-pepper algorithm.

Run locally with `cargo run -p passforge-server`. Configure `PASSFORGE_BIND`, `PASSFORGE_SERVER_NAME`, `PASSFORGE_MAX_CONCURRENT`, or set `PASSFORGE_PEPPER` to hex or `PASSFORGE_PEPPER_FILE` to a file containing hex (at least 32 decoded bytes).

```sh
curl http://127.0.0.1:8787/v1/info
curl -H 'Content-Type: application/json' -d '{"input":"0000000000000000000000000000000000000000000000000000000000000000"}' http://127.0.0.1:8787/v1/derive
```

The server never logs request bodies; pepper loss = password loss.
