// Loads the Octez Connect (Beacon fork) wallet SDK and Taquito.
//
// The SDK's ESM build uses extension-less relative imports that Node cannot resolve, so it is
// loaded through its CommonJS entry. The SDK also reads `localStorage` in a few places even when
// it has been given its own storage (a ReferenceError there would silently drop every incoming
// message), so a harmless in-memory shim is installed first. Node's own `localStorage` is only
// present when started with --localstorage-file, and touching it prints a warning.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function installLocalStorageShim() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (descriptor && typeof descriptor.value === "object" && descriptor.value !== null) return;
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true, writable: true });
}

installLocalStorageShim();

export const { WalletClient } = require("@tezos-x/octez.connect-wallet");
export const { Serializer, getSenderId, setDebugEnabled, TEZOS_NETWORK_GENESIS_IDS } = require("@tezos-x/octez.connect-core");
export const { Storage, defaultValues: storageDefaults, NetworkType, PermissionScope, BeaconErrorType, BeaconMessageType, SigningType } =
  require("@tezos-x/octez.connect-types");
