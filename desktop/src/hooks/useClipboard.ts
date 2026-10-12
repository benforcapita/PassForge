import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  readText as tauriReadText,
  writeText as tauriWriteText,
} from "@tauri-apps/plugin-clipboard-manager";

const writeClipboard = (text: string) =>
  isTauri() ? tauriWriteText(text) : navigator.clipboard.writeText(text);

const readClipboard = () =>
  isTauri() ? tauriReadText() : navigator.clipboard.readText();

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

  const lastCopied = useRef<string | null>(null);

  const copy = useCallback(
    async (text: string, onWipe?: () => void) => {
      try {
        await writeClipboard(text);
      } catch {
        clearTimers();
        setCopied(false);
        setToast({
          message: "Clipboard write failed. Password not copied.",
          countdownSeconds: 0,
        });
        return;
      }
      clearTimers();
      setCopied(true);
      setToast({
        message: `Password copied to clipboard. Memory buffer will wipe in ${clipboardClearSeconds}s.`,
        countdownSeconds: clipboardClearSeconds,
      });
      onWipeRef.current = onWipe ?? null;
      lastCopied.current = text;
      iconTimer.current = window.setTimeout(() => setCopied(false), 1200);
      wipeTimer.current = window.setTimeout(async () => {
        try {
          // Only wipe if the clipboard still holds what we copied —
          // never clobber something the user copied afterwards.
          const current = await readClipboard();
          if (current === lastCopied.current) {
            await writeClipboard("");
          }
        } catch {
          // best effort: clipboard may be unavailable
        }
        lastCopied.current = null;
        onWipeRef.current?.();
        setToast(null);
      }, clipboardClearSeconds * 1000);
    },
    [clipboardClearSeconds, clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  return { copied, toast, copy, dismiss };
}
