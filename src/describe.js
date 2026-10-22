// Plain-text descriptions of what a dApp is asking for, so the user can decide at the prompt.

export function formatTez(mutez) {
  const n = BigInt(String(mutez ?? 0));
  const whole = n / 1000000n, frac = n % 1000000n;
  const fracText = frac === 0n ? "" : `.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  return `${whole}${fracText} ꜩ`;
}

export const mutezString = (v) => String(BigInt(Math.round(Number(v) || 0)));

/** A Pair tree flattened into its leaves, right-comb style: Pair a (Pair b c) → [a, b, c]. */
function pairLeaves(node) {
  if (node?.prim === "Pair" && Array.isArray(node.args)) {
    const out = [];
    node.args.forEach((a, i) => { if (i === node.args.length - 1) out.push(...pairLeaves(a)); else out.push(a); });
    return out;
  }
  return [node];
}
const text = (node) => (typeof node?.string === "string" ? node.string : typeof node?.bytes === "string" ? "0x" + node.bytes : typeof node?.int === "string" ? node.int : JSON.stringify(node));
const isInt = (node) => typeof node?.int === "string";
const isAddr = (node) => typeof node?.string === "string" || typeof node?.bytes === "string";

/**
 * What a contract call does, for the standards a wallet must not hide: FA2 and FA1.2 transfers,
 * FA2 operator changes and FA1.2 allowances. Anything else is described by entrypoint only.
 */
export function contractEffects(destination, entrypoint, value) {
  const effects = [];
  try {
    if (entrypoint === "transfer" && Array.isArray(value)) {
      for (const batch of value) {
        const [from, txs] = pairLeaves(batch);
        if (!isAddr(from) || !Array.isArray(txs)) return [];
        for (const tx of txs) {
          const [to, tokenId, amount] = pairLeaves(tx);
          if (!isAddr(to) || !isInt(tokenId) || !isInt(amount)) return [];
          effects.push(`send ${text(amount)} of token ${text(tokenId)} in ${destination} from ${text(from)} to ${text(to)}`);
        }
      }
      return effects;
    }
    if (entrypoint === "transfer") {
      const [from, to, amount] = pairLeaves(value);
      if (isAddr(from) && isAddr(to) && isInt(amount)) return [`send ${text(amount)} units of the token ${destination} from ${text(from)} to ${text(to)}`];
      return [];
    }
    if (entrypoint === "update_operators" && Array.isArray(value)) {
      for (const change of value) {
        const add = change?.prim === "Left", remove = change?.prim === "Right";
        if (!add && !remove) return [];
        const [owner, operator, tokenId] = pairLeaves(change.args?.[0]);
        if (!isAddr(owner) || !isAddr(operator) || !isInt(tokenId)) return [];
        effects.push(add ? `ALLOW ${text(operator)} to move token ${text(tokenId)} in ${destination} owned by ${text(owner)}`
                         : `stop ${text(operator)} moving token ${text(tokenId)} in ${destination} owned by ${text(owner)}`);
      }
      return effects;
    }
    if (entrypoint === "approve") {
      const [spender, amount] = pairLeaves(value);
      if (isAddr(spender) && isInt(amount)) return [`ALLOW ${text(spender)} to spend ${text(amount)} units of the token ${destination}`];
      return [];
    }
  } catch {
    return [];
  }
  return [];
}

/** Lines describing one TZIP-10 partial operation. */
export function describeOperation(op) {
  const lines = [];
  switch (op.kind) {
    case "transaction": {
      const isContract = typeof op.destination === "string" && op.destination.startsWith("KT1");
      const entrypoint = op.parameters?.entrypoint ?? (isContract ? "default" : null);
      lines.push(`transaction: ${formatTez(mutezString(op.amount))} to ${op.destination}${entrypoint ? `, entrypoint ${entrypoint}` : ""}`);
      const effects = isContract && entrypoint ? contractEffects(op.destination, entrypoint, op.parameters?.value) : [];
      for (const e of effects) lines.push(`  effect: ${e}`);
      if (op.parameters) {
        if (effects.length === 0 && isContract) lines.push("  (a contract call this tool cannot interpret; check the parameters)");
        lines.push(`  parameters: ${JSON.stringify(op.parameters.value ?? op.parameters)}`);
      }
      break;
    }
    case "delegation":
      lines.push(op.delegate ? `delegation: delegate to ${op.delegate}` : "delegation: remove the delegate");
      break;
    case "origination":
      lines.push(`origination: deploy a new contract with ${formatTez(mutezString(op.balance))}`);
      lines.push(`  script: ${JSON.stringify({ code: op.script?.code, storage: op.script?.storage })}`);
      break;
    default:
      lines.push(`${op.kind}: ${JSON.stringify(op)}`);
  }
  return lines;
}

/** The dApp's own account of itself, trimmed for the terminal. */
export function describeApp(appMetadata) {
  const name = clip(appMetadata?.name) || "(unnamed dApp)";
  const url = clip(appMetadata?.appUrl, 200);
  return url ? `${name} <${url}>` : name;
}

export function clip(value, max = 80) {
  if (typeof value !== "string") return "";
  const clean = value.replaceAll(/[\p{Cc}]/gu, "");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
