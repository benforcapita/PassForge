import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
const WARNING_SECONDS = 10;

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

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        idleLockSeconds - Math.floor((Date.now() - lastActivity.current) / 1000),
      );
      setSecondsUntilLock(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        onLockRef.current();
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
    };
  }, [idleLockSeconds]);

  return { secondsUntilLock, idleWarning: secondsUntilLock <= WARNING_SECONDS, reset };
}
