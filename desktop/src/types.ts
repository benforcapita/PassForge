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
};
