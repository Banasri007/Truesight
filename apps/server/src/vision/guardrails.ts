import { UNKNOWN } from "./types.js";

/**
 * Output guardrails recommended by Ring's computer-vision guidelines: validate
 * every model output before a person sees it, block sensitive categories, and
 * fall back to a generic message when a rule fires.
 */
const BLOCKED_TERMS = [
  // gender
  "man", "men", "woman", "women", "male", "female", "boy", "girl", "guy", "lady", "gentleman",
  // age
  "elderly", "old man", "old woman", "teen", "teenager", "kid", "child", "toddler", "young man", "young woman",
  // race / ethnicity
  "asian", "hispanic", "latino", "latina", "caucasian", "african", "arab", "indian", "ethnic", "race", "skin color", "skin tone",
  // intent and moral judgment
  "suspicious", "criminal", "thief", "burglar", "intruder", "trespasser", "stealing", "steal", "robber", "dangerous",
  "threatening", "lurking", "casing", "prowler", "shady", "sketchy",
];

const BLOCKED = new RegExp(`\\b(${BLOCKED_TERMS.map((t) => t.replace(/\s+/g, "\\s+")).join("|")})\\b`, "i");

export const GENERIC_OBSERVATION = "Observation withheld by a privacy guardrail.";

export interface RawAnswer {
  state: unknown;
  confidence: unknown;
  observation: unknown;
}

export function applyGuardrails(raw: RawAnswer, states: string[]): { state: string; confidence: number; observation: string; guardrail: string | null } {
  const notes: string[] = [];

  let state = typeof raw.state === "string" ? raw.state.trim().toLowerCase() : UNKNOWN;
  if (state !== UNKNOWN && !states.includes(state)) {
    notes.push(`state "${state}" is not an allowed label`);
    state = UNKNOWN;
  }

  let confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0;
  if (confidence > 1 && confidence <= 100) confidence /= 100; // tolerate percentages
  confidence = Math.min(1, Math.max(0, confidence));

  let observation = typeof raw.observation === "string" ? raw.observation.replace(/\s+/g, " ").trim() : "";
  if (observation.length > 200) observation = `${observation.slice(0, 197)}...`;
  const hit = BLOCKED.exec(observation);
  if (hit) {
    notes.push(`blocked term "${hit[1]!.toLowerCase()}"`);
    observation = GENERIC_OBSERVATION;
  }
  if (!observation) observation = state === UNKNOWN ? "Could not tell from this frame." : `Looks like: ${state}.`;

  return { state, confidence, observation, guardrail: notes.length ? notes.join("; ") : null };
}
