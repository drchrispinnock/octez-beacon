import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayloadRefusal, describePayload } from "../src/payload.js";
import { isPackedMicheline } from "../src/micheline.js";

const hex = (s) => Buffer.from(s, "utf8").toString("hex");
const packedString = (s) => "0501" + (s.length >>> 0).toString(16).padStart(8, "0") + hex(s);

test("packed strings are accepted and shown as text", () => {
  const payload = packedString("Tezos Signed Message: example.com 2026-10-22 hello");
  assert.equal(signPayloadRefusal("micheline", payload), null);
  assert.equal(signPayloadRefusal("raw", payload), null);
  assert.deepEqual(describePayload(payload), { kind: "text", text: "Tezos Signed Message: example.com 2026-10-22 hello", bytes: payload.length / 2 });
});

test("other well-formed packed data is accepted and shown as hex", () => {
  const pairOfInts = "05" + "07" + "07" + "0001" + "0002"; // Pair 1 2
  assert.equal(signPayloadRefusal("micheline", pairOfInts), null);
  assert.equal(describePayload(pairOfInts).kind, "hex");
});

test("operations and non-05 payloads are refused", () => {
  assert.match(signPayloadRefusal("operation", "03" + "00".repeat(40)), /not signed/);
  assert.match(signPayloadRefusal("micheline", "03" + "00".repeat(40)), /no 05 prefix/);
  assert.match(signPayloadRefusal("raw", "deadbeef"), /no 05 prefix/);
  assert.match(signPayloadRefusal("micheline", "05zz"), /not valid hex/);
  assert.match(signPayloadRefusal("micheline", ""), /not valid hex/);
  assert.match(signPayloadRefusal("micheline", "0501000000ff" + "41"), /not one complete/);
  assert.match(signPayloadRefusal("micheline", "0501000000014142"), /not one complete/); // trailing byte
  assert.match(signPayloadRefusal("something", "0500"), /unknown signing type/);
});

test("micheline reader covers every tag", () => {
  assert.equal(isPackedMicheline("05" + "00" + "81" + "01"), true); // multi-byte int
  assert.equal(isPackedMicheline("05" + "0a" + "00000002" + "abcd"), true); // bytes
  assert.equal(isPackedMicheline("05" + "02" + "00000004" + "0001" + "0002"), true); // { 1 ; 2 }
  assert.equal(isPackedMicheline("05" + "02" + "00000003" + "0001" + "0002"), false); // sequence length cuts an element
  assert.equal(isPackedMicheline("05" + "03" + "6c"), true); // Unit
  assert.equal(isPackedMicheline("05" + "04" + "6c" + "00000002" + "2561"), true); // Unit %a
  assert.equal(isPackedMicheline("05" + "05" + "05" + "0001"), true); // Some 1
  assert.equal(isPackedMicheline("05" + "09" + "07" + "00000004" + "0001" + "0002" + "00000000"), true); // Pair 1 2 generic
  assert.equal(isPackedMicheline("05" + "0b"), false); // unknown tag
  assert.equal(isPackedMicheline("05"), false);
});
