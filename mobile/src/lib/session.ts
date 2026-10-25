import { useSyncExternalStore } from "react";
import type { PasswordOptions } from "passforge-protocol";

// In-memory only. The master password is never persisted and is cleared
// whenever the app leaves the foreground (see app/_layout.tsx).
export type Draft = PasswordOptions & { site: string; login: string; counter: number };

export const DEFAULT_DRAFT: Draft = {
  site: "",
  login: "",
  counter: 1,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  length: 16,
};

type State = { draft: Draft; masterPassword: string };

let state: State = { draft: DEFAULT_DRAFT, masterPassword: "" };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export const session = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setDraft: (draft: Partial<Draft>) => emit({ ...state, draft: { ...state.draft, ...draft } }),
  setMasterPassword: (masterPassword: string) => emit({ ...state, masterPassword }),
  lock: () => emit({ ...state, masterPassword: "" }),
};

export function useSession(): State {
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}
