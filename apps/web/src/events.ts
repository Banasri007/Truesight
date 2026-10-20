import { useEffect, useRef } from "react";

type Handler = (data: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const EVENT_TYPES = ["sensor", "sensor-deleted", "receipt", "ledger", "ring-event", "notification", "chime", "sim", "evidence"];
let source: EventSource | null = null;

/** One shared EventSource for the whole app. */
export function connectEvents() {
  if (source) return;
  source = new EventSource("/api/events");
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as unknown;
      for (const handler of handlers.get(type) ?? []) handler(data);
    });
  }
}

export function disconnectEvents() {
  source?.close();
  source = null;
}

export function useEvent<T>(type: string, handler: (data: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const wrapped: Handler = (data) => ref.current(data as T);
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }, [type]);
}
