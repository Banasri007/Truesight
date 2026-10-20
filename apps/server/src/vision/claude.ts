import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { applyGuardrails } from "./guardrails.js";
import { SYSTEM_PROMPT, answerSchema, userPrompt } from "./prompt.js";
import { UNKNOWN, type VisionAnswer, type VisionProvider, type VisionRequest } from "./types.js";

type Effort = "low" | "medium" | "high";

const ModelAnswer = z.object({ state: z.string(), confidence: z.number(), observation: z.string() });

function userContent(request: VisionRequest): Anthropic.ContentBlockParam[] {
  return [
    { type: "image", source: { type: "base64", media_type: request.mediaType, data: request.image.toString("base64") } },
    { type: "text", text: userPrompt(request.question, request.states) },
  ];
}

/** Turn a Messages API response into a guarded answer. */
function interpret(
  content: { type: string; text?: string }[],
  stopReason: string | null,
  request: VisionRequest,
  provider: string,
  model: string,
): VisionAnswer {
  if (stopReason === "refusal") {
    return { state: UNKNOWN, confidence: 0, observation: "The model declined to assess this frame.", provider, model, guardrail: "model refusal" };
  }
  const text = content.find((block) => block.type === "text")?.text ?? "";
  let parsed: z.infer<typeof ModelAnswer>;
  try {
    parsed = ModelAnswer.parse(JSON.parse(text));
  } catch {
    return { state: UNKNOWN, confidence: 0, observation: "The model response could not be read.", provider, model, guardrail: "unparseable output" };
  }
  return { ...applyGuardrails(parsed, request.states), provider, model };
}

/**
 * Claude through the Claude API. Structured output pins the answer to the
 * owner's labels; `fallbacks: "default"` lets the API re-serve a policy
 * decline on the recommended fallback model instead of failing the check.
 */
export class AnthropicVision implements VisionProvider {
  readonly name = "anthropic";
  private readonly client = new Anthropic();

  constructor(
    readonly model: string,
    private readonly effort: Effort,
  ) {}

  async ask(request: VisionRequest): Promise<VisionAnswer> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: this.effort, format: { type: "json_schema", schema: answerSchema(request.states) } },
      messages: [{ role: "user", content: userContent(request) }],
    });
    return interpret(response.content, response.stop_reason, request, this.name, response.model);
  }
}

/**
 * Claude in Amazon Bedrock (Mantle endpoint): inference stays in your AWS
 * account and region, which Ring's CV guidelines recommend for camera imagery.
 */
export class BedrockVision implements VisionProvider {
  readonly name = "bedrock";
  private readonly client: AnthropicBedrockMantle;

  constructor(
    readonly model: string,
    private readonly effort: Effort,
    region: string,
  ) {
    this.client = new AnthropicBedrockMantle({ awsRegion: region });
  }

  async ask(request: VisionRequest): Promise<VisionAnswer> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: { effort: this.effort, format: { type: "json_schema", schema: answerSchema(request.states) } },
      messages: [{ role: "user", content: userContent(request) }],
    });
    return interpret(response.content, response.stop_reason, request, this.name, response.model);
  }
}
