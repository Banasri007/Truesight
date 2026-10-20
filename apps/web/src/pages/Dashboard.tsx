import { useEffect, useState } from "react";
import { del, errorMessage, get, post } from "../api";
import { StatePill, short, timeAgo, useTicker } from "../components";
import { useEvent } from "../events";
import type { Device, Notification, RingEventRecord, Sensor, Status } from "../types";

interface FeedItem {
  id: string;
  at: string;
  text: string;
  kind: "alert" | "resolved" | "ring" | "info" | "error";
}

export function Dashboard({ status }: { status: Status | null }) {
  useTicker();
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Sensor[]>("/api/sensors").then(setSensors, (e) => setError(errorMessage(e)));
    get<Device[]>("/api/devices").then(setDevices, () => undefined);
    get<RingEventRecord[]>("/api/ring-events?limit=15").then(
      (events) => setFeed(events.map(ringItem)),
      () => undefined,
    );
  }, []);

  useEvent<Sensor>("sensor", (s) => setSensors((list) => (list ? (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]) : [s])));
  useEvent<{ id: string }>("sensor-deleted", ({ id }) => setSensors((list) => list?.filter((s) => s.id !== id) ?? null));
  useEvent<RingEventRecord>("ring-event", (e) => setFeed((f) => [ringItem(e), ...f].slice(0, 40)));
  useEvent<Notification>("notification", (n) => {
    const item: FeedItem = { id: n.id, at: n.at, text: `${n.title}: ${n.body}`, kind: n.level };
    setFeed((f) => [item, ...f].slice(0, 40));
  });

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id;

  const checkNow = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await post(`/api/sensors/${id}/check`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sensor: Sensor) => {
    if (!confirm(`Delete "${sensor.name}"? Its history stays in the ledger.`)) return;
    await del(`/api/sensors/${sensor.id}`).catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Virtual sensors</h1>
          <p>Each sensor is a question you taught one of your cameras. Answers are debounced, and every state change is signed into the ledger.</p>
        </div>
        <a className="btn primary" href="#/teach">＋ Teach a sensor</a>
      </div>

      {status && (
        <div className="strip">
          <Stat label="Ring" value={status.ringMode === "simulator" ? "Simulator" : status.ring.linked ? "Linked" : "Not linked"} />
          <Stat label="Perception" value={`${status.vision.provider} · ${status.vision.model}`} />
          <Stat label="Faces" value={status.faceDetector === "none" ? "No detector (zones only)" : status.faceDetector} />
          <Stat label="Signer" value={short(status.signer.kid, 22)} />
          <Stat label="Ledger head" value={`#${status.ledger.headSeq} · ${short(status.ledger.headHash, 8)}`} />
        </div>
      )}

      {status?.ringMode === "api" && !status.ring.linked && (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          No Ring account is linked yet. <a href="/auth/ring/start">Connect Ring</a> (partner-initiated), or start the link from the Ring app (one-way linking).
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="split">
        <div>
          {sensors === null ? (
            <p className="muted">Loading…</p>
          ) : sensors.length === 0 ? (
            <div className="card empty">
              <h2>Teach your first sensor</h2>
              <p>Pick a camera, draw a box around something you care about, and ask a question in plain words, like "Is the side gate latched?"</p>
              <a className="btn primary" href="#/teach">Start teaching</a>
            </div>
          ) : (
            <div className="grid grid-2">
              {sensors.map((sensor) => {
                const alerting = !!sensor.current && sensor.alertStates.includes(sensor.current.state);
                return (
                  <div key={sensor.id} className={`card sensor-card ${alerting ? "alerting" : ""}`}>
                    <img
                      className="thumb"
                      alt={`What the AI saw for ${sensor.name}`}
                      title="The only pixels the AI saw on the latest check"
                      src={sensor.last ? `/api/sensors/${sensor.id}/ai-view?t=${encodeURIComponent(sensor.last.checkedAt)}` : undefined}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="row between">
                        <h3>{sensor.name}</h3>
                        <StatePill sensor={sensor} />
                      </div>
                      <div className="q">
                        {deviceName(sensor.deviceId)} · “{sensor.question}”
                      </div>
                      <div className="row small muted">
                        {sensor.current && <span>since {timeAgo(sensor.current.since)}</span>}
                        {sensor.last && <span>· checked {timeAgo(sensor.last.checkedAt)} ({Math.round(sensor.last.confidence * 100)}%)</span>}
                        {!sensor.enabled && <span className="badge">paused</span>}
                      </div>
                      {sensor.pending && (
                        <div style={{ marginTop: 6 }}>
                          <span className="badge warn">
                            confirming “{sensor.pending.state}” {sensor.pending.count}/{sensor.debounce}
                          </span>
                        </div>
                      )}
                      {sensor.last && <div className="obs">{sensor.last.observation}</div>}
                      {sensor.lastError && <div className="error-text small">⚠ {sensor.lastError}</div>}
                      <div className="actions">
                        <button onClick={() => checkNow(sensor.id)} disabled={busy === sensor.id}>
                          {busy === sensor.id ? "Checking…" : "Check now"}
                        </button>
                        <a className="btn" href={`#/teach/${sensor.id}`}>Edit</a>
                        <button className="ghost danger" onClick={() => remove(sensor)}>Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Live activity</h2>
            <span className="badge accent">live</span>
          </div>
          <div className="feed">
            {feed.length === 0 && <div className="feed-item muted">Waiting for Ring events…</div>}
            {feed.map((item) => (
              <div key={item.id} className="feed-item">
                <span className={`badge ${item.kind === "alert" ? "alert" : item.kind === "resolved" ? "ok" : item.kind === "error" ? "warn" : ""}`}>{item.kind}</span>{" "}
                {item.text}
                <div className="t">{timeAgo(item.at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ringItem(e: RingEventRecord): FeedItem {
  return {
    id: e.id,
    at: e.receivedAt,
    kind: "ring",
    text: `${e.type.replace(/_/g, " ")}${e.subType ? ` (${e.subType})` : ""} on ${e.deviceId ?? "account"} · ledger #${e.ledgerSeq}`,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" title={value}>{value}</div>
    </div>
  );
}
