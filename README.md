# octez-beacon

Octez Beacon is a command-line wallet for Beacon / Octez Connect dApps. You run it with a key
from your `octez-client` wallet, pair it with a dApp, and it then asks you at the terminal before
signing anything the dApp sends. Keys never leave `octez-client`: signing goes through
`octez-client sign bytes`, so encrypted keys, Ledger keys and remote signers all work as they do
there.

This is based on discussion with Rich Ayotte at TezDev 2023.

## Requirements

- Node.js 20 or newer
- `octez-client` on your `PATH` (or named in `OCTEZ_CLIENT`), with a key you can sign with
- a Tezos node you can reach over RPC

## Install

```
npm install
npm link        # optional: puts `octez-beacon` on your PATH
```

## Usage

```
octez-beacon [-E RPC node] key
```

`key` is an alias in your `.tezos-client` wallet for which you have the secret key and funds. If
you do not supply a node, it connects to `http://localhost:8732` and fails if it cannot.

Then it asks for the dApp pairing code. In the dApp, sign in / connect / sync, choose "pair
wallet on another device" or "show QR code", and copy the code (the `tezos://?type=tzip10&data=…`
link form is accepted too). Paste it in. `octez-beacon` stays running and asks you which
operations you want to sign:

- **Permission requests** show the dApp, the network and the scopes it asks for. The network
  must match the chain your node serves; mainnet, ghostnet and shadownet are recognised by chain
  id, anything else is shown to you to judge.
- **Operation requests** are simulated on the node first. You see each operation (plain
  transfers, FA1.2/FA2 token transfers, operator changes and allowances are spelled out; other
  contract calls are flagged and shown raw), the fee, gas, storage and burn the node estimates,
  and the total that will leave the account. The dApp's own fee is ignored. On approval the
  operation is forged locally, signed by `octez-client`, preapplied and injected.
- **Sign payload requests** are only honoured for packed Michelson data (a `05` prefix and one
  complete expression), which rules out anything that could be injected as an operation. Signed
  messages of the "Tezos Signed Message" kind are shown as text.

Everything else is refused with the matching Beacon error. Answer `y` to approve; `n`, Enter or
Ctrl-D decline.

While idle you can type `pair` to connect another dApp, `peers` and `permissions` to list what is
connected, `forget` to drop every pairing, and `quit`.

### Options

```
-E, --endpoint <uri>           RPC node (default http://localhost:8732)
-d, --base-dir <dir>           octez-client data directory (default: octez-client's own)
-f, --password-filename <file> password file for encrypted keys, passed to octez-client
    --data-dir <dir>           where pairings are kept (default ~/.octez-beacon)
    --debug                    verbose Beacon SDK logging
```

Pairings, granted permissions and the Beacon key pair are kept in `~/.octez-beacon/storage.json`
(mode 0600), so a paired dApp keeps working across restarts.

## Development

```
npm test                              # unit tests (node:test)
node --test test/payload.test.js      # one file
```

## Limitations

- Only `transaction`, `delegation` and `origination` operations are accepted from dApps.
- Revealing a tz4 (BLS) key through a dApp request is not supported.
- Tezos Sapling, encryption and broadcast requests are refused.
