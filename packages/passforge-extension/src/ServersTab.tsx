import React, { useCallback, useEffect, useState } from "react";
import * as api from "./api";

type Props = {
  backend: api.Backend;
  onConnect: () => Promise<api.Backend>;
  onDisconnect: () => Promise<void>;
};

type Probe =
  | { state: "probing" }
  | { state: "ok"; info: api.ServerInfo }
  | { state: "error"; error: string };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Section 1: the backend this extension must be connected to.
 * Section 2: the algorithm server that backend derives with (managed through
 *            the backend's settings API — the extension never talks to an
 *            algorithm server itself).
 */
export function ServersTab({ backend, onConnect, onDisconnect }: Props) {
  const connected = backend.status === "connected";
  const [discovered, setDiscovered] = useState<string | null>(null);
  const [settings, setSettings] = useState<api.Settings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [algorithms, setAlgorithms] = useState<Record<string, string | null>>({});
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Where the backend would be, even while disconnected.
  useEffect(() => {
    if (backend.address) return setDiscovered(backend.address);
    void api.discover().then((d) => setDiscovered(d?.address ?? null));
  }, [backend.address]);

  const loadSettings = useCallback(async () => {
    if (!connected) return setSettings(null);
    try {
      const s = await api.getSettings();
      setSettings(s);
      setSettingsError("");
      if (s.generation.mode === "server") {
        const g = s.generation;
        setAlgorithms((a) => ({ ...a, [g.url]: g.algorithm }));
      }
    } catch (e) {
      setSettings(null);
      setSettingsError(errText(e));
    }
  }, [connected]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const active = settings?.generation.mode === "server" ? settings.generation.url : null;
  const servers = settings
    ? Array.from(new Set([...(active ? [active] : []), ...settings.knownServers]))
    : [];

  const probe = useCallback(async (url: string) => {
    setProbes((p) => ({ ...p, [url]: { state: "probing" } }));
    try {
      const info = await api.serverInfo(url);
      setProbes((p) => ({ ...p, [url]: { state: "ok", info } }));
    } catch (e) {
      setProbes((p) => ({ ...p, [url]: { state: "error", error: errText(e) } }));
    }
  }, []);

  const serverKey = servers.join("\n");
  useEffect(() => {
    for (const url of serverKey.split("\n")) if (url && !probes[url]) void probe(url);
  }, [serverKey]); // probes intentionally omitted: only probe newly listed URLs

  const persist = async (next: api.Settings) => {
    setBusy(true);
    setError("");
    try {
      setSettings(await api.saveSettings(next));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const addServer = async () => {
    if (!settings) return;
    const url = newUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
    } catch {
      setError("Enter a valid http:// or https:// server URL.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const info = await api.serverInfo(url);
      setProbes((p) => ({ ...p, [url]: { state: "ok", info } }));
      setNewUrl("");
      if (!settings.knownServers.includes(url)) {
        setSettings(await api.saveSettings({ ...settings, knownServers: [...settings.knownServers, url] }));
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const useServer = (url: string) =>
    settings &&
    persist({
      ...settings,
      generation: { mode: "server", url, algorithm: algorithms[url] ?? null },
      knownServers: settings.knownServers.includes(url)
        ? settings.knownServers
        : [...settings.knownServers, url],
    });
  const useServerless = () => settings && persist({ ...settings, generation: { mode: "serverless" } });
  const removeServer = (url: string) =>
    settings &&
    persist({
      ...settings,
      generation: active === url ? { mode: "serverless" } : settings.generation,
      knownServers: settings.knownServers.filter((u) => u !== url),
    });

  const dot = (tone: "on" | "off" | "warn" | "busy") => <span className={`sdot ${tone}`} aria-hidden />;
  const beTone = (
    { connected: "on", connecting: "busy", unreachable: "warn", disconnected: "off" } as const
  )[backend.status];

  return (
    <div className="servers">
      <section>
        <div className="section-title">1 · Backend — required to generate</div>
        <div className="srow">
          {dot(beTone)}
          <div className="sbody">
            <div className="sname">PassForge local backend</div>
            <div className="smeta">
              {discovered ? `http://${discovered}` : "not found (is the app running?)"}
              {backend.version ? ` · v${backend.version}` : ""}
              {" · "}
              <span className="status">{backend.status}</span>
              {backend.locked ? " · app locked" : ""}
            </div>
            {backend.error && <div className="error">{backend.error}</div>}
          </div>
          {connected ? (
            <button className="action ghost small" onClick={() => void onDisconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="action primary small"
              onClick={() => void onConnect()}
              disabled={backend.status === "connecting"}
            >
              {backend.status === "connecting" ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
        <div className="hint">
          Pairing uses the native host to read the backend&apos;s port and token from the vault
          directory. Generate and the key fingerprint are API calls to this backend.
        </div>
      </section>

      <section>
        <div className="section-title">2 · Algorithm server — used by the backend</div>
        {!connected ? (
          <div className="hint">Connect to the backend to see which algorithm it derives with.</div>
        ) : !settings ? (
          <div className="hint">
            {settingsError.includes("locked")
              ? "Unlock the PassForge app to view or change the algorithm server."
              : settingsError || "Loading…"}
          </div>
        ) : (
          <>
            <div className={`srow ${active === null ? "active" : ""}`}>
              {dot("on")}
              <div className="sbody">
                <div className="sname">Built-in (serverless)</div>
                <div className="smeta">LessPass algorithm inside the backend. No network.</div>
              </div>
              {active === null ? (
                <span className="active-label">Active</span>
              ) : (
                <button className="action ghost small" onClick={() => void useServerless()} disabled={busy}>
                  Use
                </button>
              )}
            </div>
            {servers.map((url) => {
              const p = probes[url];
              const info = p?.state === "ok" ? p.info : null;
              const isActive = active === url;
              return (
                <div key={url} className={`srow col ${isActive ? "active" : ""}`}>
                  <div className="srow inner">
                    {dot(!p || p.state === "probing" ? "busy" : p.state === "ok" ? "on" : "warn")}
                    <div className="sbody">
                      <div className="sname mono">{hostOf(url)}</div>
                      <div className="smeta">
                        {!p || p.state === "probing"
                          ? "probing…"
                          : p.state === "ok"
                            ? `${p.info.name} · ${p.info.version}`
                            : p.error}
                      </div>
                    </div>
                    {isActive ? (
                      <button className="action ghost small" onClick={() => void useServerless()} disabled={busy}>
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className="action primary small"
                        onClick={() => void useServer(url)}
                        disabled={busy || !info}
                      >
                        Use
                      </button>
                    )}
                    <button
                      className="icon"
                      aria-label={`Remove ${hostOf(url)}`}
                      title="Remove"
                      onClick={() => void removeServer(url)}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                  {info && (
                    <div className="field algo">
                      <select
                        aria-label="Algorithm"
                        value={algorithms[url] ?? ""}
                        onChange={(e) => {
                          const algorithm = e.target.value || null;
                          setAlgorithms((a) => ({ ...a, [url]: algorithm }));
                          if (isActive) {
                            void persist({ ...settings, generation: { mode: "server", url, algorithm } });
                          }
                        }}
                      >
                        <option value="">Server default ({info.default_algorithm})</option>
                        {info.algorithms.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id} — {a.description}
                            {a.portable ? "" : " · server-bound"}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="row">
              <div className="field">
                <input
                  aria-label="Algorithm server URL"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addServer()}
                  placeholder="http://127.0.0.1:8790"
                />
              </div>
              <button className="action ghost" onClick={() => void addServer()} disabled={busy || !newUrl.trim()}>
                Add
              </button>
            </div>
            <div className="hint">
              The backend sends an algorithm server one blinded hash per password — never your
              site, login, master password or the result. Switching changes every generated
              password.
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </section>
    </div>
  );
}
