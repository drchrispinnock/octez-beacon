import { test } from "node:test";
import assert from "node:assert/strict";
import { toTaquitoParams, validateOperations, summarize, MAX_OPERATIONS } from "../src/operations.js";

test("toTaquitoParams", () => {
  assert.deepEqual(toTaquitoParams({ kind: "transaction", destination: "tz1x", amount: "10" }), { kind: "transaction", to: "tz1x", amount: 10, mutez: true });
  const p = toTaquitoParams({ kind: "transaction", destination: "KT1x", amount: "0", parameters: { entrypoint: "default", value: { prim: "Unit" } } });
  assert.deepEqual(p.parameter, { entrypoint: "default", value: { prim: "Unit" } });
  assert.deepEqual(toTaquitoParams({ kind: "delegation", delegate: "tz1b" }), { kind: "delegation", delegate: "tz1b" });
  assert.deepEqual(toTaquitoParams({ kind: "delegation" }), { kind: "delegation", delegate: undefined });
  assert.deepEqual(toTaquitoParams({ kind: "origination", balance: "5", script: { code: [], storage: { int: "0" } } }), { kind: "origination", code: [], init: { int: "0" }, balance: 5, mutez: true });
  assert.throws(() => toTaquitoParams({ kind: "transaction" }), /no destination/);
  assert.throws(() => toTaquitoParams({ kind: "origination" }), /no script/);
  assert.throws(() => toTaquitoParams({ kind: "reveal" }), /not supported/);
});

test("validateOperations", () => {
  assert.match(validateOperations([]), /no operations/);
  assert.match(validateOperations(Array(MAX_OPERATIONS + 1).fill({ kind: "delegation" })), /too many/);
  assert.match(validateOperations([{ kind: "ballot" }]), /not supported/);
  assert.equal(validateOperations([{ kind: "delegation" }]), null);
});

test("summarize adds up fees, burn and amounts, with and without a reveal", () => {
  const ops = [{ kind: "transaction", destination: "tz1x", amount: "1000000", fee: "99999999" }, { kind: "delegation", delegate: "tz1b" }];
  const estimates = [{ burnFeeMutez: 64250 }, { burnFeeMutez: 0 }];
  const contents = [
    { kind: "reveal", fee: "300", gas_limit: "1000", storage_limit: "0" },
    { kind: "transaction", fee: "400", gas_limit: "2000", storage_limit: "257" },
    { kind: "delegation", fee: "500", gas_limit: "1000", storage_limit: "0" },
  ];
  const { lines, totalDebitMutez } = summarize(ops, contents, estimates);
  assert.equal(totalDebitMutez, String(1000000 + 300 + 400 + 500 + 64250));
  assert.match(lines[0], /^reveal/);
  assert.match(lines[1], /^1\. transaction: 1 ꜩ to tz1x/);
  assert.ok(lines.some((l) => /asked for a fee of 99.999999 ꜩ/.test(l)));
  assert.match(lines.at(-1), /^total: 1 ꜩ sent, 0.0012 ꜩ fees, 0.06425 ꜩ storage burn = 1.06545 ꜩ debited$/);
  const noReveal = summarize(ops, contents.slice(1), estimates);
  assert.ok(!noReveal.lines.some((l) => /^reveal/.test(l)));
  assert.throws(() => summarize(ops, contents.slice(2), estimates), /prepared 1 operations for 2/);
});
