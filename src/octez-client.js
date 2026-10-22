// Everything that talks to `octez-client`. The wallet (keys, passwords, Ledger) stays entirely
// inside octez-client: this tool only asks it which address an alias has and to sign bytes.

import { spawn } from "node:child_process";

export class OctezClientError extends Error {}

/** `Hash: tz…` and `Public Key: edpk…` from `octez-client show address`. */
export function parseShowAddress(text) {
  const hash = /(?:^|\s)Hash:\s*(\S+)/.exec(text)?.[1];
  const publicKey = /(?:^|\s)Public Key:\s*(\S+)/.exec(text)?.[1];
  if (!hash) throw new OctezClientError("octez-client did not report an address for that key");
  return { address: hash, publicKey: publicKey ?? null };
}

/** `name: tz… (scheme sk known)` lines from `octez-client list known addresses`. */
export function parseKnownAddresses(text) {
  const out = [];
  for (const line of text.split("\n")) {
    // Aliases may contain spaces ("NFT receiver: tz1… (encrypted sk known)").
    const m = /^(.+?):\s+(\S+)(?:\s*\(([^)]*)\))?\s*$/.exec(line.trim());
    if (!m) continue;
    const note = m[3] ?? "";
    out.push({ alias: m[1], address: m[2], secretKeyKnown: /\bsk known\b/.test(note), scheme: note.replace(/\s*sk known\s*/, "").trim() || null });
  }
  return out;
}

/**
 * `Signature: edsig…` from `octez-client sign bytes`. A password prompt ("Enter password for
 * encrypted key:") is printed on the same line without a newline, so the match is not anchored.
 */
export function parseSignature(text) {
  const sig = /(?:^|[\s:])Signature:\s*(\S+)/.exec(text)?.[1];
  if (!sig) throw new OctezClientError("octez-client did not print a signature");
  return sig;
}

export class OctezClient {
  /**
   * @param {object} options
   * @param {string} options.endpoint   RPC node URL, passed as `-E`.
   * @param {string} [options.binary]   Path to octez-client (default: $OCTEZ_CLIENT or `octez-client` on PATH).
   * @param {string} [options.baseDir]  Client data directory, passed as `-d`.
   * @param {string} [options.passwordFile] Passed as `-f`, so encrypted keys need no prompt.
   * @param {function} [options.beforeInteractive] Called before a command that may prompt on the terminal.
   * @param {function} [options.afterInteractive]  Called once it has finished.
   */
  constructor({ endpoint, binary = process.env.OCTEZ_CLIENT || "octez-client", baseDir, passwordFile, beforeInteractive, afterInteractive }) {
    this.endpoint = endpoint;
    this.binary = binary;
    this.baseDir = baseDir;
    this.passwordFile = passwordFile;
    this.beforeInteractive = beforeInteractive ?? (() => {});
    this.afterInteractive = afterInteractive ?? (() => {});
  }

  globalArgs() {
    const args = ["-E", this.endpoint];
    if (this.baseDir) args.push("-d", this.baseDir);
    if (this.passwordFile) args.push("-f", this.passwordFile);
    return args;
  }

  /**
   * Runs octez-client. With `interactive`, stdin is the terminal and stdout is echoed as it
   * arrives, so password prompts (which octez-client prints to stdout) and Ledger messages are
   * seen by the user; the output is still captured for parsing.
   */
  run(args, { interactive = false } = {}) {
    const full = [...this.globalArgs(), ...args];
    return new Promise((resolve, reject) => {
      if (interactive) this.beforeInteractive();
      let child;
      try {
        child = spawn(this.binary, full, { stdio: [interactive ? "inherit" : "ignore", "pipe", "pipe"] });
      } catch (error) {
        if (interactive) this.afterInteractive();
        return reject(error);
      }
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; if (interactive) process.stdout.write(d); });
      child.stderr.on("data", (d) => { stderr += d; if (interactive) process.stderr.write(d); });
      child.on("error", (error) => {
        if (interactive) this.afterInteractive();
        reject(error.code === "ENOENT" ? new OctezClientError(`cannot run ${this.binary}: not found. Set OCTEZ_CLIENT or add it to PATH.`) : error);
      });
      child.on("close", (code) => {
        if (interactive) this.afterInteractive();
        if (code === 0) resolve({ stdout, stderr });
        else reject(new OctezClientError(`octez-client ${args.slice(0, 2).join(" ")} failed (exit ${code})${interactive ? "" : `:\n${trimNoise(stderr)}`}`));
      });
    });
  }

  async showAddress(alias) {
    const { stdout } = await this.run(["show", "address", alias]);
    return parseShowAddress(stdout);
  }

  async knownAddresses() {
    const { stdout } = await this.run(["list", "known", "addresses"]);
    return parseKnownAddresses(stdout);
  }

  /** Signs raw bytes (hex, no 0x) with the alias's secret key. No watermark is added here. */
  async signBytes(hex, alias) {
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) throw new OctezClientError("signBytes: not hex");
    const { stdout } = await this.run(["sign", "bytes", `0x${hex}`, "for", alias], { interactive: true });
    return parseSignature(stdout);
  }
}

/** Drops octez-client's "could not reach the node" boilerplate so errors stay readable. */
function trimNoise(stderr) {
  return stderr.split("\n").filter((l) => !/^Warning:$|Failed to acquire the protocol version|Rpc request failed|- meth:|- uri:|- error:/.test(l)).join("\n").trim();
}
