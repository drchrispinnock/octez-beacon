import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNetwork, networkTypeForChain, expectedChainId } from "../src/network.js";

test("known networks", () => {
  assert.equal(expectedChainId({ type: "mainnet" }), "NetXdQprcVkpaWU");
  assert.equal(networkTypeForChain("NetXnHfVqm9iesp"), "ghostnet");
  assert.equal(networkTypeForChain("NetXnope"), null);
});

test("checkNetwork agrees, disagrees or shrugs", () => {
  assert.deepEqual(checkNetwork({ type: "mainnet" }, "NetXdQprcVkpaWU"), { ok: true });
  assert.match(checkNetwork({ type: "mainnet" }, "NetXnHfVqm9iesp").reason, /wants mainnet .* serves ghostnet/);
  const custom = checkNetwork({ type: "custom", rpcUrl: "https://rpc.example" }, "NetXnHfVqm9iesp");
  assert.equal(custom.ok, null);
  assert.match(custom.note, /rpc.example/);
  assert.equal(checkNetwork(null, "NetXnHfVqm9iesp").ok, false);
});
