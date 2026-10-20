export interface VisionRequest {
  image: Buffer;
  mediaType: "image/jpeg" | "image/png";
  question: string;
  /** Allowed answers (lowercase). "unknown" is always allowed in addition. */
  states: string[];
  /** Simulator ground truth; only the mock provider reads it. */
  simTruth?: Record<string, string | boolean> | undefined;
}

export interface VisionAnswer {
  state: string;
  confidence: number;
  observation: string;
  provider: string;
  model: string;
  /** Set when an output guardrail changed or withheld something. */
  guardrail: string | null;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  ask(request: VisionRequest): Promise<VisionAnswer>;
}

export const UNKNOWN = "unknown";
