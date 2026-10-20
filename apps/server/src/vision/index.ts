import type { Config } from "../config.js";
import { AnthropicVision, BedrockVision } from "./claude.js";
import { MockVision } from "./mock.js";
import type { VisionProvider } from "./types.js";

export function createVision(cfg: Config): VisionProvider {
  switch (cfg.VISION_PROVIDER) {
    case "anthropic":
      return new AnthropicVision(cfg.ANTHROPIC_MODEL, cfg.VISION_EFFORT);
    case "bedrock":
      return new BedrockVision(cfg.BEDROCK_MODEL, cfg.VISION_EFFORT, cfg.AWS_REGION);
    default:
      return new MockVision();
  }
}
