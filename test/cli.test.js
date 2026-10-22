import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, DEFAULT_ENDPOINT } from "../src/cli.js";

test("parseArgs", () => {
  const o = parseArgs(["alice"]);
  assert.equal(o.key, "alice");
  assert.equal(o.endpoint, DEFAULT_ENDPOINT);
  const p = parseArgs(["-E", "https://rpc.example", "-d", "/w", "-f", "/pw", "--data-dir", "/dd", "--debug", "bob"]);
  assert.deepEqual([p.endpoint, p.baseDir, p.passwordFile, p.dataDir, p.debug, p.key], ["https://rpc.example", "/w", "/pw", "/dd", true, "bob"]);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-V"]).version, true);
  assert.throws(() => parseArgs([]), /key alias is required/);
  assert.throws(() => parseArgs(["-E"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus", "k"]), /unknown option/);
  assert.throws(() => parseArgs(["a", "b"]), /unexpected argument/);
});
