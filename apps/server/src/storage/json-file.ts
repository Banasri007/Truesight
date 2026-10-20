import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A JSON document on disk with debounced, atomic (write-then-rename) saves. */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    readonly path: string,
    public data: T,
  ) {}

  static async open<T>(path: string, defaults: () => T): Promise<JsonFile<T>> {
    await mkdir(dirname(path), { recursive: true });
    let data: T;
    try {
      data = { ...defaults(), ...(JSON.parse(await readFile(path, "utf8")) as T) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      data = defaults();
    }
    return new JsonFile(path, data);
  }

  /** Save soon; coalesces bursts of changes into one write. */
  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((error: unknown) => console.error(`[storage] could not save ${this.path}:`, (error as Error).message));
    }, 150);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot);
      try {
        await rename(tmp, this.path);
      } catch {
        // Windows can refuse to replace a file another process has open; fall back to a direct write.
        await writeFile(this.path, snapshot);
      }
    });
    return this.writing;
  }
}
