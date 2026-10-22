import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "../src/storage.js";

test("FileStorage persists values and serves SDK defaults for missing keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "octez-beacon-"));
  const path = join(dir, "sub", "storage.json");
  const s = new FileStorage(path);
  assert.deepEqual(await s.get("beacon:communication-peers-wallet"), []);
  assert.equal(await s.get("beacon:sdk-secret-seed"), undefined);
  await s.set("beacon:sdk-secret-seed", "seed");
  await s.set("beacon:communication-peers-wallet", [{ name: "x" }]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const again = new FileStorage(path);
  assert.equal(await again.get("beacon:sdk-secret-seed"), "seed");
  assert.deepEqual(await again.get("beacon:communication-peers-wallet"), [{ name: "x" }]);
  (await again.get("beacon:communication-peers-wallet")).push("mutated");
  assert.deepEqual(await again.get("beacon:communication-peers-wallet"), [{ name: "x" }]);
  await again.delete("beacon:sdk-secret-seed");
  assert.equal(JSON.parse(readFileSync(path, "utf8"))["beacon:sdk-secret-seed"], undefined);
});

test("FileStorage refuses a corrupt file rather than silently starting afresh", () => {
  const dir = mkdtempSync(join(tmpdir(), "octez-beacon-"));
  const path = join(dir, "storage.json");
  writeFileSync(path, "{not json");
  assert.throws(() => new FileStorage(path), /cannot read/);
});
