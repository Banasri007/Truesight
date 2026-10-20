import { randomUUID } from "node:crypto";
import { BUNDLE_FORMAT, base64Encode, signBundle, type EvidenceBundle, type LedgerEntry } from "truesight-verify";
import type { StateStore } from "../storage/state.js";
import { APP_NAME, APP_VERSION } from "../version.js";
import type { EvidenceService } from "./evidence.js";
import type { Ledger } from "./ledger.js";
import type { Signer } from "./signer.js";

/**
 * Build a signed, self-contained incident bundle: the redacted image plus the
 * ledger entries that prove where it came from. Exporting is itself recorded.
 */
export async function exportBundle(deps: {
  evidenceId: string;
  exportedBy: string;
  ledger: Ledger;
  signer: Signer;
  state: StateStore;
  evidence: EvidenceService;
  mode: string;
}): Promise<EvidenceBundle> {
  const record = deps.evidence.find(deps.evidenceId);
  if (!record) throw new Error(`Evidence ${deps.evidenceId} not found`);
  const png = await deps.evidence.redactedImage(record.id);
  if (!png) throw new Error(`Redacted image for ${record.id} is missing from storage`);

  const exported = await deps.ledger.append("evidence.exported", {
    evidenceId: record.id,
    format: BUNDLE_FORMAT,
    redactedSha256: record.redactedSha256,
    exportedBy: deps.exportedBy,
  });

  // Corroborating Ring events: anything on the same device or a linked sensor within ±3 minutes.
  const sensor = deps.state.data.sensors.find((s) => s.id === record.sensorId);
  const related = new Set([record.deviceId, ...(sensor?.corroboratingDeviceIds ?? [])]);
  const at = Date.parse(record.capturedAt);
  const ringSeqs = deps.state.data.ringEvents
    .filter((e) => e.deviceId && related.has(e.deviceId) && Math.abs(e.timestamp - at) <= 180_000)
    .map((e) => e.ledgerSeq);

  const seqs = new Set<number>([0, record.definitionSeq, record.triggerSeq, record.capturedSeq, record.redactedSeq, exported.seq, ...ringSeqs]);
  if (record.clip) seqs.add(record.clip.seq);
  const entries = (await Promise.all([...seqs].map((seq) => deps.ledger.get(seq)))).filter((e): e is LedgerEntry => !!e).sort((a, b) => a.seq - b.seq);
  const head = deps.ledger.head();

  return signBundle(
    {
      format: BUNDLE_FORMAT,
      bundleId: randomUUID(),
      createdAt: new Date().toISOString(),
      title: `${record.sensorName}: ${record.state}`,
      app: { name: APP_NAME, version: APP_VERSION, mode: deps.mode },
      signer: { kid: deps.signer.kid, alg: "ES256", publicJwk: deps.signer.publicJwk },
      subject: {
        evidenceId: record.id,
        sensorId: record.sensorId,
        sensorName: record.sensorName,
        question: record.question,
        deviceId: record.deviceId,
        deviceName: record.deviceName,
        state: record.state,
        capturedAt: record.capturedAt,
      },
      assets: [
        {
          evidenceId: record.id,
          name: "redacted.png",
          mediaType: "image/png",
          sha256: record.redactedSha256,
          width: record.width,
          height: record.height,
          dataBase64: base64Encode(png),
        },
      ],
      ledger: entries,
      ledgerHead: { seq: head.seq, hash: head.hash },
    },
    (data) => deps.signer.sign(data),
  );
}
