export type CryptoConfig = {
  iterations: number;
  keylen: number;
  digest: "sha256" | "sha512" | "sha1";
};

export type PasswordOptions = {
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  length: number;
};

export type SaltField = {
  key: string;
  value: string;
};

export type EntryInput = {
  site: string;
  login: string;
  counter: number;
  options: PasswordOptions;
  saltFields: SaltField[];
  crypto: CryptoConfig | null;
  folderId: string;
  groupIds: string[];
  tags: string[];
};

export type Finger = {
  icon: string;
  color: string;
};

export type EntryKind = "generated" | "sealed";

export type VaultEntry = {
  id: string;
  kind: EntryKind;
  profile: {
    site: string;
    login: string;
    counter: number;
    options: PasswordOptions;
    saltFields: SaltField[];
    crypto: CryptoConfig | null;
  };
  folderId: string;
  groupIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type FolderInput = {
  parentId: string | null;
  name: string;
};

export type EntrySummary = {
  id: string;
  kind: EntryKind;
  site: string;
  login: string;
  counter: number;
  folderId: string;
  fingerprint: Finger[] | null;
  lastUsedAt: string | null;
};

export type Folder = {
  id: string;
  parentId: string | null;
  name: string;
};

export type Settings = {
  passkeyTouchId?: boolean;
  defaultCrypto: CryptoConfig;
  idleLockSeconds: number;
  clipboardClearSeconds: number;
  generation: GenerationMode;
  /** Algorithm servers the user has added; `generation` points at the active one. */
  knownServers: string[];
};

export type BackendInfo = {
  port: number;
  token: string;
};

export type GenerationMode =
  | { mode: "serverless" }
  | { mode: "server"; url: string; algorithm: string | null };

export type ServerInfo = {
  protocol: string;
  name: string;
  version: string;
  default_algorithm: string;
  algorithms: { id: string; description: string; portable: boolean }[];
};

export type PasskeyRecord = {
  id: string;
  rpId: string;
  userHandle: string;
  userName: string;
  displayName: string;
  nonce: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ImportReport2 = {
  total: number;
  reverseMatched: number;
  sealed: number;
  lessPassProfiles: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  skipReasons: string[];
};

export type MigrationPreview = { current: string; next: string };

export type SealedList = { entries: EntrySummary[]; migrated: number };

export type ImportReport = {
  foldersCreated: number;
  foldersSkipped: number;
  entriesCreated: number;
  entriesSkipped: number;
};
