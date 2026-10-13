import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { activeTabSite } from "./url";
import * as host from "./host";
import * as api from "./api";
import "./styles.css";

// UI defaults only — the algorithm itself lives exclusively in the backend.
const DEFAULT_OPTIONS = { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 };

function Popup() {
  const [site, setSite] = useState("");
  const [login, setLogin] = useState("");
  const [master, setMaster] = useState("");
  const [counter, setCounter] = useState(1);
  const [length, setLength] = useState(DEFAULT_OPTIONS.length);
  const [sets, setSets] = useState({ lowercase: true, uppercase: true, digits: true, symbols: true });
  const [password, setPassword] = useState("");
  const [fingerprint, setFingerprint] = useState<api.Finger[]>([]);
  const [copied, setCopied] = useState(false);
  const [vault, setVault] = useState<"checking" | "on" | "off">("checking");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Prefill site from the active tab, then ask the host for a saved profile.
  useEffect(() => {
    void (async () => {
      const detected = await activeTabSite();
      if (detected) setSite(detected);
      // Backend pairing: the app must be reachable or nothing can generate.
      if ((await host.ping()) && (await api.connect())) {
        setVault("on");
        if (!detected) return;
        try {
          const hits = await host.searchEntries(detected);
          const exact = hits.find((h) => h.site === detected) ?? hits[0];
          if (exact) {
            const entry = await host.getEntry(exact.id);
            setProfileId(entry.id);
            setLogin(entry.profile.login);
            setCounter(entry.profile.counter);
            setLength(entry.profile.options.length);
            setSets({
              lowercase: entry.profile.options.lowercase,
              uppercase: entry.profile.options.uppercase,
              digits: entry.profile.options.digits,
              symbols: entry.profile.options.symbols,
            });
          }
        } catch {
          /* profile lookup is best-effort */
        }
      } else {
        setVault("off");
      }
    })();
  }, []);

  // Live master-password fingerprint (the LessPass "did I type it right" aid)
  // — computed by the backend too; the extension holds no algorithm.
  useEffect(() => {
    let stale = false;
    if (!master || !api.connected()) return setFingerprint([]);
    void api
      .fingerprint(master)
      .then((fp) => {
        if (!stale) setFingerprint(fp);
      })
      .catch(() => setFingerprint([]));
    return () => {
      stale = true;
    };
  }, [master, vault]);

  const profile = useMemo(
    () => ({ site, login, counter, length, ...sets }),
    [site, login, counter, length, sets],
  );

  const generate = useCallback(async () => {
    setError("");
    if (!site || !login || !master || !api.connected()) return;
    try {
      setPassword(await api.generate(profile, master));
    } catch (e) {
      setPassword("");
      setError(e instanceof Error ? e.message : "generation failed");
    }
  }, [profile, master]);

  const copy = useCallback(async () => {
    if (!password) await generate();
    const text = password || (api.connected() ? await api.generate(profile, master).catch(() => "") : "");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [password, generate, profile, master]);

  return (
    <div className="popup">
      <div className="header">
        <span className="title">PassForge</span>
        <span className={`badge ${vault === "on" ? "on" : ""}`}>
          {vault === "checking" ? "backend …" : vault === "on" ? "backend connected" : "app offline"}
        </span>
      </div>

      <div className="field">
        <label>Site</label>
        <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="example.com" />
      </div>
      <div className="field">
        <label>Login</label>
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="you@example.com" />
      </div>
      <div className="field">
        <label>Master password</label>
        <input
          type="password"
          value={master}
          onChange={(e) => setMaster(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          autoFocus
        />
      </div>
      <div className="fingerprint">
        {fingerprint.length > 0 && (
          <>
            {fingerprint.map((f, i) => (
              <span key={i} className="dot" style={{ background: f.color }} title={f.icon} />
            ))}
            key fingerprint
          </>
        )}
      </div>

      <div className="row">
        <div className="field">
          <label>Counter</label>
          <input
            type="number" min={1} value={counter}
            onChange={(e) => setCounter(Math.max(1, +e.target.value || 1))}
          />
        </div>
        <div className="field">
          <label>Length</label>
          <input
            type="number" min={4} max={64} value={length}
            onChange={(e) => setLength(Math.min(64, Math.max(4, +e.target.value || 16)))}
          />
        </div>
      </div>
      <div>
        <label>Character sets</label>
        <div className="chips">
          {(["lowercase", "uppercase", "digits", "symbols"] as const).map((k) => (
            <button
              key={k}
              className={`chip ${sets[k] ? "on" : ""}`}
              onClick={() => setSets((s) => ({ ...s, [k]: !s[k] }))}
            >
              {{ lowercase: "a-z", uppercase: "A-Z", digits: "0-9", symbols: "!@#" }[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="secret">
        <span className="pw">{password || "· · · · · · · · · · · ·"}</span>
      </div>

      <div className="row">
        <button
          className="action ghost"
          style={{ flex: 1 }}
          onClick={generate}
          disabled={vault !== "on"}
        >
          Generate
        </button>
        <button className="action primary" style={{ flex: 1 }} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {error && <div className="hint" style={{ color: "var(--danger, #e5484d)" }}>{error}</div>}
      <div className="hint">
        {vault === "on"
          ? `Severed: this extension holds no algorithm — ${profileId ? "profile params loaded, " : ""}generation happens in the PassForge app.`
          : "Open the PassForge app to generate — the extension is a frontend only."}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
