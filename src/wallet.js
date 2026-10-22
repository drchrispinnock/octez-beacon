// The Beacon / Octez Connect wallet side: pairing with dApps over the relay, receiving requests
// and answering them. Requests are checked against what the transport proved (which paired peer
// sent them) and against the permissions this wallet granted before they are handed to the UI.

import { WalletClient, Serializer, getSenderId, setDebugEnabled } from "./sdk.js";

export const REQUEST_TYPES = ["permission_request", "operation_request", "sign_payload_request"];

/**
 * The pairing code as dApps show it is base58check JSON; the "open in wallet" links wrap it as
 * `<scheme>://?type=tzip10&data=<code>`. Accepts both, with surrounding whitespace.
 */
export function extractPairingCode(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  const q = trimmed.indexOf("?");
  if (q >= 0 && /[?&]data=/.test(trimmed)) {
    const params = new URLSearchParams(trimmed.slice(q + 1));
    const data = params.get("data");
    if (data) return data.trim();
  }
  return trimmed;
}

export async function decodePairingCode(input) {
  const code = extractPairingCode(input);
  if (!code) throw new Error("no pairing code given");
  let peer;
  try {
    peer = await new Serializer().deserialize(code);
  } catch {
    throw new Error("that is not a Beacon / Octez Connect pairing code");
  }
  if (!peer || typeof peer !== "object" || typeof peer.publicKey !== "string" || typeof peer.relayServer !== "string" || typeof peer.id !== "string") {
    throw new Error("that is not a Beacon / Octez Connect pairing code");
  }
  return peer;
}

/**
 * What the transport proved about an incoming message: the paired peer whose key decrypted it
 * and the sender id derived from that peer's public key (never read from the message itself).
 */
async function authenticate(client, context) {
  const publicKey = typeof context?.id === "string" ? context.id : null;
  if (!publicKey) return null;
  const peers = await client.getPeers();
  const peer = peers.find((p) => p?.publicKey === publicKey);
  if (!peer) return null;
  return { peer, senderId: await getSenderId(publicKey) };
}

/**
 * Pure check of an incoming request. Returns { request } with the sender id fixed to the
 * authenticated one, or { refused, errorType }.
 */
export function vetRequest(message, auth, permissions, ourAddress) {
  const refuse = (refused, errorType = "NOT_GRANTED_ERROR") => ({ refused, errorType });
  if (!message || typeof message !== "object" || typeof message.id !== "string" || typeof message.type !== "string") return refuse("malformed message", "PARAMETERS_INVALID_ERROR");
  if (!auth) return refuse("message from a peer that is not paired");
  if (!REQUEST_TYPES.includes(message.type)) return refuse(`${message.type} requests are not supported`);
  if (typeof message.senderId === "string" && message.senderId !== auth.senderId) return refuse("the message claims another sender id");
  if (typeof message.appMetadata?.senderId === "string" && message.appMetadata.senderId !== auth.senderId) return refuse("the message's app metadata claims another sender id");
  const request = { ...message, senderId: auth.senderId };
  if (request.appMetadata && typeof request.appMetadata === "object") request.appMetadata = { ...request.appMetadata, senderId: auth.senderId };
  else request.appMetadata = { senderId: auth.senderId, name: auth.peer?.name };
  if (message.type === "permission_request") return { request };

  if (message.sourceAddress !== ourAddress) return refuse(`the request is for ${message.sourceAddress}, not this wallet's ${ourAddress}`, "NO_PRIVATE_KEY_FOUND_ERROR");
  const scope = message.type === "operation_request" ? "operation_request" : "sign";
  const grant = (permissions ?? []).find((p) => p?.senderId === auth.senderId && p?.address === ourAddress && Array.isArray(p?.scopes) && p.scopes.includes(scope));
  if (!grant) return refuse(`this dApp was not granted "${scope}" for ${ourAddress}`);
  return { request, grant };
}

export class Wallet {
  constructor({ storage, name = "octez-beacon", debug = false, address, log = console.error }) {
    this.storage = storage;
    this.name = name;
    this.debug = debug;
    this.address = address;
    this.log = log;
    this.client = null;
  }

  /** Starts the client and begins listening; `onRequest(request, grant, peer)` gets each vetted request. */
  async start(onRequest) {
    if (this.debug) setDebugEnabled(true);
    const client = new WalletClient({ name: this.name, storage: this.storage });
    await client.init();
    await client.connect(async (message, context) => {
      try {
        const auth = await authenticate(client, context);
        const permissions = await client.getPermissions();
        const result = vetRequest(message, auth, permissions, this.address);
        if (result.refused) {
          this.log(`refused ${message?.type ?? "message"} from ${auth?.peer?.name ?? "unknown peer"}: ${result.refused}`);
          if (typeof message?.id === "string") await this.respond({ type: "error", id: message.id, errorType: result.errorType });
          return;
        }
        await onRequest(result.request, result.grant ?? null, auth.peer);
      } catch (error) {
        this.log(`error handling a dApp message: ${error?.message ?? error}`);
      }
    });
    this.client = client;
  }

  /** Pairs with a dApp. Resolves once the dApp has joined the relay room (which may take a while). */
  async pair(input) {
    const peer = await decodePairingCode(input);
    await this.client.addPeer(peer, true);
    return peer;
  }

  respond(message) { return this.client.respond(message); }
  peers() { return this.client.getPeers(); }
  permissions() { return this.client.getPermissions(); }

  async removePeer(peer) {
    await this.client.removePeer(peer, true);
  }

  async forgetAll() {
    await this.client.removeAllPeers(true);
    await this.client.removeAllPermissions();
  }

  async stop() {
    // Never destroy(): that wipes the stored seed, peers and permissions.
    try { const t = await this.client?.transport; await t?.disconnect?.(); } catch {}
    this.client = null;
  }
}
