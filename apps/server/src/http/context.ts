import type { Config } from "../config.js";
import type { Notifier } from "../notify/notifier.js";
import type { SseHub } from "../notify/sse.js";
import type { FaceDetector } from "../privacy/faces.js";
import type { EvidenceService } from "../proof/evidence.js";
import type { Ledger } from "../proof/ledger.js";
import type { Signer } from "../proof/signer.js";
import type { HistoryPoller } from "../ring/history-poller.js";
import type { RingAuth } from "../ring/oauth.js";
import type { Simulator } from "../ring/simulator/simulator.js";
import type { RingClient } from "../ring/types.js";
import type { SensorEngine } from "../sensors/engine.js";
import type { BlobStore } from "../storage/blobs.js";
import type { StateStore } from "../storage/state.js";
import type { VisionProvider } from "../vision/types.js";

export interface AppContext {
  cfg: Config;
  state: StateStore;
  ledger: Ledger;
  signer: Signer;
  blobs: BlobStore;
  ring: RingClient;
  simulator: Simulator | null;
  auth: RingAuth | null;
  /** Event-history polling (webhook substitute), when enabled. */
  historyPoller: HistoryPoller | null;
  engine: SensorEngine;
  evidence: EvidenceService;
  sse: SseHub;
  notifier: Notifier;
  faces: FaceDetector;
  vision: VisionProvider;
}

/** Errors with an HTTP status attached. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
