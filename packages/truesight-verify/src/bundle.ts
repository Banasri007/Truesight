import { canonicalize } from "./canonical.js";
import {
  asEs256PublicJwk,
  base64Decode,
  base64UrlDecode,
  base64UrlEncode,
  importEs256PublicKey,
  jwkThumbprint,
  sha256Hex,
  utf8,
  verifyEs256,
  type Es256PublicJwk,
} from "./crypto.js";
import { verifyLedger, type LedgerEntry, type SignFn } from "./ledger.js";
import { decodePngRgba, preservedPixelsDigest, type PixelRect } from "./pixels.js";

export const BUNDLE_FORMAT = "truesight.bundle/1";

export interface BundleAsset {
  evidenceId: string;
  name: string;
  mediaType: string;
  sha256: string;
  width?: number;
  height?: number;
  dataBase64: string;
}

/** A self-contained, signed incident package that anyone can verify offline. */
export interface EvidenceBundle {
  format: typeof BUNDLE_FORMAT;
  bundleId: string;
  createdAt: string;
  title: string;
  app: { name: string; version: string; mode?: string };
  signer: { kid: string; alg: "ES256"; publicJwk: Es256PublicJwk };
  subject: {
    evidenceId: string;
    sensorId?: string;
    sensorName?: string;
    question?: string;
    deviceId?: string;
    deviceName?: string;
    state?: string;
    capturedAt?: string;
  };
  assets: BundleAsset[];
  /** Ledger excerpt: the entries that tell this incident's story. */
  ledger: LedgerEntry[];
  /** Head of the full ledger at export time. */
  ledgerHead: { seq: number; hash: string };
  /** base64url ES256 over canonical(bundle without `signature`). */
  signature: string;
}

export type UnsignedBundle = Omit<EvidenceBundle, "signature">;

export async function signBundle(unsigned: UnsignedBundle, sign: SignFn): Promise<EvidenceBundle> {
  const signature = await sign(utf8(canonicalize(unsigned)));
  return { ...unsigned, signature: base64UrlEncode(signature) };
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface BundleReport {
  ok: boolean;
  checks: Check[];
  subject?: EvidenceBundle["subject"];
  signerKid?: string;
}

interface RedactionData {
  evidenceId: string;
  originalSha256: string;
  redactedSha256: string;
  width: number;
  height: number;
  regions: (PixelRect & { kind?: string })[];
  preservedPixelsDigest: string;
}

/**
 * Verify an evidence bundle end to end. Never throws for bad input; every
 * problem becomes a failed check so a UI can show exactly what went wrong.
 */
export async function verifyBundle(input: unknown): Promise<BundleReport> {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string) => {
    checks.push({ id, label, ok, ...(detail ? { detail } : {}) });
    return ok;
  };
  const done = (subject?: EvidenceBundle["subject"], signerKid?: string): BundleReport => ({
    ok: checks.length > 0 && checks.every((c) => c.ok),
    checks,
    ...(subject ? { subject } : {}),
    ...(signerKid ? { signerKid } : {}),
  });

  const bundle = input as EvidenceBundle;
  if (!bundle || typeof bundle !== "object" || bundle.format !== BUNDLE_FORMAT) {
    add("format", "Recognized bundle format", false, `expected format "${BUNDLE_FORMAT}"`);
    return done();
  }
  add("format", "Recognized bundle format", true, BUNDLE_FORMAT);

  // 1. Signer key and key id.
  let jwk: Es256PublicJwk;
  let key: CryptoKey;
  try {
    jwk = asEs256PublicJwk(bundle.signer?.publicJwk);
    key = await importEs256PublicKey(jwk);
  } catch (error) {
    add("signer", "Signer public key is valid", false, (error as Error).message);
    return done(bundle.subject);
  }
  const thumbprint = await jwkThumbprint(jwk);
  const kid = bundle.signer.kid;
  add("signer", "Signer key id matches its public key", kid.endsWith(`:${thumbprint}`), kid);

  // 2. Bundle signature covers everything else in the file.
  const { signature, ...unsigned } = bundle;
  let bundleSigOk = false;
  try {
    bundleSigOk = await verifyEs256(key, base64UrlDecode(signature ?? ""), utf8(canonicalize(unsigned)));
  } catch {
    bundleSigOk = false;
  }
  add("bundle-signature", "Bundle signature is valid (nothing in the file was altered)", bundleSigOk);

  // 3. Ledger excerpt: hashes, signatures, chain links.
  const ledger = Array.isArray(bundle.ledger) ? bundle.ledger : [];
  const ledgerReport = await verifyLedger(ledger, jwk);
  add(
    "ledger",
    `Ledger entries are intact and signed (${ledgerReport.entries} entries, ${ledgerReport.linksChecked} chain links)`,
    ledgerReport.ok && ledger.length > 0,
    ledgerReport.problems.join("; ") || undefined,
  );
  const maxSeq = ledgerReport.lastSeq ?? -1;
  const headEntry = ledger.find((e) => e.seq === bundle.ledgerHead?.seq);
  add(
    "ledger-head",
    "Ledger head is consistent with the excerpt",
    typeof bundle.ledgerHead?.seq === "number" &&
      bundle.ledgerHead.seq >= maxSeq &&
      (!headEntry || headEntry.hash === bundle.ledgerHead.hash),
    `head #${bundle.ledgerHead?.seq}`,
  );

  // 4. Evidence story: capture -> redaction -> asset.
  const evidenceId = bundle.subject?.evidenceId;
  const captured = ledger.find((e) => e.type === "evidence.captured" && e.data.evidenceId === evidenceId);
  const redacted = ledger.find((e) => e.type === "evidence.redacted" && e.data.evidenceId === evidenceId);
  add("capture-recorded", "Original frame was hashed and signed at capture time", !!captured, captured ? `#${captured.seq}` : "missing");
  add("redaction-recorded", "Redaction was recorded as a signed edit", !!redacted, redacted ? `#${redacted.seq}` : "missing");
  if (captured && redacted) {
    const r = redacted.data as unknown as RedactionData;
    add(
      "capture-before-redaction",
      "Redaction happened after capture and refers to the same original",
      redacted.seq > captured.seq && r.originalSha256 === captured.data.originalSha256,
    );
    const triggerSeq = captured.data.triggerSeq;
    if (typeof triggerSeq === "number") {
      const trigger = ledger.find((e) => e.seq === triggerSeq);
      add(
        "trigger-link",
        "Evidence frame is the frame that triggered the sensor",
        !!trigger && trigger.type === "sensor.state_changed" && trigger.data.frameSha256 === captured.data.originalSha256,
        trigger ? `#${trigger.seq} ${String(trigger.data.from)} -> ${String(trigger.data.to)}` : "trigger entry not included",
      );
    }

    const asset = (bundle.assets ?? []).find((a) => a.evidenceId === evidenceId);
    if (!asset) {
      add("asset", "Redacted image is included", false);
    } else {
      const bytes = base64Decode(asset.dataBase64);
      const digest = await sha256Hex(bytes);
      add(
        "asset-hash",
        "Redacted image matches the signed hash",
        digest === asset.sha256 && digest === r.redactedSha256,
        digest.slice(0, 16),
      );
      try {
        const image = decodePngRgba(bytes);
        const sizeOk = image.width === r.width && image.height === r.height;
        const preserved = await preservedPixelsDigest(image, r.regions ?? []);
        add(
          "preserved-pixels",
          `Every pixel outside the ${r.regions?.length ?? 0} redacted region(s) is identical to the original`,
          sizeOk && preserved === r.preservedPixelsDigest,
          sizeOk ? undefined : "image size differs from the recorded original",
        );
      } catch (error) {
        add("preserved-pixels", "Redacted image could be decoded", false, (error as Error).message);
      }
    }
  }

  return done(bundle.subject, kid);
}
