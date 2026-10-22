# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`octez-beacon` is a Node.js (ESM, no build step, no TypeScript) command-line wallet for
Beacon / Octez Connect dApps. It pairs with a dApp over the Beacon relay, shows each request at
the terminal, and signs only after the user says yes. Signing is delegated to `octez-client sign
bytes`, so secret keys never enter this process. Usage: `octez-beacon [-E node] <key alias>`.

## Commands

```
npm install
npm test                                  # all unit tests (node:test, no network needed)
node --test test/payload.test.js          # one test file
node bin/octez-beacon.js --help
node bin/octez-beacon.js -E https://rpc.shadownet.teztnets.com -d <octez-client dir> --data-dir <tmp> <alias>
```

For a live start-up check without a dApp, make a throwaway key with
`octez-client -d <tmpdir> gen keys test` and run against a public Shadownet node; an empty line
at the pairing prompt skips pairing, `quit` exits. Public RPC nodes that answered at the time of
writing: `https://rpc.shadownet.teztnets.com`, `https://rpc.tzkt.io/mainnet`.

## Architecture

The flow in `src/cli.js` (`main`): check the node (`RpcClient.getChainId`) → resolve the alias
with `octez-client show address` and confirm "sk known" via `list known addresses` → start the
`Wallet` → ask for a pairing code → serve requests one at a time from a queue → idle commands.

- `src/sdk.js` is the only place the Octez Connect SDK (`@tezos-x/octez.connect-*`, the Beacon
  fork) is imported. It must be loaded via `createRequire` (the SDK's ESM build has
  extension-less imports Node cannot resolve) and it installs an in-memory `localStorage` shim
  first, because the SDK touches `localStorage` even when given its own storage and a
  ReferenceError there silently drops incoming messages. Import SDK symbols from here only.
- `src/wallet.js` wraps `WalletClient`. `vetRequest` is the security boundary for incoming
  messages: the sender id is derived from the peer whose key decrypted the message, never read
  from the message; operation and sign requests need a stored permission for that sender, this
  account and the scope; the source address must be our account.
- `src/octez-client.js` spawns `octez-client` with `-E` (and `-d`, `-f` when given). Commands that
  may prompt (signing) run "interactive": stdin is inherited and stdout echoed as it arrives,
  because octez-client prints password prompts to stdout. `Terminal.suspend/resume` in cli.js
  hands the TTY over for the duration.
- `src/signer.js` is a Taquito `Signer` whose `sign(bytes, watermark)` prepends the watermark
  itself: `octez-client sign bytes` signs exactly the bytes given (no watermark), unlike
  Taquito's in-memory signer.
- `src/operations.js` follows the Signet pattern: estimate with a read-only signer
  (`tk.estimate.batch`), prepare with the node's fee/gas/storage (the dApp's fee is ignored),
  forge locally, show the summary, then `signAndInject` re-forges and checks the bytes are
  unchanged, signs, preapplies and injects. Pass Taquito `prepare.batch` a copy of the estimates
  array: it mutates the one it is given.
- `src/payload.js` + `src/micheline.js`: sign_payload requests are only honoured for `05`-prefixed
  payloads that parse as exactly one Micheline expression (strict binary reader ported from
  Signet). This is deliberate: anything else could be an injectable operation.
- `src/network.js` compares the dApp's named network with the node's chain id using the SDK's
  `TEZOS_NETWORK_GENESIS_IDS`; unknown types (custom, rotating testnets) are shown to the user
  rather than refused.
- `src/storage.js`: SDK storage as one JSON file (`~/.octez-beacon/storage.json`, 0600). Never
  call `client.destroy()`; it wipes the seed, peers and permissions.

Reference implementations worth reading when changing dApp handling: `../signet`
(`TaquitoBridge/src/octezconnect.js`, a GUI wallet using the same SDK) and the SDK type
definitions under `node_modules/@tezos-x/octez.connect-types/dist/esm/types`.
