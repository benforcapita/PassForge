import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { activeTabSite } from "./url";
import * as host from "./host";
import * as api from "./api";
import { ServersTab } from "./ServersTab";
import "./styles.css";

// UI defaults only — the algorithm itself lives exclusively in the backend.
const DEFAULT_OPTIONS = { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 };

const OFFLINE: api.Backend = {
  status: "disconnected",
  address: null,
  version: null,
  locked: null,
  error: null,
};

function Popup() {
  const [tab, setTab] = useState<"generate" | "servers">("generate");
  const [backend, setBackend] = useState<api.Backend>({ ...OFFLINE, status: "connecting" });
  const [site, setSite] = useState("");
  const [login, setLogin] = useState("");
  const [master, setMaster] = useState("");
  const [counter, setCounter] = useState(1);
  const [length, setLength] = useState(DEFAULT_OPTIONS.length);
  const [sets, setSets] = useState({ lowercase: true, uppercase: true, digits: true, symbols: true });
  const [password, setPassword] = useState("");
  const [fingerprint, setFingerprint] = useState<api.Finger[]>([]);
  const [copied, setCopied] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const connected = backend.status === "connected";

  // Vault profile prefill is a convenience on top of the host; only once
  // we're paired with the backend (same trust decision as generating).
  const prefillProfile = useCallback(async (detected: string) => {
    try {
      const hits = await host.searchEntries(detected);
      const exact = hits.find((h) => h.site === detected) ?? hits[0];
      if (!exact) return;
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
    } catch {
      /* profile lookup is best-effort */
    }
  }, []);

  const connect = useCallback(async () => {
    setBackend((b) => ({ ...b, status: "connecting", error: null }));
    const next = await api.connect();
    setBackend(next);
    if (next.status === "connected" && site) void prefillProfile(site);
    return next;
  }, [site, prefillProfile]);

  const disconnect = useCallback(async () => {
    setBackend(await api.disconnect());
    setPassword("");
    setFingerprint([]);
    setError("");
  }, []);

  // On open: detect the site, then honour the saved intent — connect only
  // if the user previously chose to. First run is deliberately disconnected
  // so the dependency on the backend is visible.
  useEffect(() => {
    void (async () => {
      const detected = await activeTabSite();
      if (detected) setSite(detected);
      if ((await api.savedIntent()) !== "connected") {
        setBackend(OFFLINE);
        return;
      }
      const next = await api.connect();
      setBackend(next);
      if (next.status === "connected" && detected) void prefillProfile(detected);
    })();
  }, [prefillProfile]);

  // Live master-password fingerprint — computed by the backend; the
  // extension holds no algorithm.
  useEffect(() => {
    let stale = false;
    if (!master || !connected) return setFingerprint([]);
    void api
      .fingerprint(master)
      .then((fp) => {
        if (!stale) setFingerprint(fp);
      })
      .catch(() => setFingerprint([]));
    return () => {
      stale = true;
    };
  }, [master, connected]);

  const profile = useMemo(
    () => ({ site, login, counter, length, ...sets }),
    [site, login, counter, length, sets],
  );

  const generate = useCallback(async (): Promise<string> => {
    setError("");
    if (!connected) {
      setError("Not connected to the PassForge backend. Open Servers to connect.");
      return "";
    }
    if (!site || !login || !master) return "";
    try {
      const pw = await api.generate(profile, master);
      setPassword(pw);
      return pw;
    } catch (e) {
      setPassword("");
      setError(e instanceof Error ? e.message : "generation failed");
      return "";
    }
  }, [connected, site, login, master, profile]);

  const copy = useCallback(async () => {
    const text = password || (await generate());
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [password, generate]);

  const badgeLabel = {
    connecting: "backend …",
    connected: "backend connected",
    disconnected: "backend disconnected",
    unreachable: "backend unreachable",
  }[backend.status];

  return (
    <div className="popup">
      <div className="header">
        <span className="title">PassForge</span>
        <button
          className={`badge ${connected ? "on" : backend.status === "connecting" ? "" : "warn"}`}
          onClick={() => setTab("servers")}
          title="Servers"
        >
          {badgeLabel}
        </button>
      </div>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "generate"}
          className={`tab ${tab === "generate" ? "on" : ""}`}
          onClick={() => setTab("generate")}
        >
          Generate
        </button>
        <button
          role="tab"
          aria-selected={tab === "servers"}
          className={`tab ${tab === "servers" ? "on" : ""}`}
          onClick={() => setTab("servers")}
        >
          Servers
        </button>
      </div>

      {tab === "servers" ? (
        <ServersTab backend={backend} onConnect={connect} onDisconnect={disconnect} />
      ) : (
        <>
          {!connected && (
            <div className="gate" role="note">
              <span>
                {backend.status === "connecting"
                  ? "Connecting to the PassForge backend…"
                  : "This extension holds no algorithm — without a backend connection it cannot generate passwords."}
              </span>
              {backend.status !== "connecting" && (
                <button className="link" onClick={() => setTab("servers")}>
                  Open Servers
                </button>
              )}
            </div>
          )}

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
              disabled={!connected}
              title={connected ? undefined : "Connect to the backend first"}
            >
              Generate
            </button>
            <button className="action primary" style={{ flex: 1 }} onClick={copy} disabled={!connected}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {error && <div className="error">{error}</div>}
          <div className="hint">
            {connected
              ? `Severed: generation happens in the PassForge backend at ${backend.address}.${
                  profileId ? " Profile params loaded from vault." : ""
                }`
              : "Connect to the backend from the Servers tab to generate."}
          </div>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
