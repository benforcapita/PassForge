export type ClipboardDeps = {
  set(value: string): Promise<unknown>;
  get(): Promise<string>;
  schedule(fn: () => void, ms: number): unknown;
};

export const CLIPBOARD_CLEAR_SECONDS = 30;

/** Copies, then clears after `seconds` — only if the clipboard still holds it. */
export async function copyWithWipe(
  value: string,
  deps: ClipboardDeps,
  seconds = CLIPBOARD_CLEAR_SECONDS,
): Promise<void> {
  await deps.set(value);
  deps.schedule(() => {
    void deps.get().then((current) => (current === value ? deps.set("") : undefined));
  }, seconds * 1000);
}
