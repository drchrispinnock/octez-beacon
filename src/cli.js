// The command line: `octez-beacon [-E node] key`. Checks the node and the key, starts the
// Beacon client, pairs with a dApp and then answers requests one at a time at the prompt.

import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { join } from "node:path";
import { RpcClient } from "@taquito/rpc";
import { OctezClient, OctezClientError } from "./octez-client.js";
import { OctezClientSigner } from "./signer.js";
import { FileStorage, defaultDataDir } from "./storage.js";
import { Wallet } from "./wallet.js";
import { checkNetwork, networkTypeForChain } from "./network.js";
import { prepareBatch, signAndInject } from "./operations.js";
import { signPayloadRefusal, describePayload } from "./payload.js";
import { describeApp, clip } from "./describe.js";

const { version } = createRequire(import.meta.url)("../package.json");

export const DEFAULT_ENDPOINT = "http://localhost:8732";

export const USAGE = `usage: octez-beacon [options] <key>

  <key>                 alias of a key in your octez-client wallet (secret key required)

options:
  -E, --endpoint <uri>  RPC node (default ${DEFAULT_ENDPOINT}); fails if unreachable
  -d, --base-dir <dir>  octez-client data directory (default: octez-client's own)
  -f, --password-filename <file>
                        password file for encrypted keys, passed to octez-client
      --data-dir <dir>  where pairings are kept (default ~/.octez-beacon)
      --debug           verbose Beacon SDK logging
  -h, --help            this text
  -V, --version         print the version`;

export function parseArgs(argv) {
  const opts = { endpoint: DEFAULT_ENDPOINT, baseDir: null, passwordFile: null, dataDir: defaultDataDir(), debug: false, key: null, help: false, version: false };
  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-E" || a === "--endpoint") opts.endpoint = takeValue(i++, a);
    else if (a === "-d" || a === "--base-dir") opts.baseDir = takeValue(i++, a);
    else if (a === "-f" || a === "--password-filename") opts.passwordFile = takeValue(i++, a);
    else if (a === "--data-dir") opts.dataDir = takeValue(i++, a);
    else if (a === "--debug") opts.debug = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a.startsWith("-") && a !== "-") throw new Error(`unknown option ${a}`);
    else if (opts.key === null) opts.key = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!opts.help && !opts.version && !opts.key) throw new Error("a key alias is required");
  return opts;
}

/** Terminal input: one question at a time, with idle lines going to `onIdleLine`. */
class Terminal {
  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    this.onIdleLine = null;
    this.closed = false;
    this.rl.on("line", (line) => { if (this.onIdleLine) this.onIdleLine(line); });
    this.rl.on("close", () => { this.closed = true; if (this.onClose) this.onClose(); });
  }
  /** Asks and resolves with the answer, or "" once input has ended (Ctrl-D, closed pipe). */
  question(text) {
    if (this.closed) return Promise.resolve("");
    return new Promise((resolve) => this.rl.question(text, resolve));
  }
  /** Yes only on an explicit yes; "no", an empty line or the end of input all mean no. */
  async confirm(text) {
    for (;;) {
      const answer = (await this.question(`${text} [y/N] `)).trim().toLowerCase();
      if (answer === "y" || answer === "yes") return true;
      if (answer === "" || answer === "n" || answer === "no" || this.closed) return false;
    }
  }
  /** Hands the terminal to a child process (octez-client asking for a password). */
  suspend() {
    this.rl.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
  resume() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this.rl.resume();
  }
  write(text) { process.stdout.write(text); }
  close() { this.rl.close(); }
}

const IDLE_HELP = `commands: pair (connect another dApp), peers, permissions, forget (drop all pairings), quit`;

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`octez-beacon: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.version) { console.log(version); return 0; }

  // 1. The node.
  const rpc = new RpcClient(opts.endpoint);
  let chainId;
  try {
    chainId = await rpc.getChainId();
  } catch (error) {
    console.error(`octez-beacon: cannot reach the Tezos node at ${opts.endpoint}: ${error?.message ?? error}`);
    console.error("Start a node there or name one with -E.");
    return 1;
  }
  const networkType = networkTypeForChain(chainId);
  console.log(`Node ${opts.endpoint} serves chain ${chainId}${networkType ? ` (${networkType})` : ""}.`);

  // 2. The key.
  const terminal = new Terminal();
  const octez = new OctezClient({ endpoint: opts.endpoint, baseDir: opts.baseDir, passwordFile: opts.passwordFile, beforeInteractive: () => terminal.suspend(), afterInteractive: () => terminal.resume() });
  let account;
  try {
    const { address, publicKey } = await octez.showAddress(opts.key);
    const known = (await octez.knownAddresses()).find((k) => k.alias === opts.key);
    if (!known?.secretKeyKnown) throw new OctezClientError(`octez-client has no secret key for "${opts.key}" (${address}); only keys you can sign with can be used`);
    if (!publicKey) throw new OctezClientError(`octez-client knows no public key for "${opts.key}"`);
    account = { alias: opts.key, address, publicKey, scheme: known.scheme };
  } catch (error) {
    console.error(`octez-beacon: ${error.message}`);
    terminal.close();
    return 1;
  }
  console.log(`Signing as ${account.alias}: ${account.address}${account.scheme ? ` (${account.scheme} key)` : ""}.`);
  const signer = new OctezClientSigner(octez, account);

  // 3. The Beacon client.
  const storage = new FileStorage(join(opts.dataDir, "storage.json"));
  const wallet = new Wallet({ storage, debug: opts.debug, address: account.address, log: (m) => console.error(`\n${m}`) });
  const queue = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const { request, peer } = queue.shift();
        await handleRequest(request, peer);
      }
    } finally {
      busy = false;
      terminal.write("> ");
    }
  };
  try {
    await wallet.start((request, grant, peer) => { queue.push({ request, grant, peer }); return pump(); });
  } catch (error) {
    console.error(`octez-beacon: cannot connect to the Beacon relay: ${error?.message ?? error}`);
    terminal.close();
    return 1;
  }

  const existing = await wallet.peers();
  if (existing.length) console.log(`Already paired with: ${existing.map((p) => clip(p.name, 40)).join(", ")}.`);

  // 4. Pairing.
  const pair = async (prompt) => {
    const input = await terminal.question(prompt);
    if (!input.trim()) return false;
    try {
      const peer = await wallet.pair(input);
      console.log(`Paired with ${describeApp(peer)}. Waiting for its requests…`);
      return true;
    } catch (error) {
      console.error(`Pairing failed: ${error?.message ?? error}`);
      return false;
    }
  };
  console.log("In the dApp, choose to connect a wallet, pick \"pair wallet on another device\" / \"show QR code\" and copy the code.");
  await pair(existing.length ? "Paste the dApp pairing code (or press Enter to keep waiting for already paired dApps): " : "Paste the dApp pairing code: ");

  // 5. Requests, one at a time.
  async function handleRequest(request, peer) {
    const app = describeApp(request.appMetadata ?? peer);
    const answer = (message) => wallet.respond({ id: request.id, ...message }).catch((e) => console.error(`could not deliver the reply: ${e?.message ?? e}`));
    const refuse = (errorType, why) => { if (why) console.log(`Refused: ${why}`); return answer({ type: "error", errorType }); };
    console.log(`\n==== ${request.type.replace(/_/g, " ")} from ${app} ====`);
    try {
      switch (request.type) {
        case "permission_request": {
          const scopes = Array.isArray(request.scopes) ? request.scopes.map((s) => clip(String(s), 32)) : [];
          const network = request.network ?? {};
          console.log(`It asks to use ${account.address} on network "${clip(network.type, 32)}"${network.rpcUrl ? ` (RPC ${clip(network.rpcUrl, 120)})` : ""} with scopes: ${scopes.join(", ") || "(none)"}.`);
          const check = checkNetwork(network, chainId);
          if (check.ok === false) return refuse("NETWORK_NOT_SUPPORTED", check.reason);
          if (check.ok === null) console.log(`Note: ${check.note}.`);
          if (!(await terminal.confirm("Connect this dApp to your account?"))) return refuse("NOT_GRANTED_ERROR", "you declined");
          await answer({ type: "permission_response", publicKey: account.publicKey, address: account.address, network: request.network, scopes: request.scopes, walletType: "implicit" });
          console.log("Connected.");
          return;
        }
        case "operation_request": {
          const check = checkNetwork(request.network, chainId);
          if (check.ok === false) return refuse("NETWORK_NOT_SUPPORTED", check.reason);
          if (check.ok === null) console.log(`Note: ${check.note}.`);
          console.log("Simulating on the node…");
          let prepared;
          try {
            prepared = await prepareBatch(opts.endpoint, account, request.operationDetails);
          } catch (error) {
            return refuse("TRANSACTION_INVALID_ERROR", `the node rejected the operation: ${clip(error?.message ?? String(error), 600)}`);
          }
          for (const line of prepared.summary.lines) console.log(line);
          if (!(await terminal.confirm("Sign and inject this operation?"))) return refuse("ABORTED_ERROR", "you declined");
          try {
            const hash = await signAndInject(opts.endpoint, signer, prepared);
            console.log(`Injected ${hash}.`);
            await answer({ type: "operation_response", transactionHash: hash });
          } catch (error) {
            return refuse("BROADCAST_ERROR", clip(error?.message ?? String(error), 600));
          }
          return;
        }
        case "sign_payload_request": {
          const why = signPayloadRefusal(request.signingType, request.payload);
          if (why) return refuse("SIGNATURE_TYPE_NOT_SUPPORTED", why);
          const shown = describePayload(request.payload);
          if (shown.kind === "text") console.log(`It asks you to sign this message (${shown.bytes} bytes):\n  ${shown.text.split("\n").join("\n  ")}`);
          else console.log(`It asks you to sign ${shown.bytes} bytes of packed Michelson data:\n  ${shown.hex}`);
          if (!(await terminal.confirm("Sign it?"))) return refuse("ABORTED_ERROR", "you declined");
          try {
            const { prefixSig } = await signer.sign(request.payload);
            await answer({ type: "sign_payload_response", signingType: request.signingType, signature: prefixSig });
            console.log(`Signed: ${prefixSig}`);
          } catch (error) {
            return refuse("ABORTED_ERROR", clip(error?.message ?? String(error), 600));
          }
          return;
        }
        default:
          return refuse("UNKNOWN_ERROR", `${request.type} is not supported`);
      }
    } catch (error) {
      console.error(`error while handling the request: ${error?.message ?? error}`);
      await refuse("UNKNOWN_ERROR");
    }
  }

  // 6. Idle commands until quit.
  if (terminal.closed) { await wallet.stop(); terminal.close(); return 0; }
  console.log(`\nWaiting for requests. ${IDLE_HELP}.`);
  terminal.write("> ");
  return new Promise((resolve) => {
    const finish = async (code) => {
      terminal.onIdleLine = null;
      terminal.onClose = null;
      await wallet.stop();
      terminal.close();
      resolve(code);
    };
    terminal.onClose = () => finish(0);
    process.once("SIGINT", () => { console.log(); finish(0); });
    let idle = Promise.resolve();
    terminal.onIdleLine = (line) => { idle = idle.then(() => runIdleCommand(line)); };
    async function runIdleCommand(line) {
      if (busy) return;
      const cmd = line.trim().toLowerCase();
      try {
        if (cmd === "quit" || cmd === "exit") return finish(0);
        else if (cmd === "pair") await pair("Paste the dApp pairing code: ");
        else if (cmd === "peers") {
          const peers = await wallet.peers();
          console.log(peers.length ? peers.map((p) => `  ${describeApp(p)} via ${clip(p.relayServer, 60)}`).join("\n") : "  no paired dApps");
        } else if (cmd === "permissions") {
          const perms = await wallet.permissions();
          console.log(perms.length ? perms.map((p) => `  ${describeApp(p.appMetadata)}: ${p.address} on ${p.network?.type} [${(p.scopes ?? []).join(", ")}]`).join("\n") : "  no permissions granted");
        } else if (cmd === "forget") {
          if (await terminal.confirm("Drop every pairing and permission?")) { await wallet.forgetAll(); console.log("Forgotten."); }
        } else if (cmd === "help" || cmd === "?") console.log(IDLE_HELP);
        else if (cmd) console.log(`unknown command "${clip(cmd, 20)}". ${IDLE_HELP}`);
      } catch (error) {
        console.error(error?.message ?? error);
      }
      if (!busy) terminal.write("> ");
    }
  });
}
