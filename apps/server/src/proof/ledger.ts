import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GENESIS_PREV, createEntry, type LedgerEntry } from "truesight-verify";
import type { Signer } from "./signer.js";

export interface LedgerStore {
  readonly description: string;
  head(): Promise<LedgerEntry | null>;
  /** Must fail if `entry.seq` already exists (append-only). */
  append(entry: LedgerEntry): Promise<void>;
  /** Inclusive range, ascending. */
  range(fromSeq: number, toSeq: number): Promise<LedgerEntry[]>;
  get(seq: number): Promise<LedgerEntry | null>;
}

/** One JSON object per line in DATA_DIR/ledger.jsonl. */
export class LocalLedgerStore implements LedgerStore {
  readonly description: string;

  private constructor(
    private readonly path: string,
    private readonly entries: LedgerEntry[],
  ) {
    this.description = `local file (${path})`;
  }

  static async open(dataDir: string): Promise<LocalLedgerStore> {
    const path = join(dataDir, "ledger.jsonl");
    await mkdir(dirname(path), { recursive: true });
    let entries: LedgerEntry[] = [];
    try {
      entries = (await readFile(path, "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as LedgerEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return new LocalLedgerStore(path, entries);
  }

  async head() {
    return this.entries.at(-1) ?? null;
  }

  async append(entry: LedgerEntry) {
    if (entry.seq !== this.entries.length) throw new Error(`Ledger conflict: expected seq ${this.entries.length}, got ${entry.seq}`);
    await appendFile(this.path, `${JSON.stringify(entry)}\n`);
    this.entries.push(entry);
  }

  async range(fromSeq: number, toSeq: number) {
    return this.entries.slice(Math.max(0, fromSeq), Math.max(0, toSeq + 1));
  }

  async get(seq: number) {
    return this.entries[seq] ?? null;
  }
}

/**
 * DynamoDB ledger: partition key `pk` (S), sort key `seq` (N). Appends use a
 * condition expression, so an existing sequence number can never be overwritten.
 */
export class DynamoLedgerStore implements LedgerStore {
  readonly description: string;
  private readonly db: DynamoDBDocumentClient;
  private static readonly PK = "truesight-ledger";

  constructor(
    region: string,
    private readonly table: string,
  ) {
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    this.description = `Amazon DynamoDB (${table})`;
  }

  async head() {
    const result = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": DynamoLedgerStore.PK },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return (result.Items?.[0]?.entry as LedgerEntry | undefined) ?? null;
  }

  async append(entry: LedgerEntry) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: DynamoLedgerStore.PK, seq: entry.seq, entry },
        ConditionExpression: "attribute_not_exists(seq)",
      }),
    );
  }

  async range(fromSeq: number, toSeq: number) {
    const entries: LedgerEntry[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk AND seq BETWEEN :from AND :to",
          ExpressionAttributeValues: { ":pk": DynamoLedgerStore.PK, ":from": fromSeq, ":to": toSeq },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of result.Items ?? []) entries.push(item.entry as LedgerEntry);
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return entries;
  }

  async get(seq: number) {
    const result = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: DynamoLedgerStore.PK, seq } }));
    return (result.Item?.entry as LedgerEntry | undefined) ?? null;
  }
}

export type LedgerListener = (entry: LedgerEntry) => void;

/** Append-only, hash-chained, signed event log. Appends are serialized. */
export class Ledger {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners: LedgerListener[] = [];

  private constructor(
    readonly store: LedgerStore,
    private readonly signer: Signer,
    private last: LedgerEntry,
  ) {}

  static async open(store: LedgerStore, signer: Signer, genesis: Record<string, unknown>): Promise<Ledger> {
    let head = await store.head();
    if (head && head.kid !== signer.kid) {
      throw new Error(
        `The ledger in ${store.description} was signed by ${head.kid}, but the configured signer is ${signer.kid}. ` +
          "Use a fresh DATA_DIR / table when switching keys, or restore the original key.",
      );
    }
    if (!head) {
      head = await createEntry(
        {
          v: 1,
          seq: 0,
          ts: new Date().toISOString(),
          type: "ledger.genesis",
          data: { ...genesis, kid: signer.kid, publicJwk: signer.publicJwk, signer: signer.description },
          prev: GENESIS_PREV,
          kid: signer.kid,
        },
        (data) => signer.sign(data),
      );
      await store.append(head);
    }
    return new Ledger(store, signer, head);
  }

  onAppend(listener: LedgerListener): void {
    this.listeners.push(listener);
  }

  head(): LedgerEntry {
    return this.last;
  }

  append(type: string, data: Record<string, unknown>): Promise<LedgerEntry> {
    const run = this.queue.then(async () => {
      const entry = await createEntry(
        { v: 1, seq: this.last.seq + 1, ts: new Date().toISOString(), type, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, prev: this.last.hash, kid: this.signer.kid },
        (bytes) => this.signer.sign(bytes),
      );
      await this.store.append(entry);
      this.last = entry;
      for (const listener of this.listeners) listener(entry);
      return entry;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  get(seq: number) {
    return this.store.get(seq);
  }

  range(fromSeq: number, toSeq: number) {
    return this.store.range(fromSeq, toSeq);
  }

  /** Newest first. */
  async page(beforeSeq: number | null, limit: number): Promise<LedgerEntry[]> {
    const to = Math.min(beforeSeq === null ? this.last.seq : beforeSeq - 1, this.last.seq);
    if (to < 0) return [];
    return (await this.store.range(Math.max(0, to - limit + 1), to)).reverse();
  }
}
