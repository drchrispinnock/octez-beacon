// Turning a dApp's operation request into exactly one signed, injected operation group.
//
// The batch is simulated first with a read-only signer so the user sees the real fee, gas,
// storage and burn before approving. What they approve is then forged locally, signed through
// octez-client, preapplied and injected without being rebuilt or re-estimated. The dApp's own
// fee/gas/storage are not used: the node's estimate is.

import { TezosToolkit } from "@taquito/taquito";
import { RpcClient } from "@taquito/rpc";
import { localForger } from "@taquito/local-forging";
import { encodeOpHash } from "@taquito/utils";
import { readOnlySigner } from "./signer.js";
import { describeOperation, formatTez, mutezString } from "./describe.js";

export const MAX_OPERATIONS = 64;
export const OPERATION_KINDS = ["transaction", "delegation", "origination"];

/** Maps a TZIP-10 partial operation onto Taquito batch params (without fee, gas or storage). */
export function toTaquitoParams(op) {
  switch (op.kind) {
    case "transaction":
      if (typeof op.destination !== "string") throw new Error("a transaction has no destination");
      return {
        kind: "transaction",
        to: op.destination,
        amount: Number(mutezString(op.amount)),
        mutez: true,
        ...(op.parameters ? { parameter: op.parameters } : {}),
      };
    case "delegation":
      return { kind: "delegation", delegate: op.delegate || undefined };
    case "origination":
      if (!op.script?.code || op.script?.storage === undefined) throw new Error("an origination has no script");
      return { kind: "origination", code: op.script.code, init: op.script.storage, balance: Number(mutezString(op.balance)), mutez: true };
    default:
      throw new Error(`operation kind "${op.kind}" is not supported`);
  }
}

export function validateOperations(ops) {
  if (!Array.isArray(ops) || ops.length === 0) return "the request contains no operations";
  if (ops.length > MAX_OPERATIONS) return `${ops.length} operations in one request is too many (limit ${MAX_OPERATIONS})`;
  const bad = ops.find((op) => !op || typeof op !== "object" || !OPERATION_KINDS.includes(op.kind));
  if (bad) return `operation kind "${bad?.kind}" is not supported (only ${OPERATION_KINDS.join(", ")})`;
  return null;
}

/**
 * Sums up a prepared batch for the prompt: per-operation fee, gas and storage, the reveal if
 * one is needed, and the totals. `contents` are the prepared operation contents (with the
 * reveal Taquito prepends when the key is unrevealed); `estimates` one per dApp operation.
 */
export function summarize(ops, contents, estimates) {
  const hasReveal = contents[0]?.kind === "reveal";
  const body = hasReveal ? contents.slice(1) : contents;
  if (body.length !== ops.length || estimates.length !== ops.length) throw new Error(`prepared ${body.length} operations for ${ops.length} requested`);
  let amount = 0n, fee = 0n, burn = 0n;
  const lines = [];
  if (hasReveal) {
    fee += BigInt(contents[0].fee);
    lines.push(`reveal of the public key (needed first): fee ${formatTez(contents[0].fee)}`);
  }
  ops.forEach((op, i) => {
    const c = body[i], e = estimates[i];
    const opBurn = BigInt(mutezString(e.burnFeeMutez));
    fee += BigInt(c.fee);
    burn += opBurn;
    if (op.kind === "transaction") amount += BigInt(mutezString(op.amount));
    if (op.kind === "origination") amount += BigInt(mutezString(op.balance));
    const desc = describeOperation(op);
    lines.push(`${i + 1}. ${desc[0]}`);
    for (const extra of desc.slice(1)) lines.push(`   ${extra}`);
    lines.push(`   fee ${formatTez(c.fee)}, gas ${c.gas_limit}, storage ${c.storage_limit}${opBurn > 0n ? `, burn ${formatTez(opBurn)}` : ""}`);
    const requested = op.fee != null ? BigInt(mutezString(op.fee)) : null;
    if (requested != null && requested > BigInt(c.fee)) lines.push(`   (the dApp asked for a fee of ${formatTez(requested)}; the node's estimate is used instead)`);
  });
  lines.push(`total: ${formatTez(amount)} sent, ${formatTez(fee)} fees, ${formatTez(burn)} storage burn = ${formatTez(amount + fee + burn)} debited`);
  return { lines, totalDebitMutez: String(amount + fee + burn) };
}

/**
 * Simulates and prepares the dApp's operations from `account` (no key involved).
 * Returns the exact operation to sign plus a textual summary.
 */
export async function prepareBatch(rpcUrl, account, ops) {
  const problem = validateOperations(ops);
  if (problem) throw new Error(problem);
  const tk = new TezosToolkit(rpcUrl);
  tk.setSignerProvider(readOnlySigner(account));
  const params = ops.map(toTaquitoParams);
  const estimates = await tk.estimate.batch(params);
  const perOp = estimates.length === params.length + 1 ? estimates.slice(1) : estimates;
  if (perOp.length !== params.length) throw new Error(`the node returned ${estimates.length} estimates for ${params.length} operations`);
  const withLimits = params.map((p, i) => ({ ...p, fee: perOp[i].suggestedFeeMutez, gasLimit: perOp[i].gasLimit, storageLimit: perOp[i].storageLimit }));
  // Taquito may splice a reveal estimate into the array it is given, so hand it a copy.
  const { opOb } = await tk.prepare.batch(withLimits, [...perOp]);
  if (opOb.contents.some((c) => c.source !== account.address)) throw new Error("the prepared operation is not from the signing account");
  // Local forging must succeed before the user is asked to approve.
  const forged = await localForger.forge({ branch: opOb.branch, contents: opOb.contents });
  return { opOb, forged, summary: summarize(ops, opOb.contents, perOp) };
}

/** Signs the prepared operation through `signer`, preapplies it and injects it. Returns the hash. */
export async function signAndInject(rpcUrl, signer, prepared) {
  const { opOb, forged } = prepared;
  const { branch, contents, protocol } = opOb;
  const check = await localForger.forge({ branch, contents });
  if (check !== forged) throw new Error("the operation changed between preparation and signing");
  const { prefixSig, sbytes } = await signer.sign(forged, new Uint8Array([3]));
  const rpc = new RpcClient(rpcUrl);
  const replies = await rpc.preapplyOperations([{ branch, contents, protocol, signature: prefixSig }]);
  const results = replies.flatMap((r) => r.contents ?? []);
  const failed = results.find((c) => c.metadata?.operation_result?.status !== "applied");
  if (results.length !== contents.length || failed) {
    const errors = failed?.metadata?.operation_result?.errors;
    throw new Error(`the node would not apply the operation: ${errors ? JSON.stringify(errors).slice(0, 600) : "no result"}`);
  }
  const hash = encodeOpHash(sbytes);
  const confirmed = await rpc.injectOperation(sbytes);
  if (confirmed !== hash) throw new Error(`the node's operation hash ${confirmed} does not match the signed bytes (${hash})`);
  return hash;
}
