import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { AppContext } from "./http/context.js";
import { Notifier } from "./notify/notifier.js";
import { SseHub } from "./notify/sse.js";
import { NoFaceDetector, RekognitionFaceDetector, type FaceDetector } from "./privacy/faces.js";
import { EvidenceService } from "./proof/evidence.js";
import { DynamoLedgerStore, Ledger, LocalLedgerStore } from "./proof/ledger.js";
import { KmsSigner, LocalSigner } from "./proof/signer.js";
import { RingApiClient } from "./ring/api-client.js";
import { RingAuth } from "./ring/oauth.js";
import { Simulator, type SimulatorHooks } from "./ring/simulator/simulator.js";
import type { RingClient } from "./ring/types.js";
import { SensorEngine } from "./sensors/engine.js";
import { LocalBlobStore, S3BlobStore } from "./storage/blobs.js";
import { StateStore } from "./storage/state.js";
import { APP_NAME, APP_VERSION } from "./version.js";
import { createVision } from "./vision/index.js";
import type { VisionProvider } from "./vision/types.js";

export interface BootstrapOptions {
  vision?: VisionProvider;
  faces?: FaceDetector;
  eventSnapshotDelayMs?: number;
  confirmDelayMs?: number;
}

/** Wire every component from configuration. Shared by the server entry point and the tests. */
export async function bootstrap(cfg: Config, options: BootstrapOptions = {}) {
  await mkdir(cfg.dataDir, { recursive: true });
  const state = await StateStore.open(cfg.dataDir);

  const signer = cfg.SIGNER === "kms" ? await KmsSigner.open(cfg.AWS_REGION, cfg.KMS_KEY_ID!) : await LocalSigner.open(cfg.dataDir);
  const ledgerStore = cfg.LEDGER_STORE === "dynamodb" ? new DynamoLedgerStore(cfg.AWS_REGION, cfg.DYNAMODB_LEDGER_TABLE!) : await LocalLedgerStore.open(cfg.dataDir);
  const ledger = await Ledger.open(ledgerStore, signer, { app: APP_NAME, version: APP_VERSION });
  const blobs = cfg.BLOB_STORE === "s3" ? new S3BlobStore(cfg.AWS_REGION, cfg.S3_EVIDENCE_BUCKET!, cfg.S3_OBJECT_LOCK_MODE) : new LocalBlobStore(join(cfg.dataDir, "blobs"));

  const sse = new SseHub();
  ledger.onAppend((entry) => sse.send("ledger", entry));
  const notifier = new Notifier(sse, cfg.SNS_TOPIC_ARN, cfg.AWS_REGION);
  const faces = options.faces ?? (cfg.FACE_DETECTOR === "rekognition" ? new RekognitionFaceDetector(cfg.AWS_REGION) : new NoFaceDetector());
  const vision = options.vision ?? createVision(cfg);

  let simulator: Simulator | null = null;
  let auth: RingAuth | null = null;
  let ring: RingClient;
  const simHooks: SimulatorHooks = {
    webhookUrl: `http://127.0.0.1:${cfg.PORT}/webhooks/ring`,
    hmacKey: cfg.SIM_HMAC_KEY,
    onChime: (chimeId, slotEvent, message) => sse.send("chime", { chimeId, slotEvent, message, at: new Date().toISOString() }),
    onChange: () => simulator && sse.send("sim", simulator.state()),
  };
  if (cfg.RING_MODE === "simulator") {
    simulator = await Simulator.open(cfg.dataDir, simHooks);
    ring = simulator;
  } else {
    auth = await RingAuth.open(cfg);
    ring = new RingApiClient(cfg, auth, () => state.data.deviceKinds);
  }

  const evidence = new EvidenceService({ state, ledger, blobs, faces, ring, sse, retentionDays: cfg.EVIDENCE_RETENTION_DAYS });
  const engine = new SensorEngine({
    state,
    ledger,
    ring,
    vision,
    faces,
    evidence,
    notifier,
    sse,
    eventSnapshotDelayMs: options.eventSnapshotDelayMs ?? (cfg.RING_MODE === "api" ? 6000 : 400),
    confirmDelayMs: options.confirmDelayMs ?? 4000,
  });

  const ctx: AppContext = { cfg, state, ledger, signer, blobs, ring, simulator, auth, engine, evidence, sse, notifier, faces, vision };
  return {
    ctx,
    /** The simulator posts webhooks to this server; call once the real port is known. */
    setPort(port: number) {
      simHooks.webhookUrl = `http://127.0.0.1:${port}/webhooks/ring`;
    },
  };
}
