import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
const WARNING_SECONDS = 10;
/** Notify the backend at most this often while the user is active. */
const ACTIVITY_PING_MS = 5000;

/**
 * Locks the vault after `idleLockSeconds` of inactivity.
 * Exposes `secondsUntilLock` (updated ~1/s) so the status bar can show the
 * amber warning during the final WARNING_SECONDS window.
 */
export function useIdleLock(idleLockSeconds: number, onLock: () => void) {
  const [secondsUntilLock, setSecondsUntilLock] = useState(idleLockSeconds);
  const lastActivity = useRef(Date.now());
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const reset = useCallback(() => {
    lastActivity.current = Date.now();
    setSecondsUntilLock(idleLockSeconds);
  }, [idleLockSeconds]);

  useEffect(() => {
    lastActivity.current = Date.now();
    setSecondsUntilLock(idleLockSeconds);

    let lastPing = 0;
    const onActivity = () => {
      lastActivity.current = Date.now();
      // Keep the backend idle timer in sync; it owns the real lock.
      if (isTauri() && Date.now() - lastPing >= ACTIVITY_PING_MS) {
        lastPing = Date.now();
        void api.recordActivity().catch(() => {});
      }
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    // Inside Tauri the backend timer is authoritative: it zeroizes the
    // master password and emits "passforge://vault-locked". The interval
    // below only drives the countdown display. Outside Tauri (browser dev)
    // there is no backend, so the frontend timer locks on its own.
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void listen("passforge://vault-locked", () => onLockRef.current()).then(
        (fn) => (unlisten = fn),
      );
    }

    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        idleLockSeconds - Math.floor((Date.now() - lastActivity.current) / 1000),
      );
      setSecondsUntilLock(remaining);
      if (remaining <= 0 && !isTauri()) {
        window.clearInterval(timer);
        onLockRef.current();
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      unlisten?.();
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    };
  }, [idleLockSeconds]);

  return { secondsUntilLock, idleWarning: secondsUntilLock <= WARNING_SECONDS, reset };
}
