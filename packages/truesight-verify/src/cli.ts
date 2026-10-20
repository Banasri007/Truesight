#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyBundle, verifyLedger, asEs256PublicJwk, type LedgerEntry } from "./index.js";

const USAGE = `Usage:
  truesight-verify <bundle.json> [--json]
  truesight-verify --ledger <ledger.jsonl> --key <public-jwk.json> [--json]`;

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");

  if (args[0] === "--ledger") {
    const ledgerPath = args[1];
    const keyIndex = args.indexOf("--key");
    const keyPath = keyIndex >= 0 ? args[keyIndex + 1] : undefined;
    if (!ledgerPath || !keyPath) {
      console.error(USAGE);
      return 2;
    }
    const entries = (await readFile(ledgerPath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LedgerEntry);
    const jwk = asEs256PublicJwk(JSON.parse(await readFile(keyPath, "utf8")));
    const report = await verifyLedger(entries, jwk, { requireGenesis: true });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.ok ? "✔" : "✘"} ledger ${report.entries} entries (#${report.firstSeq}..#${report.lastSeq}), key ${report.kid}`);
      for (const problem of report.problems) console.log(`  ✘ ${problem}`);
    }
    return report.ok ? 0 : 1;
  }

  const bundlePath = args[0];
  if (!bundlePath) {
    console.error(USAGE);
    return 2;
  }
  const report = await verifyBundle(JSON.parse(await readFile(bundlePath, "utf8")));
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      console.log(`${check.ok ? "✔" : "✘"} ${check.label}${check.detail ? `  (${check.detail})` : ""}`);
    }
    console.log(report.ok ? "\nVERIFIED: bundle is authentic and unmodified." : "\nNOT VERIFIED: see failed checks above.");
  }
  return report.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
