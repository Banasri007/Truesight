/**
 * Deterministic JSON serialization used for every hash and signature in Witness.
 *
 * Rules: object keys sorted by UTF-16 code unit order, no whitespace,
 * `undefined` object members dropped, `undefined` array items become null,
 * non-finite numbers rejected. For ASCII keys this matches RFC 8785 (JCS).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize a non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
  }
}
