# Devpost submission notes

These are drafts. Edit them in your own words, and replace every *[bracketed]* part with what actually happened when you tested with real Ring, Claude and AWS.

## Track and mini challenges

- **Primary track:** Ring
- **Mini challenges:** AWS Builder (Bedrock, KMS, DynamoDB, S3 Object Lock, Rekognition, SNS) · Open Source (`truesight-verify`)

## Project description (draft)

> **TrueSight turns any Ring camera into any sensor, and makes what it sees trustworthy and private.**
>
> Draw a box on a camera frame and ask a question in plain words: "Is the side gate latched?", "Are the bins at the curb?", "Is the garage door open?". On every Ring motion event, doorbell press, linked contact-sensor event, or on a schedule, TrueSight fetches a snapshot through the Ring API. It pixelates privacy zones and faces and sends **only the region you drew** to Claude (Claude API or Amazon Bedrock), with structured output limited to your answers. Answers are debounced, and every state change is signed into an append-only, hash-chained ledger (AWS KMS).
>
> When a sensor enters an alert state, TrueSight hashes and signs the original frame before anything touches it. It then redacts faces and privacy zones and signs the redaction as an edit, including a digest of every untouched pixel. A Ring Chime plays an alert and the owner gets a notification. The incident exports as a single signed bundle that anyone can verify in a browser, proving the image is authentic and that the redaction was the only change, without seeing the original.
>
> **Why it matters for Ring:** one camera can replace several single-purpose sensors, which gives people a reason to add cameras. Verified evidence opens insurer partnerships. Visible privacy removes the most common objection to buying a camera.

## How it works

See the [README](../README.md#architecture). Key files: [sensors/engine.ts](../apps/server/src/sensors/engine.ts), [privacy/perception.ts](../apps/server/src/privacy/perception.ts), [proof/evidence.ts](../apps/server/src/proof/evidence.ts), [packages/truesight-verify](../packages/truesight-verify).

## AWS Builder: integrations

| Service | How it is used | Code |
|---|---|---|
| Amazon Bedrock | Claude answers each sensor question from the cropped AI view (Mantle Messages API, structured JSON output) | `apps/server/src/vision/claude.ts` |
| AWS KMS | `ECC_NIST_P256` key signs every ledger entry and bundle (DER → P1363) | `apps/server/src/proof/signer.ts` |
| Amazon DynamoDB | Append-only ledger with a conditional put on `seq` | `apps/server/src/proof/ledger.ts` |
| Amazon S3 Object Lock | WORM retention for evidence originals and clips | `apps/server/src/storage/blobs.ts` |
| Amazon Rekognition | `DetectFaces` boxes for pixelation only | `apps/server/src/privacy/faces.ts` |
| Amazon SNS | Alert SMS / email | `apps/server/src/notify/notifier.ts` |

## Open Source mini challenge

- **Contribution:** `truesight-verify`, a separate MIT-licensed library and CLI in `packages/truesight-verify`. You can also publish it as its own repository or npm package.
- **What it does:** offline verification of hash-chained ES256 ledgers and redacted evidence bundles, in browsers and Node.
- **Why it matters:** anyone (an insurer, a neighbor, a court clerk) can verify Ring-derived evidence without trusting or contacting the app that produced it.
- **Fields to fill:** contribution URL *[...]*, repo URL *[...]*, GitHub username *[...]*.

## Product feedback (outline; fill in with your own experience)

- **Ring Partner API.** Used: webhooks, OAuth / account linking, device discovery, snapshots, clips, event history, chime playback, sensor events. Worked well: *[...]*. Needs work: *[...]*. Onboarding: *[...]*. Would build again: *[...]*.
- **Amazon Bedrock / Claude.** *[...]*
- **AWS KMS, DynamoDB, S3, Rekognition, SNS.** *[...]*

## Friction log (doc issues found while building; verify against your own testing)

| # | Task | Expected | What happened | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|
| 1 | Pick the OAuth scope | One documented scope value | The authorize step lists `ava.v1:read` as the only supported scope, but the examples use `scope=ava` | Medium | Made the scope configurable (`RING_SCOPE`) | Use one value everywhere, and return a descriptive `invalid_scope` |
| 2 | Find the sandbox / staging API host | A separate base URL for staging | The docs mention staging and production environments, but every example uses `https://api.amazonvision.com` | Medium | Built a local simulator that emits Ring-format signed webhooks | Document how staging differs (host, test devices, synthetic events) |
| 3 | Tell cameras, chimes and sensors apart | A `kind` / `type` field on devices | `GET /v1/devices` has no type field; chimes are inferred from `audio.customizable_slots` | Low | Heuristics on capabilities and status, plus a manual override | Add `attributes.device_kind` |
| 4 | Implement the Token Exchange URL | The request Ring sends (method, body fields) | The contract is described only in prose | Medium | Accept `code` from JSON, form or query | Publish a request/response example |
| 5 | Name PM2.5 consistently | The same field everywhere | Status uses `pm2_5`, webhooks use `pm25_level` | Low | Handled both | Align names, or document both side by side |
| 6 | Read the API reference | A navigable reference page | One very large page (~370K characters) is hard to search and to give AI tools | Low | Read it in sections | Split it per resource, or ship an OpenAPI spec |

## Demo video outline (under 3 minutes)

1. **0:00–0:20 Hook:** "Your camera sees everything, proves nothing, and records your neighbors."
2. **0:20–1:00 Teach:** draw a box around the gate, use the template, test it (show *what the AI saw*: 13% of the frame), create.
3. **1:00–1:30 Alert:** open the gate (Ring webhook) → the chime speaks → toast → evidence card.
4. **1:30–2:00 Privacy:** privacy receipt, privacy zone over the neighbor's yard, face pixelation on an uploaded photo.
5. **2:00–2:40 Proof:** export the bundle → public verifier: 11/11 ✔ → tamper demo ✘ → "Verify entire ledger".
6. **2:40–3:00 Why it sells Ring:** more cameras per home, a Verified subscription tier, insurer discounts, privacy as a feature.
