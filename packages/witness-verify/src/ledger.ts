import { canonicalize } from "./canonical.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  importEs256PublicKey,
  jwkThumbprint,
  sha256Hex,
  utf8,
  verifyEs256,
  type Es256PublicJwk,
} from "./crypto.js";

/** `prev` of the very first (genesis) entry. */
export const GENESIS_PREV = "0".repeat(64);

/** The signed part of a ledger entry. */
export interface LedgerEntryBody {
  v: 1;
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
  prev: string;
  kid: string;
}

/**
 * One append-only, hash-chained, individually signed record.
 * hash = hex(SHA-256(canonical(body))); sig = base64url(ES256(canonical(body))).
 */
export interface LedgerEntry extends LedgerEntryBody {
  hash: string;
  sig: string;
}

export type SignFn = (data: Uint8Array) => Promise<Uint8Array>;

export function entryBody(entry: LedgerEntryBody): LedgerEntryBody {
  return {
    v: entry.v,
    seq: entry.seq,
    ts: entry.ts,
    type: entry.type,
    data: entry.data,
    prev: entry.prev,
    kid: entry.kid,
  };
}

export async function hashEntryBody(body: LedgerEntryBody): Promise<string> {
  return sha256Hex(utf8(canonicalize(entryBody(body))));
}

/** Build and sign the next entry. Used by the Witness server and by tests. */
export async function createEntry(body: LedgerEntryBody, sign: SignFn): Promise<LedgerEntry> {
  const canonical = utf8(canonicalize(entryBody(body)));
  const [hash, signature] = await Promise.all([sha256Hex(canonical), sign(canonical)]);
  return { ...entryBody(body), hash, sig: base64UrlEncode(signature) };
}

export interface EntryCheck {
  seq: number;
  hashOk: boolean;
  signatureOk: boolean;
  kidOk: boolean;
}

export async function verifyEntry(entry: LedgerEntry, key: CryptoKey, expectedKid: string): Promise<EntryCheck> {
  const canonical = utf8(canonicalize(entryBody(entry)));
  const hashOk = (await sha256Hex(canonical)) === entry.hash;
  let signatureOk = false;
  try {
    signatureOk = await verifyEs256(key, base64UrlDecode(entry.sig), canonical);
  } catch {
    signatureOk = false;
  }
  return { seq: entry.seq, hashOk, signatureOk, kidOk: entry.kid === expectedKid };
}

export interface LedgerReport {
  ok: boolean;
  kid: string;
  entries: number;
  firstSeq: number | null;
  lastSeq: number | null;
  /** Number of adjacent pairs whose `prev` link was checked. */
  linksChecked: number;
  problems: string[];
}

/**
 * Verify a list of entries: every hash, every signature, the key id, and the
 * `prev` link between every pair of consecutive sequence numbers. Entries may
 * be an excerpt (gaps are allowed and reported as unlinked, not as failures).
 */
export async function verifyLedger(
  entries: LedgerEntry[],
  publicJwk: Es256PublicJwk,
  options: { requireGenesis?: boolean } = {},
): Promise<LedgerReport> {
  const kid = await jwkThumbprintKid(publicJwk, entries[0]?.kid);
  const key = await importEs256PublicKey(publicJwk);
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const problems: string[] = [];
  let linksChecked = 0;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const check = await verifyEntry(entry, key, kid);
    if (!check.hashOk) problems.push(`#${entry.seq} (${entry.type}): content does not match its hash`);
    if (!check.signatureOk) problems.push(`#${entry.seq} (${entry.type}): signature is invalid`);
    if (!check.kidOk) problems.push(`#${entry.seq} (${entry.type}): signed by unexpected key ${entry.kid}`);
    const previous = sorted[i - 1];
    if (previous && previous.seq === entry.seq) problems.push(`#${entry.seq}: duplicate sequence number`);
    if (previous && previous.seq + 1 === entry.seq) {
      linksChecked++;
      if (entry.prev !== previous.hash) problems.push(`#${entry.seq}: chain broken (prev does not match #${previous.seq})`);
    }
  }

  if (options.requireGenesis) {
    const first = sorted[0];
    if (!first || first.seq !== 0 || first.prev !== GENESIS_PREV) problems.push("ledger does not start at a genesis entry");
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.seq !== sorted[i - 1]!.seq + 1) {
        problems.push(`gap in sequence between #${sorted[i - 1]!.seq} and #${sorted[i]!.seq}`);
        break;
      }
    }
  }

  return {
    ok: problems.length === 0,
    kid,
    entries: sorted.length,
    firstSeq: sorted[0]?.seq ?? null,
    lastSeq: sorted.at(-1)?.seq ?? null,
    linksChecked,
    problems,
  };
}

/** Key ids look like "<provider>:<RFC 7638 thumbprint>", e.g. "local:abc..." or "kms:abc...". */
export async function kidFor(provider: string, publicJwk: Es256PublicJwk): Promise<string> {
  return `${provider}:${await jwkThumbprint(publicJwk)}`;
}

/** Recompute the kid for a JWK, keeping the provider prefix of the kid observed in the data. */
async function jwkThumbprintKid(publicJwk: Es256PublicJwk, observedKid: string | undefined): Promise<string> {
  const provider = observedKid?.includes(":") ? observedKid.slice(0, observedKid.indexOf(":")) : "local";
  return kidFor(provider, publicJwk);
}
