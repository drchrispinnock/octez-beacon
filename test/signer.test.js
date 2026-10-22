import { test } from "node:test";
import assert from "node:assert/strict";
import { OctezClientSigner, unpackSignature, toHex } from "../src/signer.js";

// A real Ed25519 signature (from Taquito's test vectors); its raw bytes are what sbytes must carry.
const EDSIG = "edsigtkpiSSschcaCt9pUVrpNPf7TTcgvgDEDD6NCEHMy8NNQJCGnMfLZzYoQj74yLjo9wx6MPVV29CvVzgi7qEcEUok3k7AuMg";

test("unpackSignature yields 64 raw bytes and a generic form", () => {
  const { raw, sig } = unpackSignature(EDSIG);
  assert.equal(raw.length, 64);
  assert.ok(sig.startsWith("sig"));
  assert.throws(() => unpackSignature("edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav"));
});

test("the signer prepends the watermark and asks octez-client to sign the alias", async () => {
  const calls = [];
  const fake = { signBytes: async (hex, alias) => { calls.push({ hex, alias }); return EDSIG; } };
  const signer = new OctezClientSigner(fake, { alias: "alice", address: "tz1a", publicKey: "edpkA" });
  assert.equal(await signer.publicKeyHash(), "tz1a");
  assert.equal(await signer.publicKey(), "edpkA");
  const forged = "aa".repeat(40);
  const out = await signer.sign(forged, new Uint8Array([3]));
  assert.deepEqual(calls, [{ hex: "03" + forged, alias: "alice" }]);
  assert.equal(out.bytes, forged);
  assert.equal(out.prefixSig, EDSIG);
  assert.equal(out.sbytes, forged + toHex(unpackSignature(EDSIG).raw));
  await signer.sign("0501", undefined);
  assert.equal(calls[1].hex, "0501");
});
