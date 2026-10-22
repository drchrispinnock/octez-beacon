import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShowAddress, parseKnownAddresses, parseSignature, OctezClient } from "../src/octez-client.js";

test("parseShowAddress reads hash and public key", () => {
  const out = parseShowAddress("Hash: tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb\nPublic Key: edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav\n");
  assert.deepEqual(out, { address: "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb", publicKey: "edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav" });
  assert.throws(() => parseShowAddress("No keys found for address"), /did not report/);
});

test("parseKnownAddresses tells secret keys from public ones", () => {
  const text = [
    "alice: tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb (unencrypted sk known)",
    "bob: tz1faswCTDciRzE4oJ9jn2Vm2dvjeyA9fUzU (encrypted sk known)",
    "ledgy: tz3WXYtyDUNL91qfiCJtVUX746QpNv5i5ve5 (ledger sk known)",
    "carol: tz2BFTyPeYRzxd5aiBchbXN3WCZhx7BqbMBq (pk known)",
    "dave: tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx",
    "NFT receiver: tz1gUCWWwmwEpc7eVd4NHy3UhL28K4j9L6jy (encrypted sk known)",
  ].join("\n");
  const known = parseKnownAddresses(text);
  assert.equal(known.length, 6);
  assert.deepEqual(known[5], { alias: "NFT receiver", address: "tz1gUCWWwmwEpc7eVd4NHy3UhL28K4j9L6jy", secretKeyKnown: true, scheme: "encrypted" });
  assert.deepEqual(known[0], { alias: "alice", address: "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb", secretKeyKnown: true, scheme: "unencrypted" });
  assert.equal(known[1].scheme, "encrypted");
  assert.equal(known[2].scheme, "ledger");
  assert.equal(known[3].secretKeyKnown, false);
  assert.equal(known[4].secretKeyKnown, false);
});

test("parseSignature reads the signature line", () => {
  assert.equal(parseSignature("Signature: edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q\n"), "edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q");
  assert.throws(() => parseSignature("Error"), /did not print/);
  // An encrypted key's password prompt has no newline, so the signature follows it on one line.
  assert.equal(parseSignature("Enter password for encrypted key: Signature: edsigu3LMTnjriBSfB2ULwckbznHnv71BZKyRoMio1zjj7yJxcx711tsP7xgNReLpxyY9qTdvS4hKisZ7vSv1swR9Jk3ZoDiCWA\n"), "edsigu3LMTnjriBSfB2ULwckbznHnv71BZKyRoMio1zjj7yJxcx711tsP7xgNReLpxyY9qTdvS4hKisZ7vSv1swR9Jk3ZoDiCWA");
});

test("OctezClient passes endpoint, base dir and password file as global options", () => {
  const c = new OctezClient({ endpoint: "http://n:8732", baseDir: "/tmp/x", passwordFile: "/tmp/p" });
  assert.deepEqual(c.globalArgs(), ["-E", "http://n:8732", "-d", "/tmp/x", "-f", "/tmp/p"]);
  assert.deepEqual(new OctezClient({ endpoint: "http://n:8732" }).globalArgs(), ["-E", "http://n:8732"]);
});

test("signBytes refuses non-hex input before running anything", async () => {
  const c = new OctezClient({ endpoint: "http://n:8732", binary: "/nonexistent/octez-client" });
  await assert.rejects(c.signBytes("0x03zz", "k"), /not hex/);
});

test("a missing octez-client binary is reported plainly", async () => {
  const c = new OctezClient({ endpoint: "http://n:8732", binary: "/nonexistent/octez-client" });
  await assert.rejects(c.showAddress("k"), /not found/);
});
