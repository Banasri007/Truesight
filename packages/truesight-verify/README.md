# truesight-verify

Verify tamper-evident, privacy-redacted evidence bundles and hash-chained ledgers produced by [TrueSight](../../README.md). It has no server dependency and runs in **Node 20+ and modern browsers** (WebCrypto plus a pure-JS PNG decoder).

## Why it exists

Camera footage is easy to dispute now that video and images can be generated. Redacting faces normally makes it worse: once pixels are edited, how do you know nothing else changed?

TrueSight signs three things into an append-only ledger:

1. the SHA-256 of the **original** frame, at capture time;
2. the redaction as an **edit**: the regions, the hash of the redacted PNG, and a digest of **every pixel outside the regions**;
3. the sensor state change that triggered the capture, so the evidence is tied to *why* it was captured.

`truesight-verify` recomputes all of it from the bundle alone. Someone holding only the redacted image can check that it is authentic and that the redaction was the only change, without ever seeing the original.

## CLI

```bash
npx truesight-verify truesight-ev_123.json
npx truesight-verify --ledger ledger.jsonl --key public-jwk.json
```

Exit code 0 means verified and 1 means a check failed.

## Library

```ts
import { verifyBundle, verifyLedger } from "truesight-verify";

const report = await verifyBundle(JSON.parse(text));
if (!report.ok) console.table(report.checks.filter((c) => !c.ok));
```

## Format

**Canonical JSON:** keys are sorted, there is no whitespace, `undefined` is dropped, and non-finite numbers are rejected (RFC 8785-compatible for ASCII keys).

**Ledger entry**

```text
body = { v: 1, seq, ts, type, data, prev, kid }
hash = hex(SHA-256(canonical(body)))
sig  = base64url(ES256(canonical(body)))      // IEEE P1363 r||s, as in JOSE / WebCrypto
prev = hash of entry seq-1 (genesis: 64 zeros)
kid  = "<provider>:" + RFC 7638 JWK thumbprint
```

**Preserved-pixels digest**

```text
SHA-256( "truesight.pixels/1:" + W + "x" + H + ":" || RGBA8 pixels with every redacted rectangle set to 0,0,0,0 )
```

**Bundle** (`truesight.bundle/1`): signer JWK, subject, the redacted PNG (base64), a ledger excerpt, the ledger head, and an ES256 signature over the canonical bundle minus `signature`.

## Checks performed

| id | Check |
|---|---|
| `format` | Recognized bundle format |
| `signer` | Key id matches the public key's thumbprint |
| `bundle-signature` | Signature covers the whole file |
| `ledger` | Every entry's hash and signature is valid; consecutive entries are chained |
| `ledger-head` | Head is consistent with the excerpt |
| `capture-recorded` / `redaction-recorded` | Both events are signed in the ledger |
| `capture-before-redaction` | Order is correct and both refer to the same original |
| `trigger-link` | The evidence frame is the frame that caused the state change |
| `asset-hash` | The redacted PNG matches the signed hash |
| `preserved-pixels` | Every pixel outside the declared regions is identical to the original |

## Limits

Verification proves integrity and origin relative to the signing key. Trust in the key itself comes from out-of-band publication (for example, the server's `/api/public/signer` endpoint, or a KMS key you control). It does not prove that the camera scene itself was real.

## License

MIT
