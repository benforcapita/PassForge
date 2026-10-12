import { useCallback, useEffect, useRef, useState } from "react";

type ToastState = {
  message: string;
  countdownSeconds: number;
} | null;

export function useClipboard(clipboardClearSeconds: number) {
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const iconTimer = useRef<number | null>(null);
  const wipeTimer = useRef<number | null>(null);
  const onWipeRef = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (iconTimer.current != null) window.clearTimeout(iconTimer.current);
    if (wipeTimer.current != null) window.clearTimeout(wipeTimer.current);
    iconTimer.current = null;
    wipeTimer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setToast(null);
    setCopied(false);
  }, [clearTimers]);

  const copy = useCallback(
    async (text: string, onWipe?: () => void) => {
      await navigator.clipboard.writeText(text);
      clearTimers();
      setCopied(true);
      setToast({
        message: `Password copied to clipboard. Memory buffer will wipe in ${clipboardClearSeconds}s.`,
        countdownSeconds: clipboardClearSeconds,
      });
      onWipeRef.current = onWipe ?? null;
      iconTimer.current = window.setTimeout(() => setCopied(false), 1200);
      wipeTimer.current = window.setTimeout(async () => {
        try {
          await navigator.clipboard.writeText("");
        } catch {
          // best effort: clipboard may be unavailable
        }
        onWipeRef.current?.();
        setToast(null);
      }, clipboardClearSeconds * 1000);
    },
    [clipboardClearSeconds, clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  return { copied, toast, copy, dismiss };
}
