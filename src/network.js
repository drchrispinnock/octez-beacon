// Matching the network a dApp names against the chain the node actually serves.

import { TEZOS_NETWORK_GENESIS_IDS } from "./sdk.js";

/** Chain id a named Beacon network should have, or null when unknown (custom, rotating testnets). */
export function expectedChainId(network) {
  if (!network || typeof network !== "object") return null;
  return TEZOS_NETWORK_GENESIS_IDS[network.type] ?? null;
}

/** The Beacon network type that a chain id belongs to, or null. */
export function networkTypeForChain(chainId) {
  return Object.keys(TEZOS_NETWORK_GENESIS_IDS).find((t) => TEZOS_NETWORK_GENESIS_IDS[t] === chainId) ?? null;
}

/**
 * Compares the dApp's network with our node's chain id.
 * Returns { ok: true } when they agree, { ok: false, reason } when they certainly do not, and
 * { ok: null, note } when the dApp named a network whose chain id is not fixed (custom, weeklynet…).
 */
export function checkNetwork(network, ourChainId) {
  const type = typeof network?.type === "string" ? network.type : null;
  if (!type) return { ok: false, reason: "the request names no network" };
  const expected = expectedChainId(network);
  if (expected) {
    if (expected === ourChainId) return { ok: true };
    const ours = networkTypeForChain(ourChainId);
    return { ok: false, reason: `the dApp wants ${type} (${expected}) but the node serves ${ours ?? "chain"} ${ourChainId}` };
  }
  const rpc = typeof network.rpcUrl === "string" ? network.rpcUrl : null;
  return { ok: null, note: `the dApp names network "${type}"${rpc ? ` with RPC ${rpc}` : ""}, whose chain id this tool does not know; the node serves ${ourChainId}` };
}
