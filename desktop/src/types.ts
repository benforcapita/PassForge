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

export type VaultEntry = {
  id: string;
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

export type ImportReport = {
  foldersCreated: number;
  foldersSkipped: number;
  entriesCreated: number;
  entriesSkipped: number;
};
