import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPairingCode, decodePairingCode, vetRequest } from "../src/wallet.js";
import { Serializer } from "../src/sdk.js";

const peer = { type: "p2p-pairing-request", id: "7d2b1c1e-1111-4222-8333-444455556666", name: "Test dApp", publicKey: "a".repeat(64), relayServer: "beacon-node-1.example.org", version: "3" };

test("extractPairingCode accepts raw codes and wallet links", () => {
  assert.equal(extractPairingCode("  abc  "), "abc");
  assert.equal(extractPairingCode("tezos://?type=tzip10&data=abc"), "abc");
  assert.equal(extractPairingCode("https://wallet.example/?type=tzip10&data=abc&x=1"), "abc");
  assert.equal(extractPairingCode(""), "");
});

test("decodePairingCode round-trips the SDK serializer", async () => {
  const code = await new Serializer().serialize(peer);
  const decoded = await decodePairingCode(code);
  assert.equal(decoded.publicKey, peer.publicKey);
  assert.equal(decoded.relayServer, peer.relayServer);
  const viaLink = await decodePairingCode(`signet://?type=tzip10&data=${code}`);
  assert.equal(viaLink.id, peer.id);
});

test("decodePairingCode rejects junk", async () => {
  await assert.rejects(decodePairingCode("not a code"), /not a Beacon/);
  await assert.rejects(decodePairingCode(""), /no pairing code/);
  const incomplete = await new Serializer().serialize({ name: "x" });
  await assert.rejects(decodePairingCode(incomplete), /not a Beacon/);
});

const auth = { peer, senderId: "SENDER1" };
const me = "tz1me";

test("vetRequest: permission requests only need a paired peer", () => {
  const r = vetRequest({ id: "1", type: "permission_request", appMetadata: { name: "d", senderId: "SENDER1" }, network: { type: "mainnet" }, scopes: ["sign"] }, auth, [], me);
  assert.equal(r.refused, undefined);
  assert.equal(r.request.senderId, "SENDER1");
  assert.equal(vetRequest({ id: "1", type: "permission_request" }, null, [], me).errorType, "NOT_GRANTED_ERROR");
});

test("vetRequest: sender id claims must match the transport", () => {
  assert.match(vetRequest({ id: "1", type: "permission_request", senderId: "OTHER" }, auth, [], me).refused, /another sender/);
  assert.match(vetRequest({ id: "1", type: "permission_request", appMetadata: { senderId: "OTHER" } }, auth, [], me).refused, /another sender/);
});

test("vetRequest: operations and signing need a grant for this account", () => {
  const op = { id: "2", type: "operation_request", sourceAddress: me, network: { type: "mainnet" }, operationDetails: [] };
  assert.match(vetRequest(op, auth, [], me).refused, /not granted/);
  const perms = [{ senderId: "SENDER1", address: me, scopes: ["operation_request"] }];
  assert.equal(vetRequest(op, auth, perms, me).grant, perms[0]);
  assert.match(vetRequest({ ...op, type: "sign_payload_request" }, auth, perms, me).refused, /"sign"/);
  assert.equal(vetRequest({ ...op, sourceAddress: "tz1other" }, auth, perms, me).errorType, "NO_PRIVATE_KEY_FOUND_ERROR");
  assert.match(vetRequest({ id: "3", type: "broadcast_request" }, auth, perms, me).refused, /not supported/);
});
