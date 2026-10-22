// A Taquito signer whose private half is `octez-client sign bytes`. Taquito hands over the forged
// operation and a watermark; octez-client signs exactly the bytes it is given, so the watermark
// is prepended here. The secret key never enters this process.

import { b58DecodeAndCheckPrefix, b58Encode, PrefixV2 } from "@taquito/utils";

const SIGNATURE_PREFIXES = [PrefixV2.Ed25519Signature, PrefixV2.Secp256k1Signature, PrefixV2.P256Signature, PrefixV2.BLS12_381Signature, PrefixV2.GenericSignature];

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Splits a base58 signature into its raw bytes and its generic ("sig…") form. */
export function unpackSignature(prefixSig) {
  const [raw, prefix] = b58DecodeAndCheckPrefix(prefixSig, SIGNATURE_PREFIXES);
  // BLS signatures are 96 bytes and have no generic form; the others do.
  const sig = prefix === PrefixV2.BLS12_381Signature ? prefixSig : b58Encode(raw, PrefixV2.GenericSignature);
  return { raw, sig };
}

export class OctezClientSigner {
  /**
   * @param {import("./octez-client.js").OctezClient} client
   * @param {{alias: string, address: string, publicKey: string}} account
   */
  constructor(client, account) {
    this.client = client;
    this.alias = account.alias;
    this.address = account.address;
    this.pk = account.publicKey;
  }

  async publicKey() { return this.pk; }
  async publicKeyHash() { return this.address; }
  async secretKey() { return undefined; }

  async sign(bytes, watermark) {
    const toSign = (watermark ? toHex(watermark) : "") + bytes;
    const prefixSig = await this.client.signBytes(toSign, this.alias);
    const { raw, sig } = unpackSignature(prefixSig);
    return { bytes, sig, prefixSig, sbytes: bytes + toHex(raw) };
  }
}

/** A signer that can identify the account but never sign: enough for estimation. */
export function readOnlySigner(account) {
  return {
    publicKey: async () => account.publicKey,
    publicKeyHash: async () => account.address,
    secretKey: async () => undefined,
    sign: async () => { throw new Error("read-only signer cannot sign"); },
  };
}
