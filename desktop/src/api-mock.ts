import type { Api } from "./api";
import type {
  EntryInput,
  EntrySummary,
  Finger,
  Folder,
  Settings,
  VaultEntry,
} from "./types";

const FA_ICONS = [
  "fa-rocket",
  "fa-heart",
  "fa-coffee",
  "fa-flag",
  "fa-bug",
  "fa-camera",
  "fa-bell",
  "fa-diamond",
  "fa-database",
  "fa-flask",
  "fa-bus",
  "fa-ship",
  "fa-beer",
  "fa-bomb",
  "fa-cloud",
];

const FP_COLORS = [
  "#074750",
  "#009191",
  "#FF6CB6",
  "#FFB5DA",
  "#490092",
  "#006CDB",
  "#B66DFF",
  "#6DB5FE",
  "#B5DAFE",
  "#920000",
  "#924900",
  "#DB6D00",
  "#24FE23",
];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fakeFingerprint(seed: string): Finger[] {
  const h = hashString(seed);
  return [0, 1, 2].map((i) => ({
    icon: FA_ICONS[(h >> (i * 5)) % FA_ICONS.length],
    color: FP_COLORS[(h >> (i * 3)) % FP_COLORS.length],
  }));
}

let locked = true;
let masterPassword = "";
let seq = 0;
const uid = () => `mock-${(seq += 1)}`;

const folders: Folder[] = [
  { id: "folder-logins", parentId: null, name: "Logins & Portals" },
  { id: "folder-infra", parentId: null, name: "Cloud & Infra" },
];

type MockEntry = VaultEntry;

const entries: MockEntry[] = [];

const DEFAULT_OPTIONS = { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 };

function seedEntry(
  site: string,
  login: string,
  folderId: string,
  counter: number,
  tags: string[],
) {
  const now = new Date().toISOString();
  entries.push({
    id: uid(),
    profile: {
      site,
      login,
      counter,
      options: { ...DEFAULT_OPTIONS },
      saltFields: [],
      crypto: null,
    },
    folderId,
    groupIds: [],
    tags,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  });
}

seedEntry("github.com", "dev@passforge.io", "folder-logins", 2, ["dev", "primary"]);
seedEntry("aws console", "ops-admin", "folder-infra", 5, ["cloud"]);
seedEntry("proton.me", "secure@proton.me", "folder-logins", 1, ["mail"]);
seedEntry("cloudflare.com", "infra@passforge.io", "folder-infra", 1, ["dns"]);
seedEntry("linear.app", "dev@passforge.io", "folder-logins", 1, []);
seedEntry("npmjs.com", "passforge-publish", "folder-infra", 3, ["dev"]);

let settings: Settings = {
  defaultCrypto: { iterations: 100_000, keylen: 32, digest: "sha256" },
  idleLockSeconds: 300,
  clipboardClearSeconds: 20,
};

function summarize(entry: MockEntry): EntrySummary {
  return {
    id: entry.id,
    site: entry.profile.site,
    login: entry.profile.login,
    counter: entry.profile.counter,
    folderId: entry.folderId,
    fingerprint: fakeFingerprint(entry.profile.login),
    lastUsedAt: entry.lastUsedAt,
  };
}

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";

function mockPassword(entry: MockEntry): string {
  const seed = hashString(
    `${masterPassword}:${entry.profile.site}:${entry.profile.login}:${entry.profile.counter}`,
  );
  let out = "";
  let h = seed;
  for (let i = 0; i < entry.profile.options.length; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    out += CHARS[h % CHARS.length];
  }
  return out;
}

export const mockApi: Api = {
  isLocked: async () => locked,
  unlockWithMasterPassword: async (pw: string) => {
    if (!pw) throw new Error("Authentication failed. Master key does not match local vault signature.");
    masterPassword = pw;
    locked = false;
  },
  lock: async () => {
    masterPassword = "";
    locked = true;
  },
  createFolder: async (input) => {
    const folder: Folder = { id: uid(), parentId: input.parentId, name: input.name };
    folders.push(folder);
    return folder;
  },
  listFolders: async () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
  createEntry: async (input: EntryInput) => {
    const now = new Date().toISOString();
    const entry: MockEntry = {
      id: uid(),
      profile: {
        site: input.site,
        login: input.login,
        counter: input.counter,
        options: input.options,
        saltFields: input.saltFields,
        crypto: input.crypto,
      },
      folderId: input.folderId,
      groupIds: input.groupIds,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
    entries.push(entry);
    return entry;
  },
  getEntry: async (entryId) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`entry not found: ${entryId}`);
    return entry;
  },
  updateEntry: async (entryId, input: EntryInput) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`entry not found: ${entryId}`);
    entry.profile = {
      site: input.site,
      login: input.login,
      counter: input.counter,
      options: input.options,
      saltFields: input.saltFields,
      crypto: input.crypto,
    };
    entry.folderId = input.folderId;
    entry.groupIds = input.groupIds;
    entry.tags = input.tags;
    entry.updatedAt = new Date().toISOString();
    return entry;
  },
  deleteEntry: async (entryId) => {
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx < 0) throw new Error(`entry not found: ${entryId}`);
    entries.splice(idx, 1);
  },
  previewFingerprint: async (pw: string) => fakeFingerprint(pw),
  searchEntries: async (query) => {
    const q = query.toLowerCase();
    return entries
      .filter(
        (e) =>
          e.profile.site.toLowerCase().includes(q) ||
          e.profile.login.toLowerCase().includes(q),
      )
      .map(summarize);
  },
  generatePassword: async (entryId) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`entry not found: ${entryId}`);
    entry.lastUsedAt = new Date().toISOString();
    return mockPassword(entry);
  },
  getSettings: async () => ({ ...settings }),
  saveSettings: async (next: Settings) => {
    settings = { ...next };
    return settings;
  },
};
