// What to do with a sign_payload request. Signing hashes the raw bytes, and so does the chain
// for operations (with a 03 watermark in front), so a payload starting with 03 would be an
// operation signature the dApp could inject. Only payloads that are packed Michelson data (05
// prefix, one complete expression) are signed, whatever label the dApp put on them.

import { isPackedMicheline, hexToBytes } from "./micheline.js";

export const MAX_PAYLOAD_HEX = 64 * 1024;

/** Why this payload must not be signed, or null when it may be shown to the user. */
export function signPayloadRefusal(signingType, payload) {
  if (signingType === "operation") return "operation payloads are not signed: that would be a transaction the dApp could inject";
  if (signingType !== "micheline" && signingType !== "raw") return `unknown signing type "${signingType}"`;
  if (typeof payload !== "string" || payload.length === 0 || payload.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(payload)) return "the payload is not valid hex";
  if (payload.length > MAX_PAYLOAD_HEX) return "the payload is too long";
  if (!payload.startsWith("05")) return "the payload is not packed Michelson data (no 05 prefix), so it could be an operation";
  if (!isPackedMicheline(payload)) return "the payload is not one complete packed Michelson expression";
  return null;
}

/**
 * A human-readable account of the payload. Packed strings (05 01 <u32 length> <utf8>), the
 * shape "Tezos Signed Message" sign-in flows use, are shown as text.
 */
export function describePayload(payload) {
  const bytes = payload.length / 2;
  if (payload.startsWith("0501") && payload.length >= 12) {
    const length = parseInt(payload.slice(4, 12), 16);
    if (length * 2 === payload.length - 12) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(hexToBytes(payload.slice(12)));
      if (!/[\p{Cc}]/u.test(text.replaceAll(/[\n\r\t]/g, ""))) return { kind: "text", text, bytes };
    }
  }
  return { kind: "hex", hex: payload, bytes };
}
