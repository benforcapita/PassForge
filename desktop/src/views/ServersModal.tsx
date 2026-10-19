import { Plug, PlugZap, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import * as backend from "../backend";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { TextInput } from "../components/ui/TextInput";
import { INSECURE_SERVER_URL, serverUrlError } from "../serverUrl";
import type { ServerInfo, Settings } from "../types";

type Props = {
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
};

type Probe = { state: "probing" } | { state: "ok"; info: ServerInfo } | { state: "error"; error: string };

const errText = (err: unknown) =>
  err && typeof err === "object" && "message" in err ? String(err.message) : String(err);

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function StatusDot({ tone }: { tone: "on" | "off" | "warn" | "busy" }) {
  const color = {
    on: "bg-pf-accent",
    off: "bg-pf-text-muted",
    warn: "bg-pf-error",
    busy: "bg-pf-warning animate-pulse",
  }[tone];
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

/**
 * Two sections, mirroring the architecture:
 *  1. Backend — the local PassForge API this frontend must be connected to
 *     before it can generate anything.
 *  2. Algorithm servers — optional remote derivation servers the *backend*
 *     uses; pick one, or none (built-in serverless algorithm).
 */
export function ServersModal({ settings, onClose, onSaved }: Props) {
  const be = backend.useBackend();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [algorithms, setAlgorithms] = useState<Record<string, string | null>>(() =>
    settings.generation.mode === "server"
      ? { [settings.generation.url]: settings.generation.algorithm }
      : {},
  );

  const active = settings.generation.mode === "server" ? settings.generation.url : null;
  const servers = Array.from(new Set([...(active ? [active] : []), ...settings.knownServers]));

  const probe = async (url: string) => {
    setProbes((p) => ({ ...p, [url]: { state: "probing" } }));
    try {
      const info = await api.serverInfo(url);
      setProbes((p) => ({ ...p, [url]: { state: "ok", info } }));
    } catch (err) {
      setProbes((p) => ({ ...p, [url]: { state: "error", error: errText(err) } }));
    }
  };

  const serverKey = servers.join("\n");
  useEffect(() => {
    for (const url of serverKey.split("\n")) if (url && !probes[url]) void probe(url);
  }, [serverKey]); // probes intentionally omitted: only probe newly listed URLs

  const persist = async (next: Settings) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveSettings(next));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const addServer = async () => {
    const url = newUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    const urlError = serverUrlError(url);
    if (urlError) {
      setError(urlError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const info = await api.serverInfo(url);
      setProbes((p) => ({ ...p, [url]: { state: "ok", info } }));
      setNewUrl("");
      if (!settings.knownServers.includes(url)) {
        onSaved(await api.saveSettings({ ...settings, knownServers: [...settings.knownServers, url] }));
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const useServer = (url: string) =>
    persist({
      ...settings,
      generation: { mode: "server", url, algorithm: algorithms[url] ?? null },
      knownServers: settings.knownServers.includes(url)
        ? settings.knownServers
        : [...settings.knownServers, url],
    });

  const useServerless = () => persist({ ...settings, generation: { mode: "serverless" } });

  const removeServer = (url: string) =>
    persist({
      ...settings,
      generation: active === url ? { mode: "serverless" } : settings.generation,
      knownServers: settings.knownServers.filter((u) => u !== url),
    });

  const beTone = { connected: "on", connecting: "busy", unreachable: "warn", disconnected: "off" }[
    be.status
  ] as "on" | "off" | "warn" | "busy";

  return (
    <Modal
      title="Servers"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.02em] text-pf-text-muted">
            1 · Backend — required to generate
          </p>
          <div
            data-testid="backend-row"
            className="flex items-center gap-3 rounded-md border border-pf-border-moderate bg-pf-raised px-3 py-2.5"
          >
            <StatusDot tone={beTone} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-pf-text-primary">PassForge local backend</p>
              <p className="font-mono text-[11px] text-pf-text-secondary">
                {be.address ? `http://${be.address}` : "http://127.0.0.1 (ephemeral port)"}
                {be.version ? ` · v${be.version}` : ""}
                {" · "}
                <span role="status">{be.status}</span>
              </p>
              {be.error && (
                <p role="alert" className="mt-0.5 text-[11px] text-pf-text-error">
                  {be.error}
                </p>
              )}
            </div>
            {be.status === "connected" ? (
              <Button variant="ghost" className="h-7" onClick={() => backend.disconnect()}>
                <Plug size={12} strokeWidth={1.5} /> Disconnect
              </Button>
            ) : (
              <Button
                className="h-7"
                onClick={() => void backend.connect()}
                disabled={be.status === "connecting"}
              >
                <PlugZap size={12} strokeWidth={1.5} />
                {be.status === "connecting" ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-pf-text-muted">
            This window holds no algorithm. Reveal and Copy call{" "}
            <span className="font-mono">POST /api/entries/&#123;id&#125;/generate</span> on the
            backend; while disconnected they cannot produce a password.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-[0.02em] text-pf-text-muted">
            2 · Algorithm server — used by the backend
          </p>
          <div className="flex flex-col overflow-hidden rounded-md border border-pf-border-moderate">
            <div
              className={`flex items-center gap-3 px-3 py-2.5 ${
                active === null ? "bg-pf-accent-muted" : "bg-pf-raised"
              }`}
            >
              <StatusDot tone="on" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-pf-text-primary">Built-in (serverless)</p>
                <p className="text-[11px] text-pf-text-secondary">
                  LessPass algorithm inside the backend. No network.
                </p>
              </div>
              {active === null ? (
                <span className="text-[11px] font-medium text-pf-accent">Active</span>
              ) : (
                <Button variant="ghost" className="h-7" onClick={() => void useServerless()} disabled={busy}>
                  Use
                </Button>
              )}
            </div>
            {servers.map((url) => {
              const p = probes[url];
              const isActive = active === url;
              const info = p?.state === "ok" ? p.info : null;
              return (
                <div
                  key={url}
                  data-testid="algorithm-server-row"
                  className={`flex flex-col gap-1.5 border-t border-pf-border-subtle px-3 py-2.5 ${
                    isActive ? "bg-pf-accent-muted" : "bg-pf-raised"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <StatusDot
                      tone={!p || p.state === "probing" ? "busy" : p.state === "ok" ? "on" : "warn"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px] text-pf-text-primary">{hostOf(url)}</p>
                      <p className="truncate text-[11px] text-pf-text-secondary">
                        {!p || p.state === "probing"
                          ? "probing…"
                          : p.state === "ok"
                            ? `${p.info.name} · ${p.info.version}`
                            : p.error}
                      </p>
                    </div>
                    {isActive ? (
                      <Button variant="ghost" className="h-7" onClick={() => void useServerless()} disabled={busy}>
                        <Plug size={12} strokeWidth={1.5} /> Disconnect
                      </Button>
                    ) : (
                      <Button className="h-7" onClick={() => void useServer(url)} disabled={busy || !info}>
                        <PlugZap size={12} strokeWidth={1.5} /> Use
                      </Button>
                    )}
                    <Button
                      variant="icon"
                      aria-label={`Remove ${hostOf(url)}`}
                      onClick={() => void removeServer(url)}
                      disabled={busy}
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </Button>
                  </div>
                  {info && (
                    <div className="flex items-center gap-2 pl-5">
                      <label className="text-[11px] text-pf-text-secondary" htmlFor={`algo-${url}`}>
                        Algorithm
                      </label>
                      <Select
                        id={`algo-${url}`}
                        value={algorithms[url] ?? ""}
                        onChange={(e) => {
                          const algorithm = e.target.value || null;
                          setAlgorithms((a) => ({ ...a, [url]: algorithm }));
                          if (isActive) {
                            void persist({ ...settings, generation: { mode: "server", url, algorithm } });
                          }
                        }}
                        className="h-7 flex-1 font-mono text-[11px]"
                      >
                        <option value="">Server default ({info.default_algorithm})</option>
                        {info.algorithms.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id} — {a.description}
                            {a.portable ? "" : " · server-bound"}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <TextInput
              aria-label="Algorithm server URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addServer()}
              placeholder="http://127.0.0.1:8790"
              className="min-w-0 flex-1 font-mono"
            />
            <Button variant="ghost" onClick={() => void addServer()} disabled={busy || !newUrl.trim()}>
              Add server
            </Button>
          </div>
          {newUrl.trim() && serverUrlError(newUrl) === INSECURE_SERVER_URL && (
            <p role="note" className="text-[11px] text-pf-warning">
              {INSECURE_SERVER_URL}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-pf-text-muted">
            The backend sends an algorithm server one blinded hash per password — never your site,
            login, master password or the result. Switching server or algorithm changes every
            generated password.
          </p>
        </section>
        {error && (
          <p role="alert" className="text-[11px] text-pf-text-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
