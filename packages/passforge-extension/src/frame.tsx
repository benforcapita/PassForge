// Autofill dropdown — runs inside the extension-origin iframe. It is the
// only place entry candidates are fetched (via the service worker →
// /api/autofill); the hosting page cannot read this document.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as api from "./api";
import "./styles.css";

type Params = { url: string; kind: "login" | "signup" | "change"; username: string; pf: string };
type State =
  | { phase: "loading" }
  | { phase: "disconnected" }
  | { phase: "locked" }
  | { phase: "ready"; entries: api.EntrySummary[] }
  | { phase: "error"; message: string };

function params(): Params {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    url: p.get("url") ?? "",
    kind: (p.get("kind") as "login" | "signup" | "change") || "login",
    username: p.get("username") ?? "",
    pf: p.get("pf") ?? "",
  };
}

function close() {
  window.parent.postMessage({ type: "pf:close" }, "*");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Frame() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [login, setLogin] = useState(params().username);
  const [error, setError] = useState("");
  const [migrated, setMigrated] = useState<{ entryId: string; done: boolean } | null>(null);
  const p = params();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Report content height so the content script can size the iframe.
  useEffect(() => {
    const post = () =>
      window.parent.postMessage(
        { type: "pf:resize", height: document.documentElement.scrollHeight },
        "*",
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  });

  useEffect(() => {
    void (async () => {
      try {
        const res = (await chrome.runtime.sendMessage({ type: "pf:candidates", nonce: p.pf })) as
          | { ok: true; entries: api.EntrySummary[] }
          | { ok: false; error: string };
        if (!res.ok) throw new Error(res.error);
        setState({ phase: "ready", entries: res.entries });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("Not connected")) setState({ phase: "disconnected" });
        else if (message.toLowerCase().includes("locked")) setState({ phase: "locked" });
        else setState({ phase: "error", message });
      }
    })();
  }, [p.url]);

  const fill = async (entryId: string) => {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "pf:fill", entryId, nonce: p.pf });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const migrateFill = async (entryId: string) => {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "pf:migrate-fill", entryId, nonce: p.pf });
      setMigrated({ entryId, done: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const markMigrated = async (entryId: string) => {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "pf:migrate-complete", entryId, nonce: p.pf });
      setMigrated({ entryId, done: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createAndFill = async () => {
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "pf:create-and-fill", login, nonce: p.pf });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="frame">
      <div className="header">
        <span className="title">PassForge</span>
        <span className="badge">{hostOf(p.url)}</span>
      </div>

      {state.phase === "loading" && <div className="smeta">Loading…</div>}
      {state.phase === "disconnected" && (
        <div className="gate" role="note">
          <span>Connect in the PassForge popup</span>
        </div>
      )}
      {state.phase === "locked" && (
        <div className="gate" role="note">
          <span>Unlock the PassForge app to autofill</span>
        </div>
      )}
      {state.phase === "error" && <div className="error">{state.message}</div>}

      {migrated && !migrated.done && (
        <div className="signup">
          <div className="section-title">After submitting: did the change succeed?</div>
          <button className="action primary" onClick={() => void markMigrated(migrated.entryId)}>
            Yes, mark migrated
          </button>
          <button className="action" onClick={() => setMigrated(null)}>Not yet</button>
        </div>
      )}
      {migrated?.done && <div className="smeta">Migrated — the vault now stores a generated entry.</div>}
      {state.phase === "ready" && !migrated && (
        <div className="entries">
          {state.entries.map((e) =>
            p.kind === "change" && e.kind === "sealed" ? (
              <button key={e.id} className="entry" onClick={() => void migrateFill(e.id)}>
                <span className="ename">{e.login}</span>
                <span className="esite">Migrate this account: fill current + new</span>
              </button>
            ) : (
              <button key={e.id} className="entry" onClick={() => void fill(e.id)}>
                <span className="ename">{e.login}</span>
                <span className="esite">{e.site}</span>
              </button>
            ),
          )}
          {state.entries.length === 0 && p.kind === "login" && (
            <div className="smeta">No entries match {hostOf(p.url)}.</div>
          )}
          {p.kind === "signup" && (
            <div className="signup">
              <div className="section-title">Generate a new password for {hostOf(p.url)}</div>
              <div className="field">
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="login"
                />
              </div>
              <button className="action primary" onClick={createAndFill} disabled={!login}>
                Generate &amp; fill
              </button>
            </div>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Frame />);
