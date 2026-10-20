import { join } from "node:path";
import type { EvidenceRecord, NormRect, PrivacyReceipt, RingEventRecord, Sensor } from "../domain.js";
import type { DeviceKind } from "../ring/types.js";
import { JsonFile } from "./json-file.js";

export interface AppState {
  sensors: Sensor[];
  privacyZones: Record<string, NormRect[]>;
  deviceKinds: Record<string, DeviceKind>;
  seenWebhookRequestIds: string[];
  ringEvents: RingEventRecord[];
  receipts: PrivacyReceipt[];
  evidence: EvidenceRecord[];
}

const LIMITS = { seenWebhookRequestIds: 2000, ringEvents: 500, receipts: 500 } as const;

export class StateStore {
  private constructor(private readonly file: JsonFile<AppState>) {}

  static async open(dataDir: string): Promise<StateStore> {
    const file = await JsonFile.open<AppState>(join(dataDir, "state.json"), () => ({
      sensors: [],
      privacyZones: {},
      deviceKinds: {},
      seenWebhookRequestIds: [],
      ringEvents: [],
      receipts: [],
      evidence: [],
    }));
    return new StateStore(file);
  }

  get data(): AppState {
    return this.file.data;
  }

  /** Mutate state and persist it. */
  update<R>(mutate: (state: AppState) => R): R {
    const result = mutate(this.file.data);
    const s = this.file.data;
    s.seenWebhookRequestIds = s.seenWebhookRequestIds.slice(-LIMITS.seenWebhookRequestIds);
    s.ringEvents = s.ringEvents.slice(-LIMITS.ringEvents);
    s.receipts = s.receipts.slice(-LIMITS.receipts);
    this.file.save();
    return result;
  }

  flush(): Promise<void> {
    return this.file.flush();
  }
}
