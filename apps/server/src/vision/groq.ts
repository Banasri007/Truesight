import Groq from "groq-sdk";
import { z } from "zod";
import { applyGuardrails } from "./guardrails.js";
import { SYSTEM_PROMPT, answerSchema, userPrompt } from "./prompt.js";
import { UNKNOWN, type VisionAnswer, type VisionProvider, type VisionRequest } from "./types.js";

type Effort = "low" | "medium" | "high";
type ResponseFormat = Parameters<Groq["chat"]["completions"]["create"]>[0]["response_format"];

const ModelAnswer = z.object({ state: z.string(), confidence: z.number(), observation: z.string() });

/** Models whose `reasoning_effort` accepts low / medium / high (per Groq's API reference). */
const EFFORT_MODELS = [/^qwen\/qwen3\.8/, /^openai\/gpt-oss-/];

/**
 * Pull the JSON answer out of a completion. Reasoning models can wrap their
 * output in <think>…</think>, and best-effort JSON mode can add stray text.
 */
export function parseModelJson(text: string): z.infer<typeof ModelAnswer> {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return ModelAnswer.parse(JSON.parse(cleaned.slice(start, end + 1)));
}

/**
 * Vision through Groq (OpenAI-compatible chat completions). Uses strict
 * json_schema structured output when the model supports it with images, and
 * falls back to JSON object mode if Groq rejects the schema for this model.
 */
export class GroqVision implements VisionProvider {
  readonly name = "groq";
  private readonly client: Groq;
  private schemaSupported = true;

  constructor(
    readonly model: string,
    private readonly effort: Effort,
    apiKey: string,
  ) {
    this.client = new Groq({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async ask(request: VisionRequest): Promise<VisionAnswer> {
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nReply with only a JSON object: {"state": string, "confidence": number, "observation": string}.` },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${request.mediaType};base64,${request.image.toString("base64")}` } },
          { type: "text", text: userPrompt(request.question, request.states) },
        ],
      },
    ];
    const effort = EFFORT_MODELS.some((m) => m.test(this.model)) ? { reasoning_effort: this.effort } : {};

    const create = (format: ResponseFormat) =>
      this.client.chat.completions.create({ model: this.model, messages, temperature: 0, max_completion_tokens: 2048, response_format: format, ...effort });

    let completion: Groq.Chat.ChatCompletion;
    try {
      completion = this.schemaSupported
        ? await create({ type: "json_schema", json_schema: { name: "sensor_answer", strict: true, schema: answerSchema(request.states) as unknown as Record<string, unknown> } })
        : await create({ type: "json_object" });
    } catch (error) {
      if (!(error instanceof Groq.BadRequestError) || !this.schemaSupported) throw error;
      // This model/vision combination doesn't accept strict schemas: remember and use JSON mode.
      console.warn(`[groq] json_schema rejected for ${this.model}, falling back to json_object: ${error.message}`);
      this.schemaSupported = false;
      completion = await create({ type: "json_object" });
    }

    const text = completion.choices[0]?.message.content ?? "";
    try {
      return { ...applyGuardrails(parseModelJson(text), request.states), provider: this.name, model: completion.model ?? this.model };
    } catch {
      return { state: UNKNOWN, confidence: 0, observation: "The model response could not be read.", provider: this.name, model: this.model, guardrail: "unparseable output" };
    }
  }
}
