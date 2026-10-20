import { config as loadDotenv } from "dotenv";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repository root (this file lives in apps/server/{src,dist}). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

loadDotenv({ path: resolve(repoRoot, ".env"), quiet: true });

const optional = z.string().min(1).optional();

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    PUBLIC_BASE_URL: optional,
    DATA_DIR: z.string().default("data"),
    ADMIN_TOKEN: optional,

    // Ring. Staging and production share these hosts and credentials; the environment is
    // picked per app in the Developer Console (staging settings + staging users).
    RING_MODE: z.enum(["simulator", "api"]).default("simulator"),
    RING_API_BASE: z.string().default("https://api.amazonvision.com"),
    RING_OAUTH_BASE: z.string().default("https://oauth.ring.com"),
    RING_AUTHORIZE_URL: z.string().default("https://account.ring.com/account/integrations/partner-link/authorize"),
    RING_CLIENT_ID: optional,
    RING_CLIENT_SECRET: optional,
    RING_HMAC_KEY: optional,
    // Shortcuts that skip AppStore account linking (same as Ring's ring-api-helloworld starter):
    // a short-lived (~30 min) token from https://developer.amazon.com/ring/console/playground,
    // or a refresh token from a completed link (needs client id/secret to refresh).
    RING_ACCESS_TOKEN: optional,
    RING_REFRESH_TOKEN: optional,
    // Partner-initiated authorize request only; "ava.v1:read" is the only supported value.
    // Token responses report it back as scope "ava", which is expected.
    RING_SCOPE: z.string().default("ava.v1:read"),
    RING_REDIRECT_URI: optional,
    SIM_HMAC_KEY: z.string().default("truesight-simulator-signing-key"),

    // Perception
    VISION_PROVIDER: z.enum(["mock", "groq", "anthropic", "bedrock"]).default("mock"),
    GROQ_API_KEY: optional,
    // Groq vision model with image input + strict JSON schema support.
    GROQ_MODEL: z.string().default("qwen/qwen3.8-27b"),
    ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
    BEDROCK_MODEL: z.string().default("anthropic.claude-opus-5-5"),
    VISION_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
    AWS_REGION: z.string().default("us-east-1"),
    FACE_DETECTOR: z.enum(["none", "rekognition"]).default("none"),

    // Proof
    SIGNER: z.enum(["local", "kms"]).default("local"),
    KMS_KEY_ID: optional,
    LEDGER_STORE: z.enum(["local", "dynamodb"]).default("local"),
    DYNAMODB_LEDGER_TABLE: optional,
    BLOB_STORE: z.enum(["local", "s3"]).default("local"),
    S3_EVIDENCE_BUCKET: optional,
    S3_OBJECT_LOCK_MODE: z.enum(["off", "GOVERNANCE", "COMPLIANCE"]).default("off"),
    EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

    // Actions
    SNS_TOPIC_ARN: optional,
  })
  .superRefine((env, ctx) => {
    const need = (when: boolean, key: keyof typeof env, why: string) => {
      if (when && !env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when ${why}` });
    };
    // A Playground access token is enough to call the API; everything else needs app credentials.
    const playground = env.RING_MODE === "api" && !!env.RING_ACCESS_TOKEN;
    for (const key of ["RING_CLIENT_ID", "RING_CLIENT_SECRET", "RING_HMAC_KEY"] as const) {
      need(env.RING_MODE === "api" && !playground, key, "RING_MODE=api (unless RING_ACCESS_TOKEN is set)");
    }
    if (env.RING_ACCESS_TOKEN && env.RING_REFRESH_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["RING_ACCESS_TOKEN"], message: "Set RING_ACCESS_TOKEN or RING_REFRESH_TOKEN, not both" });
    }
    need(env.VISION_PROVIDER === "groq", "GROQ_API_KEY", "VISION_PROVIDER=groq");
    need(env.SIGNER === "kms", "KMS_KEY_ID", "SIGNER=kms");
    need(env.LEDGER_STORE === "dynamodb", "DYNAMODB_LEDGER_TABLE", "LEDGER_STORE=dynamodb");
    need(env.BLOB_STORE === "s3", "S3_EVIDENCE_BUCKET", "BLOB_STORE=s3");
  });

export type Config = Omit<z.infer<typeof EnvSchema>, "PUBLIC_BASE_URL"> & {
  /** Resolved public URL without a trailing slash. */
  PUBLIC_BASE_URL: string;
  dataDir: string;
  redirectUri: string;
  webhookHmacKey: string;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty values in .env (e.g. `RING_CLIENT_ID=`) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration (check your .env):\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  const baseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, "");
  return {
    ...env,
    PUBLIC_BASE_URL: baseUrl,
    dataDir: isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(repoRoot, env.DATA_DIR),
    redirectUri: env.RING_REDIRECT_URI ?? `${baseUrl}/auth/ring/callback`,
    // Without an HMAC key (Playground-only setups) no webhook can verify, so a random key rejects them all.
    webhookHmacKey: env.RING_MODE === "api" ? (env.RING_HMAC_KEY ?? randomBytes(32).toString("hex")) : env.SIM_HMAC_KEY,
  };
}
