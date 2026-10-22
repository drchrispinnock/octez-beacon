import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTez, describeOperation, contractEffects, describeApp, clip } from "../src/describe.js";

test("formatTez", () => {
  assert.equal(formatTez(0), "0 ꜩ");
  assert.equal(formatTez("1000000"), "1 ꜩ");
  assert.equal(formatTez(1500), "0.0015 ꜩ");
  assert.equal(formatTez("123456789"), "123.456789 ꜩ");
});

test("plain transfer", () => {
  const lines = describeOperation({ kind: "transaction", amount: "2500000", destination: "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb" });
  assert.deepEqual(lines, ["transaction: 2.5 ꜩ to tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb"]);
});

test("FA2 transfer is explained", () => {
  const value = [{ prim: "Pair", args: [{ string: "tz1from" }, [{ prim: "Pair", args: [{ string: "tz1to" }, { prim: "Pair", args: [{ int: "7" }, { int: "3" }] }] }]] }];
  const effects = contractEffects("KT1abc", "transfer", value);
  assert.deepEqual(effects, ["send 3 of token 7 in KT1abc from tz1from to tz1to"]);
  const lines = describeOperation({ kind: "transaction", amount: "0", destination: "KT1abc", parameters: { entrypoint: "transfer", value } });
  assert.equal(lines[0], "transaction: 0 ꜩ to KT1abc, entrypoint transfer");
  assert.equal(lines[1], "  effect: send 3 of token 7 in KT1abc from tz1from to tz1to");
  assert.match(lines[2], /^  parameters: /);
});

test("FA1.2 approve and FA2 update_operators", () => {
  assert.deepEqual(contractEffects("KT1tok", "approve", { prim: "Pair", args: [{ string: "tz1spender" }, { int: "100" }] }), ["ALLOW tz1spender to spend 100 units of the token KT1tok"]);
  const ops = [{ prim: "Left", args: [{ prim: "Pair", args: [{ string: "tz1owner" }, { prim: "Pair", args: [{ string: "tz1op" }, { int: "0" }] }] }] }];
  assert.deepEqual(contractEffects("KT1nft", "update_operators", ops), ["ALLOW tz1op to move token 0 in KT1nft owned by tz1owner"]);
  assert.deepEqual(contractEffects("KT1nft", "update_operators", [{ prim: "Pair" }]), []);
});

test("unknown contract call is flagged", () => {
  const lines = describeOperation({ kind: "transaction", amount: "0", destination: "KT1abc", parameters: { entrypoint: "swap", value: { int: "1" } } });
  assert.ok(lines.some((l) => /cannot interpret/.test(l)));
});

test("delegation and origination", () => {
  assert.deepEqual(describeOperation({ kind: "delegation", delegate: "tz1baker" }), ["delegation: delegate to tz1baker"]);
  assert.deepEqual(describeOperation({ kind: "delegation" }), ["delegation: remove the delegate"]);
  const lines = describeOperation({ kind: "origination", balance: "1000000", script: { code: [], storage: { int: "0" } } });
  assert.equal(lines[0], "origination: deploy a new contract with 1 ꜩ");
});

test("describeApp and clip strip control characters and long text", () => {
  assert.equal(describeApp({ name: "My\u001b[31m dApp", appUrl: "https://example.com" }), "My[31m dApp <https://example.com>");
  assert.equal(describeApp(null), "(unnamed dApp)");
  assert.equal(clip("x".repeat(100), 10).length, 10);
});
