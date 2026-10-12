import { useEffect } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

type Binding = {
  /** KeyboardEvent.key, compared case-insensitively (e.g. "k", "n", ",", "l"). */
  key: string;
  shift?: boolean;
  handler: HotkeyHandler;
};

/**
 * Registers Cmd (macOS) OR Ctrl bindings on window.
 */
export function useHotkeys(bindings: Binding[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      for (const b of bindings) {
        if (e.key.toLowerCase() !== b.key.toLowerCase()) continue;
        if ((b.shift ?? false) !== e.shiftKey) continue;
        e.preventDefault();
        b.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, enabled]);
}
