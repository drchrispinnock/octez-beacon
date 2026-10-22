# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`octez-beacon` is a command-line tool that lets a Tezos dApp connect to a local
`octez-client` wallet over the Beacon / Octez Connect protocol. It plays the
role a browser wallet extension normally plays: it pairs with a dApp, then
stays running and prompts the user to approve or reject each signing request.

Intended usage (from the README):

```
octez-beacon [-E <RPC node>] <key>
```

- `<key>` is an alias in the user's `.tezos-client` wallet. The secret key must
  be present locally and the account must be funded.
- `-E` selects the Tezos RPC node. Without it the tool uses
  `http://localhost:8732` and must fail if that node is unreachable, rather
  than silently falling back to a public node.
- After start-up the tool asks for the dApp pairing code (the text behind the
  dApp's "Show more" / QR-code pairing dialog), pairs, then loops asking the
  user which incoming operations to sign.

The design came out of a discussion with Rich Ayotte at TezDev 2023.

## Repository state

The repository currently contains only `README.md` and `LICENSE.md` (MIT); the
implementation has not been added yet and there are no commits on `main`.
Language, build system, and test runner are not yet chosen. Once they are,
add to this file:

- the build command and how to run the resulting binary locally
- the lint/format command
- how to run the full test suite and a single test

Until then, do not assume a toolchain; check the working tree first.

## Design constraints to preserve

- The signing key is the one named in the user's `.tezos-client` wallet; the
  tool should not introduce its own key storage.
- Every operation the dApp sends must be shown to the user and explicitly
  approved before it is signed or injected. There is no auto-sign mode.
- The tool is interactive and long-running: it reads the pairing code from
  stdin and then keeps the Beacon session open for subsequent requests.
