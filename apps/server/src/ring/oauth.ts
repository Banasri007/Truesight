import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { Config } from "../config.js";
import { JsonFile } from "../storage/json-file.js";
import { RingApiError } from "./types.js";

interface TokenRecord {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string | null;
  accountId: string | null;
  status: "unclaimed" | "linked";
  createdAt: string;
  linkedAt: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Ring account linking and token lifecycle.
 *
 * Supports both documented flows:
 *  - One-way (Ring-initiated): Ring sends an authorization code to the Token
 *    Exchange URL, then redirects the user to the Account Link URL with
 *    `nonce` and `time`. We find the token whose account id produces that
 *    nonce, claim it with POST /v1/accounts/me/app-integrations and complete
 *    it with PATCH {status: "completed"}.
 *  - Partner-initiated OAuth 2.0 with PKCE (S256).
 *
 * Access tokens last ~4h; refresh tokens rotate on every refresh.
 */
export class RingAuth {
  private readonly pkce = new Map<string, { verifier: string; createdAt: number }>();
  private refreshing: Promise<TokenRecord> | null = null;

  private constructor(
    private readonly cfg: Config,
    private readonly file: JsonFile<{ tokens: TokenRecord[] }>,
  ) {}

  static async open(cfg: Config): Promise<RingAuth> {
    const file = await JsonFile.open<{ tokens: TokenRecord[] }>(join(cfg.dataDir, "ring-tokens.json"), () => ({ tokens: [] }));
    // RING_REFRESH_TOKEN seeds a linked record once; after that the rotated token in the file wins.
    if (cfg.RING_REFRESH_TOKEN && !file.data.tokens.some((t) => t.status === "linked")) {
      file.data.tokens.push({
        id: randomUUID(),
        accessToken: "",
        refreshToken: cfg.RING_REFRESH_TOKEN,
        expiresAt: 0,
        scope: null,
        accountId: null,
        status: "linked",
        createdAt: new Date().toISOString(),
        linkedAt: new Date().toISOString(),
      });
      await file.flush();
    }
    return new RingAuth(cfg, file);
  }

  private get accountIdentifier(): string {
    return `owner@${new URL(this.cfg.PUBLIC_BASE_URL).hostname}`;
  }

  /** How TrueSight is authorized: AppStore link, a pasted refresh token, or a Playground token. */
  get method(): "playground" | "refresh-token" | "account-link" | "none" {
    if (this.cfg.RING_ACCESS_TOKEN) return "playground";
    if (!this.linkedRecord()) return "none";
    return this.cfg.RING_REFRESH_TOKEN ? "refresh-token" : "account-link";
  }

  status() {
    const linked = this.linkedRecord();
    const playground = !!this.cfg.RING_ACCESS_TOKEN;
    return {
      linked: playground || !!linked,
      method: this.method,
      accountId: playground ? null : (linked?.accountId ?? null),
      accessTokenExpiresAt: !playground && linked && linked.expiresAt > 0 ? new Date(linked.expiresAt).toISOString() : null,
      unclaimedTokens: this.file.data.tokens.filter((t) => t.status === "unclaimed").length,
    };
  }

  private linkedRecord(): TokenRecord | undefined {
    return this.file.data.tokens.find((t) => t.status === "linked");
  }

  /** A valid bearer token for the linked account, refreshed when it is about to expire. */
  async accessToken(): Promise<string> {
    if (this.cfg.RING_ACCESS_TOKEN) return this.cfg.RING_ACCESS_TOKEN;
    const record = this.linkedRecord();
    if (!record) throw new RingApiError(401, "Not linked", "Link a Ring account first (Ring app or ring.com/appstore), or set RING_ACCESS_TOKEN from the Ring Developer Playground.");
    if (record.expiresAt - Date.now() > 5 * 60_000) return record.accessToken;
    return (await this.refresh(record)).accessToken;
  }

  /** Called after a 401 from the API. */
  async forceRefresh(): Promise<void> {
    if (this.cfg.RING_ACCESS_TOKEN) {
      throw new RingApiError(
        401,
        "Playground token expired",
        "Playground tokens last about 30 minutes. Generate a new one at https://developer.amazon.com/ring/console/playground, update RING_ACCESS_TOKEN in .env and restart.",
      );
    }
    const record = this.linkedRecord();
    if (record) await this.refresh(record);
  }

  private async refresh(record: TokenRecord): Promise<TokenRecord> {
    this.refreshing ??= (async () => {
      try {
        const tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: record.refreshToken });
        record.accessToken = tokens.access_token;
        record.refreshToken = tokens.refresh_token; // refresh tokens rotate; the old one is now invalid
        record.expiresAt = Date.now() + tokens.expires_in * 1000;
        record.scope = tokens.scope ?? record.scope;
        await this.file.flush();
        return record;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({ ...fields, client_id: this.cfg.RING_CLIENT_ID!, client_secret: this.cfg.RING_CLIENT_SECRET! });
    const response = await fetch(`${this.cfg.RING_OAUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new RingApiError(response.status, "Token request failed", text.slice(0, 300));
    return JSON.parse(text) as TokenResponse;
  }

  private async ringJson(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.cfg.RING_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new RingApiError(response.status, `${method} ${path} failed`, text.slice(0, 300));
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private async exchangeCode(code: string, codeVerifier?: string): Promise<TokenRecord> {
    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    const me = (await this.ringJson("GET", "/v1/users/me", tokens.access_token)) as { data?: { id?: string } } | null;
    return {
      id: randomUUID(),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope ?? null,
      accountId: me?.data?.id ?? null,
      status: "unclaimed",
      createdAt: new Date().toISOString(),
      linkedAt: null,
    };
  }

  // ---- One-way (Ring-initiated) linking -------------------------------------------------

  /** Token Exchange URL handler: Ring hands us a single-use code (valid ~60s). */
  async acceptTokenExchange(code: string): Promise<void> {
    const record = await this.exchangeCode(code);
    this.file.data.tokens = [...this.file.data.tokens.filter((t) => t.status === "linked" || Date.now() - Date.parse(t.createdAt) < 3_600_000), record];
    await this.file.flush();
  }

  /** Account Link URL: reject stale or future `time` (ms) before showing anything. */
  validateLinkRequest(nonce: string | undefined, time: string | undefined): string | null {
    if (!nonce || !time || !/^\d+$/.test(time)) return "Missing nonce or time.";
    const age = Date.now() - Number(time);
    if (age < -30_000) return "Link request time is in the future.";
    if (age > 600_000) return "Link request expired (older than 10 minutes). Start again from the Ring app.";
    return null;
  }

  /** After the owner has signed in to TrueSight: match the nonce to a token and claim it. */
  async confirmOneWayLink(nonce: string, time: string): Promise<void> {
    const problem = this.validateLinkRequest(nonce, time);
    if (problem) throw new RingApiError(400, "Invalid link request", problem);
    const nonceBuffer = Buffer.from(nonce);
    const match = this.file.data.tokens.find((t) => {
      if (t.status !== "unclaimed" || !t.accountId) return false;
      const expected = Buffer.from(base64url(createHmac("sha256", this.cfg.RING_HMAC_KEY!).update(`${time}:${t.accountId}`).digest()));
      return expected.length === nonceBuffer.length && timingSafeEqual(expected, nonceBuffer);
    });
    if (!match) throw new RingApiError(404, "No matching token", "Ring has not delivered a token for this link request yet. Try again from the Ring app.");
    await this.ringJson("POST", "/v1/accounts/me/app-integrations", match.accessToken, { account_identifier: this.accountIdentifier, nonce });
    await this.ringJson("PATCH", "/v1/accounts/me/app-integrations", match.accessToken, { status: "completed" });
    this.markLinked(match);
    await this.file.flush();
  }

  // ---- Partner-initiated OAuth 2.0 + PKCE -----------------------------------------------

  startPartnerLink(): string {
    const verifier = base64url(randomBytes(48));
    const state = base64url(randomBytes(24));
    this.pkce.set(state, { verifier, createdAt: Date.now() });
    for (const [key, value] of this.pkce) if (Date.now() - value.createdAt > 600_000) this.pkce.delete(key);
    const url = new URL(this.cfg.RING_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.cfg.RING_CLIENT_ID!,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: this.cfg.RING_SCOPE,
      state,
      code_challenge: base64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async completePartnerLink(code: string, state: string): Promise<void> {
    const pending = this.pkce.get(state);
    this.pkce.delete(state);
    if (!pending) throw new RingApiError(400, "Unknown state", "The link attempt expired or was already used. Start again.");
    const record = await this.exchangeCode(code, pending.verifier);
    await this.ringJson("PATCH", "/v1/accounts/me/app-integrations", record.accessToken, {
      status: "completed",
      account_identifier: this.accountIdentifier,
    });
    this.file.data.tokens.push(record);
    this.markLinked(record);
    await this.file.flush();
  }

  /** Remove the integration (partner-initiated apps only) and forget tokens. */
  async unlink(): Promise<void> {
    const record = this.linkedRecord();
    if (record) {
      try {
        await this.ringJson("DELETE", "/v1/accounts/me/app-integrations", await this.accessToken());
      } catch (error) {
        // One-way apps receive 403 here; the customer removes them from the Ring app instead.
        if (!(error instanceof RingApiError && error.status === 403)) throw error;
      }
    }
    this.file.data.tokens = [];
    await this.file.flush();
  }

  /** Ring told us (app_integration_removed webhook) that the customer disconnected. */
  async forget(): Promise<void> {
    this.file.data.tokens = [];
    await this.file.flush();
  }

  private markLinked(record: TokenRecord): void {
    for (const t of this.file.data.tokens) if (t !== record && t.status === "linked") t.status = "unclaimed";
    record.status = "linked";
    record.linkedAt = new Date().toISOString();
    this.file.data.tokens = this.file.data.tokens.filter((t) => t.status === "linked");
  }
}
