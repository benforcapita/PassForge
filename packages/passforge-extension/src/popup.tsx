import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  buildFingerprint,
  defaultPasswordOptions,
  fetchServerInfo,
  generatePassword,
  generatePasswordRemote,
  normalizeServerUrl,
  type ServerInfo,
} from "lesspass";
import { activeTabSite } from "./url";
import * as host from "./host";
import { loadGenerationSetting, saveGenerationSetting, type GenerationSetting } from "./settings";
import "./styles.css";

type Finger = { icon: string; color: string };

function Popup() {
  const [site, setSite] = useState("");
  const [login, setLogin] = useState("");
  const [master, setMaster] = useState("");
  const [counter, setCounter] = useState(1);
  const [length, setLength] = useState(defaultPasswordOptions.length);
  const [sets, setSets] = useState({ lowercase: true, uppercase: true, digits: true, symbols: true });
  const [password, setPassword] = useState("");
  const [fingerprint, setFingerprint] = useState<Finger[]>([]);
  const [copied, setCopied] = useState(false);
  const [vault, setVault] = useState<"checking" | "on" | "off">("checking");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationSetting>({ mode: "serverless" });
  const [draftMode, setDraftMode] = useState<"serverless" | "server">("serverless");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [algorithm, setAlgorithm] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [generationError, setGenerationError] = useState("");

  useEffect(() => {
    void loadGenerationSetting().then((saved) => {
      setGeneration(saved);
      if (saved.mode === "server") {
        setServerUrl(saved.url);
        setAlgorithm(saved.algorithm);
      }
    });
  }, []);

  // Prefill site from the active tab, then ask the host for a saved profile.
  useEffect(() => {
    void (async () => {
      const detected = await activeTabSite();
      if (detected) setSite(detected);
      if (await host.ping()) {
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

  // Live master-password fingerprint (the LessPass "did I type it right" aid).
  useEffect(() => {
    let stale = false;
    if (!master) return setFingerprint([]);
    void buildFingerprint(master).then((fp) => {
      if (!stale) setFingerprint(fp as unknown as Finger[]);
    });
    return () => {
      stale = true;
    };
  }, [master]);

  const profile = useMemo(
    () => ({ site, login, counter, length, ...sets }),
    [site, login, counter, length, sets],
  );

  const generate = useCallback(async () => {
    if (!site || !login || !master) return null;
    try {
      const result = generation.mode === "server"
        ? await generatePasswordRemote(profile, master, generation)
        : await generatePassword(profile, master);
      setPassword(result);
      setGenerationError("");
      return result;
    } catch (error) {
      setPassword("");
      setGenerationError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [profile, master, generation]);

  const copy = useCallback(async () => {
    const text = password || await generate();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [password, generate]);

  const testConnection = async () => {
    try {
      const info = await fetchServerInfo(serverUrl);
      setServerInfo(info);
      setSettingsError("");
    } catch (error) {
      setServerInfo(null);
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveGeneration = async () => {
    try {
      const setting: GenerationSetting = draftMode === "server"
        ? { mode: "server", url: normalizeServerUrl(serverUrl), algorithm }
        : { mode: "serverless" };
      await saveGenerationSetting(setting);
      setGeneration(setting);
      setSettingsError("");
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleSettings = () => {
    if (!settingsOpen) {
      setDraftMode(generation.mode);
      setServerUrl(generation.mode === "server" ? generation.url : "");
      setAlgorithm(generation.mode === "server" ? generation.algorithm : null);
      setServerInfo(null);
      setSettingsError("");
    }
    setSettingsOpen((open) => !open);
  };

  const remoteHost = (() => {
    if (generation.mode !== "server") return "";
    try { return new URL(generation.url).host; } catch { return generation.url; }
  })();
  const isRemoteHttp = (() => {
    if (!serverUrl.toLowerCase().startsWith("http://")) return false;
    try {
      const host = new URL(serverUrl).hostname.toLowerCase();
      return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
    } catch { return false; }
  })();
  const selectedAlgorithm = serverInfo?.algorithms.find((item) => item.id === algorithm);
  const nonPortable = selectedAlgorithm?.portable === false;
  const generationBadge = generation.mode === "server"
    ? remoteHost || "server"
    : "serverless";

  return (
    <div className="popup">
      <div className="header">
        <span className="title">PassForge</span>
        <span className={`badge ${generation.mode === "server" ? "on" : ""}`}>
          {generationBadge}
        </span>
        <button className="gear" title="Settings" onClick={toggleSettings}>⚙</button>
      </div>

      {settingsOpen && (
        <section className="settings">
          <strong>Password generation</strong>
          <div className="row">
            <button className={`chip ${draftMode === "serverless" ? "on" : ""}`}
              onClick={() => setDraftMode("serverless")}>Serverless</button>
            <button className={`chip ${draftMode === "server" ? "on" : ""}`}
              onClick={() => setDraftMode("server")}>Algorithm server</button>
          </div>
          {draftMode === "server" && <>
            <div className="row connection-row">
              <div className="field"><label>Server URL</label>
                <input value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setServerInfo(null); }}
                  placeholder="https://server.example" /></div>
              <button className="action ghost" onClick={testConnection}>Test connection</button>
            </div>
            {serverInfo && <div className="hint">{serverInfo.name} · {serverInfo.version}</div>}
            <div className="field"><label>Algorithm</label>
              <select value={algorithm ?? ""} onChange={(event) => setAlgorithm(event.target.value || null)}>
                <option value="">Server default ({serverInfo?.default_algorithm ?? "server default"})</option>
                {algorithm && !serverInfo?.algorithms.some((item) => item.id === algorithm) &&
                  <option value={algorithm}>{algorithm}</option>}
                {serverInfo?.algorithms.map((item) =>
                  <option key={item.id} value={item.id}>
                    {item.id} — {item.description}{item.portable ? "" : " · server-bound"}
                  </option>)}
              </select>
            </div>
            {isRemoteHttp && <div className="warning">Use HTTPS for remote servers.</div>}
            {nonPortable && <div className="warning">Only this server can reproduce these passwords.</div>}
            <div className="hint">Server receives one blinded hash per password; never your site, login, master password, settings, or generated password.</div>
          </>}
          {settingsError && <div className="error">{settingsError}</div>}
          <button className="action primary" onClick={saveGeneration}>Save</button>
        </section>
      )}
      <div className="hint">
        {vault === "checking" ? "vault …" : vault === "on" ? "vault connected" : "offline"}
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
      {generationError && <div className="error">{generationError}</div>}

      <div className="row">
        <button className="action ghost" style={{ flex: 1 }} onClick={generate}>
          Generate
        </button>
        <button className="action primary" style={{ flex: 1 }} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="hint">
        {generation.mode === "server" ? "Server sees only a blinded hash." : "Stateless: nothing is stored here."}
        {" "}{profileId ? "Profile params loaded from vault." : ""}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
