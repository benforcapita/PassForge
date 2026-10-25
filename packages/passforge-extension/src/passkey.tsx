import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Candidate = { credentialId: string; userName: string; displayName: string };
type Details = {
  reqId: string;
  kind: string;
  origin: string;
  rpId: string;
  userName: string;
  displayName: string;
  candidates: Candidate[];
};

function host(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

function choose(reqId: string, choice: string, credentialId?: string) {
  // The SW closes the window via finishPasskey — closing here first would
  // race the onRemoved "cancelled" path and lose the choice.
  void chrome.runtime.sendMessage({ type: "pf:passkey-choice", reqId, choice, credentialId });
}

function PasskeyPrompt() {
  const [details, setDetails] = useState<Details | null>(null);
  const reqId = new URLSearchParams(location.search).get("req") ?? "";
  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: "pf:passkey-details", reqId })
      .then((res) => {
        if (res?.ok) setDetails(res as Details);
      });
  }, [reqId]);

  if (!details) return <div className="frame"><div className="smeta">Loading…</div></div>;
  const create = details.kind === "create";
  return (
    <div className="frame">
      <div className="header">
        <span className="title">PassForge</span>
        <span className="badge">{host(details.origin)}</span>
      </div>
      {create ? (
        <>
          <p className="smeta">
            Create a passkey for <strong>{details.rpId}</strong> as{" "}
            <strong>{details.displayName || details.userName}</strong>?
          </p>
          <button className="action primary" onClick={() => choose(details.reqId, "confirm")}>
            Create
          </button>
        </>
      ) : (
        <>
          <p className="smeta">
            Sign in to <strong>{details.rpId}</strong> with a passkey?
          </p>
          {details.candidates?.map((c) => (
            <button
              key={c.credentialId}
              className="entry"
              onClick={() => choose(details.reqId, "confirm", c.credentialId)}
            >
              <span className="ename">{c.displayName || c.userName}</span>
              <span className="esite">{c.userName}</span>
            </button>
          ))}
        </>
      )}
      <button className="action" onClick={() => choose(details.reqId, "fallback")}>
        Use another device or passkey
      </button>
      <button className="action" onClick={() => choose(details.reqId, "cancel")}>
        Cancel
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<PasskeyPrompt />);
