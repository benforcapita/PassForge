export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export async function readJson<T>(store: KeyValueStore, key: string, fallback: T): Promise<T> {
  const raw = await store.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  return store.set(key, JSON.stringify(value));
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
  };
}
