import * as SecureStore from "expo-secure-store";
import type { KeyValueStore } from "./storage";

// Parameters only (servers, profiles): never a password or master password.
export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
};
