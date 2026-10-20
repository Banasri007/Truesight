import { useEffect, useMemo, useState } from "react";
import { errorMessage, get, post, put } from "../api";
import { navigate } from "../App";
import { ErrorText, RegionCanvas } from "../components";
import type { ChimeSlot, Device, NormRect, Sensor, SensorDefinition } from "../types";

const TEMPLATES: { label: string; name: string; question: string; states: string[]; alertStates: string[] }[] = [
  { label: "Gate latched?", name: "Side gate", question: "Is the gate latched shut, or is it open?", states: ["latched", "open"], alertStates: ["open"] },
  { label: "Garage door", name: "Garage door", question: "Is the garage door open or closed?", states: ["closed", "open"], alertStates: ["open"] },
  { label: "Bins at the curb", name: "Trash bins", question: "Are the trash bins out at the curb, or back in the yard?", states: ["in yard", "at curb"], alertStates: [] },
  { label: "Package on porch", name: "Porch package", question: "Is there a package or box sitting on the porch?", states: ["none", "present"], alertStates: ["present"] },
  { label: "Someone at the door", name: "Visitor", question: "Is a person standing at the front door?", states: ["clear", "present"], alertStates: [] },
];

const EMPTY: SensorDefinition = {
  name: "",
  deviceId: "",
  question: "",
  region: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
  states: [],
  alertStates: [],
  intervalMinutes: 15,
  onMotion: true,
  debounce: 2,
  minConfidence: 0.6,
  actions: { notify: true, chime: null },
  corroboratingDeviceIds: [],
  enabled: true,
};

interface TestResult {
  answer: { state: string; confidence: number; observation: string; provider: string; model: string; guardrail: string | null };
  aiView: string;
  facesBlurred: number;
  privacyZonesApplied: number;
  regionAreaPct: number;
}

export function Teach({ editId }: { editId: string | null }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [def, setDef] = useState<SensorDefinition>(EMPTY);
  const [regionDrawn, setRegionDrawn] = useState(false);
  const [stateInput, setStateInput] = useState("");
  const [slots, setSlots] = useState<ChimeSlot[]>([]);
  const [nonce, setNonce] = useState(() => Date.now());
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Device[]>("/api/devices").then(setDevices, (e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!editId) {
      setDef(EMPTY);
      setRegionDrawn(false);
      return;
    }
    get<Sensor[]>("/api/sensors").then((list) => {
      const s = list.find((x) => x.id === editId);
      if (!s) return setError("Sensor not found");
      const { name, deviceId, question, region, states, alertStates, intervalMinutes, onMotion, debounce, minConfidence, actions, corroboratingDeviceIds, enabled } = s;
      setDef({ name, deviceId, question, region, states, alertStates, intervalMinutes, onMotion, debounce, minConfidence, actions, corroboratingDeviceIds, enabled });
      setRegionDrawn(true);
    });
  }, [editId]);

  const cameras = devices.filter((d) => d.kind === "camera");
  const chimes = devices.filter((d) => d.kind === "chime");
  const sensors = devices.filter((d) => d.kind === "sensor");
  const camera = devices.find((d) => d.id === def.deviceId);
  const chimeId = def.actions.chime?.deviceId ?? "";

  useEffect(() => {
    if (!chimeId) return setSlots([]);
    get<ChimeSlot[]>(`/api/devices/${chimeId}/chime-slots`).then(setSlots, () => setSlots([]));
  }, [chimeId]);

  const set = <K extends keyof SensorDefinition>(key: K, value: SensorDefinition[K]) => {
    setDef((d) => ({ ...d, [key]: value }));
    setTest(null);
  };

  const addState = () => {
    const label = stateInput.trim().toLowerCase();
    if (!label || def.states.includes(label) || def.states.length >= 6) return;
    set("states", [...def.states, label]);
    setStateInput("");
  };

  const toggleAlert = (state: string) =>
    set("alertStates", def.alertStates.includes(state) ? def.alertStates.filter((s) => s !== state) : [...def.alertStates, state]);

  const step = !def.deviceId ? 1 : !regionDrawn ? 2 : 3;
  const ready = useMemo(() => !!def.deviceId && regionDrawn && def.name.trim() && def.question.trim().length >= 5 && def.states.length >= 2, [def, regionDrawn]);

  const runTest = async () => {
    setBusy("test");
    setError(null);
    try {
      setTest(await post<TestResult>("/api/sensors/test", def));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      if (editId) await put(`/api/sensors/${editId}`, def);
      else await post("/api/sensors", def);
      navigate("dashboard");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{editId ? "Edit sensor" : "Teach a sensor"}</h1>
          <p>Any camera can become any sensor. Draw a box, ask a question, choose the answers that count. Only the box is ever sent to the AI, with privacy zones and faces pixelated first.</p>
        </div>
      </div>
      <div className="steps">
        <span className={`step ${step === 1 ? "active" : ""}`}>1 · Camera</span>
        <span className={`step ${step === 2 ? "active" : ""}`}>2 · Region</span>
        <span className={`step ${step === 3 ? "active" : ""}`}>3 · Question &amp; actions</span>
      </div>

      <section className="stack" style={{ marginBottom: 22 }}>
        <h2>1. Pick a camera</h2>
        {cameras.length === 0 && <p className="muted">No cameras found. {devices.length === 0 ? "Is the Ring account linked?" : ""}</p>}
        <div className="grid grid-3">
          {cameras.map((cam) => (
            <button
              key={cam.id}
              className={`card camera-pick ${def.deviceId === cam.id ? "selected" : ""}`}
              onClick={() => {
                set("deviceId", cam.id);
                if (cam.id !== def.deviceId) setRegionDrawn(false);
              }}
            >
              <img src={`/api/devices/${cam.id}/snapshot?t=${nonce}`} alt={cam.name} />
              <span>
                <strong>{cam.name}</strong> {cam.online === false && <span className="badge alert">offline</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      {camera && (
        <section className="stack" style={{ marginBottom: 22 }}>
          <div className="row between">
            <h2>2. Draw the region to watch</h2>
            <button className="ghost" onClick={() => setNonce(Date.now())}>↻ New snapshot</button>
          </div>
          <div style={{ maxWidth: 900 }}>
            <RegionCanvas
              src={`/api/devices/${camera.id}/snapshot?t=${nonce}`}
              rects={regionDrawn ? [def.region] : []}
              zones={camera.privacyZones}
              onChange={(rects) => {
                set("region", roundRect(rects[0]!));
                setRegionDrawn(true);
              }}
              hint={regionDrawn ? "Drag again to redraw" : "Drag to draw a box around what the sensor should watch"}
            />
          </div>
          {camera.privacyZones.length > 0 && <p className="small muted">Hatched areas are privacy zones: they are pixelated before any AI or evidence sees them.</p>}
        </section>
      )}

      {camera && regionDrawn && (
        <section className="card card-body stack">
          <h2>3. Question, answers and actions</h2>
          <div className="row">
            <span className="small muted">Start from a template:</span>
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="ghost"
                onClick={() => setDef((d) => ({ ...d, name: t.name, question: t.question, states: t.states, alertStates: t.alertStates }))}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">
              Name
              <input value={def.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Side gate" />
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              Question <span className="hint">Plain words. Ask about objects, not people.</span>
              <input value={def.question} maxLength={300} onChange={(e) => set("question", e.target.value)} placeholder="Is the side gate latched shut, or is it open?" />
            </label>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <strong className="small">Answers (2–6). Click an answer to make it an alert state.</strong>
            <div className="row">
              {def.states.map((s) => (
                <span key={s} className={`chip ${def.alertStates.includes(s) ? "on" : ""}`}>
                  <span style={{ cursor: "pointer" }} onClick={() => toggleAlert(s)} title="Toggle alert">
                    {def.alertStates.includes(s) ? "🚨 " : ""}
                    {s}
                  </span>
                  <button aria-label={`Remove ${s}`} onClick={() => setDef((d) => ({ ...d, states: d.states.filter((x) => x !== s), alertStates: d.alertStates.filter((x) => x !== s) }))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                style={{ width: 160 }}
                value={stateInput}
                onChange={(e) => setStateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addState();
                  }
                }}
                placeholder="add answer + Enter"
              />
            </div>
            <span className="small muted">“unknown” is always allowed, so the AI never has to guess.</span>
          </div>

          <div className="form-grid">
            <label className="field">
              Check every <span className="hint">minutes (0 = only on events)</span>
              <input type="number" min={0} max={1440} value={def.intervalMinutes} onChange={(e) => set("intervalMinutes", Number(e.target.value))} />
            </label>
            <label className="field">
              Confirmations needed <span className="hint">before a state change counts</span>
              <input type="number" min={1} max={5} value={def.debounce} onChange={(e) => set("debounce", Number(e.target.value))} />
            </label>
            <label className="field">
              Minimum confidence <span className="hint">{Math.round(def.minConfidence * 100)}%</span>
              <input type="range" min={0.3} max={0.95} step={0.05} value={def.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} />
            </label>
          </div>

          <div className="row">
            <label className="check">
              <input type="checkbox" checked={def.onMotion} onChange={(e) => set("onMotion", e.target.checked)} /> Check on motion / doorbell press
            </label>
            <label className="check">
              <input type="checkbox" checked={def.actions.notify} onChange={(e) => set("actions", { ...def.actions, notify: e.target.checked })} /> Notify me on alerts
            </label>
            <label className="check">
              <input type="checkbox" checked={def.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              Play a chime on alert
              <select
                value={chimeId}
                onChange={(e) => set("actions", { ...def.actions, chime: e.target.value ? { deviceId: e.target.value, slotEvent: "" } : null })}
              >
                <option value="">No chime</option>
                {chimes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            {def.actions.chime && (
              <label className="field">
                Chime sound
                <select value={def.actions.chime.slotEvent} onChange={(e) => set("actions", { ...def.actions, chime: { deviceId: chimeId, slotEvent: e.target.value } })}>
                  <option value="">Choose a sound…</option>
                  {slots.filter((s) => !s.disabled).map((s) => (
                    <option key={s.event} value={s.event}>{s.name ?? s.event}</option>
                  ))}
                </select>
              </label>
            )}
            {sensors.length > 0 && (
              <div className="field">
                <span>Corroborating Ring sensors <span className="hint">re-check when they fire</span></span>
                {sensors.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={def.corroboratingDeviceIds.includes(s.id)}
                      onChange={(e) =>
                        set("corroboratingDeviceIds", e.target.checked ? [...def.corroboratingDeviceIds, s.id] : def.corroboratingDeviceIds.filter((x) => x !== s.id))
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <ErrorText error={error} />
          <div className="row">
            <button onClick={runTest} disabled={!ready || busy !== null}>{busy === "test" ? "Asking the AI…" : "Test on a live snapshot"}</button>
            <button className="primary" onClick={save} disabled={!ready || busy !== null || (!!def.actions.chime && !def.actions.chime.slotEvent)}>
              {busy === "save" ? "Saving…" : editId ? "Save changes" : "Create sensor"}
            </button>
            <span className="small muted">Saving writes the definition into the signed ledger.</span>
          </div>

          {test && (
            <div className="card card-body" style={{ display: "grid", gridTemplateColumns: "minmax(0, 260px) 1fr", gap: 16 }}>
              <img className="img-frame" src={test.aiView} alt="Exactly what the AI saw" />
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <strong>Answer:</strong>
                  <span className={`pill ${test.answer.state === "unknown" ? "unknown" : def.alertStates.includes(test.answer.state) ? "alert" : "ok"}`}>
                    <span className="dot" />
                    {test.answer.state}
                  </span>
                  <span className="muted">{Math.round(test.answer.confidence * 100)}% confident</span>
                </div>
                <div className="muted">{test.answer.observation}</div>
                <div className="small muted">
                  The AI saw {test.regionAreaPct}% of the frame · {test.privacyZonesApplied} privacy zone(s) and {test.facesBlurred} face(s) pixelated · {test.answer.provider} / {test.answer.model}
                </div>
                {test.answer.guardrail && <div className="badge warn">guardrail: {test.answer.guardrail}</div>}
              </div>
            </div>
          )}
        </section>
      )}
      {!(camera && regionDrawn) && <ErrorText error={error} />}
    </>
  );
}

function roundRect(r: NormRect): NormRect {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const x = round(r.x);
  const y = round(r.y);
  return { x, y, w: Math.min(round(r.w), 1 - x), h: Math.min(round(r.h), 1 - y) };
}
