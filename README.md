
# octez-beacon

Octez Beacon is a command-line tool that can communicate with Beacon/Octez Connect sites. You run it, then you can connect dapps.

Usage:
$ octez-beacon [-E RPC node] key

where key is a key in your .tezos-client wallet for which you have the secret key and funds. If you don't supply a node, it will attempt to connect to http://localhost:8732 and fail if it can't.

Then octez-beacon will ask you for the dApp pairing code. You can usually get this from the dApp by signing in/connecting/syncing, then going to "Show more" and showing the QR code. Copy the code and paste it in. Then octez-beacon will stay active and ask you which operations you want to sign.

This is based on discussion with Rich Ayotte at Tez Dev 2023... 

