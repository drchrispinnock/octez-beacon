#!/usr/bin/env node
import { main } from "../src/cli.js";

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`octez-beacon: ${error?.stack ?? error}`);
    process.exit(1);
  },
);
