// The SDK's storage (its own key pair, paired dApps, granted permissions) kept in one JSON file,
// so pairings survive restarts. Written atomically and readable only by the user.

import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Storage, storageDefaults } from "./sdk.js";

export function defaultDataDir() {
  return process.env.OCTEZ_BEACON_DIR || join(homedir(), ".octez-beacon");
}

export class FileStorage extends Storage {
  static async isSupported() { return true; }

  constructor(path) {
    super();
    this.path = path;
    this.data = {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.data = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`cannot read ${path}: ${error.message}`);
    }
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  async get(key) {
    if (Object.hasOwn(this.data, key)) return structuredClone(this.data[key]);
    // Missing keys must yield the SDK's typed defaults (e.g. [] for peer lists); a fresh copy
    // so the SDK cannot mutate the shared default.
    const fallback = storageDefaults[key];
    return fallback === undefined ? undefined : structuredClone(fallback);
  }

  async set(key, value) {
    this.data[key] = structuredClone(value);
    this.flush();
  }

  async delete(key) {
    delete this.data[key];
    this.flush();
  }

  async subscribeToStorageChanged() {}

  getPrefixedKey(key) { return key; }
}
