export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    const err = body as { error?: string; source?: string; issues?: { path: string; message: string }[] } | null;
    // Only our own 401 means "signed out"; upstream Ring auth problems carry source: "ring".
    if (response.status === 401 && err?.source !== "ring") onUnauthorized?.();
    throw new ApiError(response.status, err?.error ?? `${response.status} ${response.statusText}`, err?.issues);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.issues?.length) {
    return error.issues.map((i) => `${i.path || "input"}: ${i.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
