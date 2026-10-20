# TrueSight

**Sensors you teach. Evidence you can trust. Privacy you can see.**

TrueSight turns any Ring camera into any sensor. You draw a box on a camera frame and ask a question in plain words, like *"Is the side gate latched?"* Claude answers it on every motion event and on a schedule. When the answer turns into an alert state, TrueSight captures **tamper-evident, privacy-redacted evidence** that anyone can verify, without ever seeing the unredacted original.

Built for the Amazon Developer Hackathon 2026, **Ring track** (with the AWS Builder and Open Source mini challenges).

| Pillar | What it does |
|---|---|
| **Teach** | Draw a region, write a question, choose the answers (`latched` / `open`) and which ones are alerts. Answers are debounced, and Ring contact sensors can corroborate them. Alerts can play a sound on a Ring Chime. |
| **Proof** | Every Ring webhook, sensor definition, state change, capture, redaction, export and view of an original goes into an append-only, hash-chained, ES256-signed ledger (local key or **AWS KMS**). Incidents export as a self-contained signed bundle. |
| **Privacy** | The AI only ever sees the box you drew. Privacy zones and faces (**Amazon Rekognition**, locations only, no recognition) are pixelated first. Frames are discarded after each check unless they become evidence, and each check produces a *privacy receipt*. |

How the three fit together: a redacted image normally can't be trusted as evidence. TrueSight signs a digest of **every pixel outside the redacted regions** at capture time, so a verifier holding only the redacted PNG can prove nothing else was changed.

---

## Quick start (no Ring account, no API keys)

Requirements: Node.js 20.11 or newer (22 recommended).

```bash
npm install
npm run dev
```

Open **http://localhost:5173** for the landing page: an interactive WebGL device and a scroll-driven walkthrough of Teach → Privacy → Proof → Verify. Every demo on it does real work in your browser, including a bundle signed and verified on the spot. Click **Open console** (or go to `/#/sensors`) for the app itself.

The console starts with a simulated Ring account (three cameras, a chime and a gate contact sensor) and an offline "mock" perception provider, so the full pipeline runs immediately.

1. **Teach a sensor** → pick *Side Yard* → drag a box around the gate → click the **Gate latched?** template → choose *Hallway Chime* / *TrueSight alert* → tick *Side Gate Contact Sensor* → **Test** → **Create**.
2. **Simulator** → set Gate to **open**. The simulator sends HMAC-signed `contact_sensor_faulted` and `motion_detected` webhooks, TrueSight confirms the change twice, the chime "speaks", and evidence is captured.
3. **Evidence** → **Verify now** (11/11 checks) or **Export bundle**.
4. **Verify a bundle** → drop the exported JSON. Try **Tamper demo**.
5. **Ledger** → **Verify entire ledger**. **Privacy** → see the receipts, draw privacy zones.

## Use real AI (Claude)

Copy `.env.example` to `.env`, then choose one:

```bash
# Claude API
VISION_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# or Claude in Amazon Bedrock (inference stays in your AWS account/region)
VISION_PROVIDER=bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-opus-5-5
```

The model returns structured JSON constrained to your labels plus `unknown`. Output guardrails (from Ring's computer-vision guidelines) then block descriptions of gender, age, race or intent before anything reaches the UI. To try real face pixelation, set `FACE_DETECTOR=rekognition` and upload a photo on the Simulator page.

## Use a real Ring account

1. Create an app in the [Ring Developer Console](https://developer.amazon.com/ring/console/apps) and note the **Client ID**, **Client Secret** and **HMAC key** (they are shown only once).
2. Expose the server over HTTPS, for example `cloudflared tunnel --url http://localhost:8787`, and set `PUBLIC_BASE_URL` to that URL.
3. In the console, configure:
   - **Webhook URL**: `${PUBLIC_BASE_URL}/webhooks/ring`
   - **Account Link URL** (one-way linking): `${PUBLIC_BASE_URL}/auth/ring/link`
   - **Token Exchange URL**: `${PUBLIC_BASE_URL}/auth/ring/token-exchange`
   - **Redirect URI** (partner-initiated OAuth + PKCE): `${PUBLIC_BASE_URL}/auth/ring/callback`
4. Set `RING_MODE=api`, `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_HMAC_KEY` and an `ADMIN_TOKEN`. Run `npm run build && npm start` and open `PUBLIC_BASE_URL`.
5. Add your Ring account as a staging user (Developer Console → Test) and link it.

### Ring APIs used

| Ring capability | Endpoint | Code |
|---|---|---|
| Webhooks (HMAC `X-Signature: sha256=…`, dedupe on `meta.request_id`, 200 within 5s) | `POST /webhooks/ring` | [ring/webhook.ts](apps/server/src/ring/webhook.ts), [http/ring-routes.ts](apps/server/src/http/ring-routes.ts) |
| OAuth tokens, refresh rotation | `POST oauth.ring.com/oauth/token` | [ring/oauth.ts](apps/server/src/ring/oauth.ts) |
| One-way linking (nonce = HMAC(`time:account_id`)) | `GET /v1/users/me`, `POST`/`PATCH /v1/accounts/me/app-integrations` | [ring/oauth.ts](apps/server/src/ring/oauth.ts) |
| Partner-initiated linking (PKCE S256), unlink | `account.ring.com/.../authorize`, `DELETE /v1/accounts/me/app-integrations` | [ring/oauth.ts](apps/server/src/ring/oauth.ts) |
| Device discovery, status, capabilities | `GET /v1/devices?include=status,capabilities` | [ring/api-client.ts](apps/server/src/ring/api-client.ts) |
| Image snapshots (303 → pre-signed URL) | `POST /v1/devices/{id}/media/image/download` | [ring/api-client.ts](apps/server/src/ring/api-client.ts) |
| Media clips attached to evidence (416/425 retry) | `POST /v1/devices/{id}/media/video/download` | [ring/api-client.ts](apps/server/src/ring/api-client.ts) |
| Event history | `GET /v1/history/devices/{id}/events` | [ring/api-client.ts](apps/server/src/ring/api-client.ts) |
| Chime slots, snooze-aware playback | `GET …/configurations`, `GET …/status`, `POST …/media/audio/playback` | [ring/api-client.ts](apps/server/src/ring/api-client.ts) |
| Sensor events as corroboration | `contact_sensor_faulted`, `flood_detected`, … webhooks | [sensors/engine.ts](apps/server/src/sensors/engine.ts) |

## AWS services (AWS Builder mini challenge)

| Service | Used for | Switch |
|---|---|---|
| **Amazon Bedrock** (Claude) | Perception: answers each sensor question from the cropped region | `VISION_PROVIDER=bedrock` |
| **AWS KMS** | ES256 signing of ledger entries and bundles; the private key never leaves KMS | `SIGNER=kms` |
| **Amazon DynamoDB** | Append-only ledger (conditional put on `seq`) | `LEDGER_STORE=dynamodb` |
| **Amazon S3 + Object Lock** | WORM storage for originals, redacted copies and clips | `BLOB_STORE=s3` |
| **Amazon Rekognition** | `DetectFaces` bounding boxes for pixelation (never identification) | `FACE_DETECTOR=rekognition` |
| **Amazon SNS** | Alert SMS / email | `SNS_TOPIC_ARN=…` |

Setup commands and the IAM policy are in [docs/AWS_SETUP.md](docs/AWS_SETUP.md).

## Verifying evidence (anyone, offline)

The verifier is a separate MIT-licensed package, [`truesight-verify`](packages/truesight-verify), that runs in the browser (WebCrypto) and in Node:

```bash
npm run build:verify
node packages/truesight-verify/dist/cli.js truesight-ev_xxx.json
```

A bundle passes only if all of these hold:

1. The signer's key id matches its public key (RFC 7638 thumbprint).
2. The bundle signature covers every byte of the file.
3. Every ledger entry's hash and ES256 signature is valid, and consecutive entries are chained.
4. The original frame's hash was signed **before** the redaction entry, and the redaction refers to the same original.
5. The evidence frame is the exact frame that triggered the state change.
6. The redacted PNG matches its signed hash.
7. Recomputing the digest of every pixel outside the declared regions reproduces the signed `preservedPixelsDigest`.

## Architecture

```
Ring (or simulator) ──signed webhook──▶ /webhooks/ring ──▶ ledger: ring.event
        ▲                                     │
        │ snapshot / clip / chime              ▼
        └──────────────── SensorEngine ── preparePerception: privacy zones → crop → faces → AI view
                               │                    │
                               │                    └─▶ Claude (API or Bedrock) → guardrails → {state, confidence}
                               ▼
                     debounce → ledger: sensor.state_changed
                               │ alert state?
                               ▼
              EvidenceService: hash original → ledger: evidence.captured
                               mosaic faces/zones, preserved-pixel digest → ledger: evidence.redacted
                               store in S3 (Object Lock) / disk
                               │
                               ▼
              Notifier (dashboard SSE, SNS) + Ring Chime playback
```

```
apps/server            Express API, Ring client and simulator, engine, privacy, proof
apps/web               Landing page (Three.js / React Three Fiber, GSAP ScrollTrigger, Framer Motion)
                       + console (React, Tailwind CSS, Recharts, Lucide), built with Vite
packages/truesight-verify  Open-source verifier library + CLI (MIT)
docs/                  AWS setup, submission notes
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server on :8787 (watch mode) + dashboard on :5173 |
| `npm test` | Verifier tests + server unit and end-to-end tests |
| `npm run typecheck` | Type-check every package |
| `npm run build` | Build everything; `npm start` then serves the dashboard and API on `PORT` |

## Privacy and responsible AI

- **Data minimization:** the AI receives only the owner's region, after privacy zones and faces are pixelated. It never receives the full frame.
- **No identification:** Rekognition is used only for face *locations*. There is no face search, no collections, and no person descriptions.
- **Guardrails:** model output is validated against the allowed labels. Sensitive terms are blocked and replaced with a generic message. `unknown` is always a valid answer.
- **Retention:** non-evidence frames are discarded after each check. Evidence originals are purged after `EVIDENCE_RETENTION_DAYS`, and each purge is recorded.
- **Accountability:** every view of an unredacted original and every export is written to the signed ledger.
- **Wording:** bundles are *tamper-evident*. Whether they are legally admissible depends on the jurisdiction.

## License

[MIT](LICENSE)
