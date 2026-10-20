import { UNKNOWN, type VisionAnswer, type VisionProvider, type VisionRequest } from "./types.js";

/**
 * Offline stand-in for development and tests. It does not look at pixels: it
 * reads the simulator's ground truth and maps it onto the owner's labels.
 * Use VISION_PROVIDER=anthropic or bedrock for real perception.
 */
const TOPICS: { words: string[]; key: string }[] = [
  { words: ["gate"], key: "gate" },
  { words: ["garage"], key: "garageDoor" },
  { words: ["bin", "trash", "garbage", "recycl", "rubbish"], key: "bins" },
  { words: ["package", "parcel", "box", "delivery"], key: "package" },
  { words: ["car", "vehicle"], key: "car" },
  { words: ["person", "someone", "anyone", "visitor", "people"], key: "person" },
  { words: ["dark", "night"], key: "night" },
];

const GROUPS: Record<string, string[]> = {
  open: ["open", "opened", "unlatched", "ajar", "up", "raised", "unlocked"],
  closed: ["closed", "shut", "latched", "down", "locked", "secure", "secured"],
  present: ["yes", "present", "there", "out", "at curb", "curb", "delivered", "visible", "parked", "occupied", "detected"],
  absent: ["no", "absent", "none", "gone", "away", "in yard", "yard", "empty", "not visible", "clear", "back"],
};

function groupOf(value: string | boolean): string {
  if (value === true) return "present";
  if (value === false) return "absent";
  if (value === "curb") return "present";
  if (value === "yard") return "absent";
  return value;
}

function matchLabel(states: string[], group: string): string | undefined {
  const words = GROUPS[group] ?? [group];
  return states.find((s) => words.includes(s)) ?? states.find((s) => words.some((w) => s.includes(w)));
}

export class MockVision implements VisionProvider {
  readonly name = "mock";
  readonly model = "simulator-ground-truth";

  async ask(request: VisionRequest): Promise<VisionAnswer> {
    const base = { provider: this.name, model: this.model, guardrail: null };
    const truth = request.simTruth;
    const question = request.question.toLowerCase();
    const topic = TOPICS.find((t) => t.words.some((w) => question.includes(w)));
    const value = topic && truth ? truth[topic.key] : undefined;
    if (value === undefined) {
      return { ...base, state: UNKNOWN, confidence: 0.3, observation: "Mock provider: no simulator ground truth for this question or frame." };
    }
    const label = matchLabel(request.states, groupOf(value));
    if (!label) return { ...base, state: UNKNOWN, confidence: 0.4, observation: `Mock provider: "${String(value)}" does not map to any label.` };
    return { ...base, state: label, confidence: 0.92, observation: `Mock provider: simulator reports ${topic!.key} = ${String(value)}.` };
  }
}
