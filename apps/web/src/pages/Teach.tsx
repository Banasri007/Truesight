import { motion } from "framer-motion";
import { BellRing, Check, FlaskConical, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { errorMessage, get, post, put } from "../api";
import { EASE, ErrorText, PageHeader, RegionCanvas } from "../console/ui";
import { navigate } from "../lib/route";
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

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="grid gap-6 border-t border-line py-8 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex items-start gap-3">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[11px] ${done ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-fog"}`}>
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <h2 className="pt-0.5 text-[15px] font-medium text-snow">{title}</h2>
      </div>
      <div className="min-w-0">{children}</div>
    </motion.section>
  );
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
  const toggleAlert = (state: string) => set("alertStates", def.alertStates.includes(state) ? def.alertStates.filter((s) => s !== state) : [...def.alertStates, state]);

  const ready = useMemo(() => !!def.deviceId && regionDrawn && def.name.trim() && def.question.trim().length >= 5 && def.states.length >= 2, [def, regionDrawn]);
  const chimeIncomplete = !!def.actions.chime && !def.actions.chime.slotEvent;

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
      navigate("sensors");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        index="02"
        eyebrow="Teach"
        title={editId ? <>Edit <span className="italic text-signal">sensor</span></> : <>Teach a <span className="italic text-signal">sensor</span></>}
        description="Any camera can become any sensor. Draw a box, ask a question, choose the answers that count. Only the box is ever sent to the AI, and privacy zones and faces are pixelated first."
      />

      <Step n={1} title="Pick a camera" done={!!def.deviceId}>
        {cameras.length === 0 && <p className="text-[14px] text-fog">No cameras found. {devices.length === 0 ? "Is the Ring account linked?" : ""}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cameras.map((cam) => {
            const selected = def.deviceId === cam.id;
            return (
              <button
                key={cam.id}
                type="button"
                onClick={() => {
                  set("deviceId", cam.id);
                  if (cam.id !== def.deviceId) setRegionDrawn(false);
                }}
                className={`group overflow-hidden rounded-xl border text-left transition duration-300 ${selected ? "border-signal/60 shadow-[0_0_0_4px_rgb(143_216_255/0.1)]" : "border-line hover:border-line-strong"}`}
              >
                <img src={`/api/devices/${cam.id}/snapshot?t=${nonce}`} alt={cam.name} className="aspect-video w-full object-cover transition duration-700 group-hover:scale-[1.02]" />
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] font-medium">{cam.name}</span>
                  {cam.online === false ? <span className="font-mono text-[10.5px] text-ember">offline</span> : selected && <Check className="size-4 text-signal" />}
                </div>
              </button>
            );
          })}
        </div>
      </Step>

      {camera && (
        <Step n={2} title="Draw the region to watch" done={regionDrawn}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13px] text-fog">{camera.privacyZones.length > 0 ? "Hatched areas are privacy zones. They are pixelated before the AI or any evidence sees them." : "Drag across the frame to draw a box."}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNonce(Date.now())}>
              <RefreshCw className="size-3.5" /> New snapshot
            </button>
          </div>
          <div className="max-w-[920px]">
            <RegionCanvas
              src={`/api/devices/${camera.id}/snapshot?t=${nonce}`}
              rects={regionDrawn ? [def.region] : []}
              zones={camera.privacyZones}
              onChange={(rects) => {
                set("region", roundRect(rects[0]!));
                setRegionDrawn(true);
              }}
              hint={regionDrawn ? `region · ${Math.round(def.region.w * def.region.h * 1000) / 10}% of frame · drag to redraw` : "drag to draw the region"}
            />
          </div>
        </Step>
      )}

      {camera && regionDrawn && (
        <Step n={3} title="Question, answers and actions" done={!!ready}>
          <div className="space-y-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow mr-1">Templates</span>
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" className="chip transition hover:border-signal/50 hover:text-snow" onClick={() => setDef((d) => ({ ...d, name: t.name, question: t.question, states: t.states, alertStates: t.alertStates }))}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="label">
                Name
                <input className="input" value={def.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Side gate" />
              </label>
              <label className="label">
                Question <span className="font-normal text-fog">Plain words. Ask about objects, not people.</span>
                <input className="input" value={def.question} maxLength={300} onChange={(e) => set("question", e.target.value)} placeholder="Is the side gate latched shut, or is it open?" />
              </label>
            </div>

            <div>
              <div className="label mb-2">
                Answers <span className="font-normal text-fog">2–6 labels. Select one to make it an alert state. “unknown” is always allowed, so the AI never has to guess.</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {def.states.map((s) => {
                  const alert = def.alertStates.includes(s);
                  return (
                    <span key={s} className={`inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-[13px] transition ${alert ? "border-ember/50 bg-ember/10 text-ember" : "border-line-strong text-mist"}`}>
                      <button type="button" onClick={() => toggleAlert(s)} className="flex items-center gap-1.5" title="Toggle alert state">
                        {alert && <BellRing className="size-3" />}
                        {s}
                      </button>
                      <button type="button" aria-label={`Remove ${s}`} className="grid size-5 place-items-center rounded-full text-fog hover:bg-white/10 hover:text-snow" onClick={() => setDef((d) => ({ ...d, states: d.states.filter((x) => x !== s), alertStates: d.alertStates.filter((x) => x !== s) }))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
                <input
                  className="input !w-44 !rounded-full !py-1.5"
                  value={stateInput}
                  onChange={(e) => setStateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addState();
                    }
                  }}
                  placeholder="add answer ↵"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="label">
                Check every <span className="font-normal text-fog">minutes, 0 = events only</span>
                <input className="input" type="number" min={0} max={1440} value={def.intervalMinutes} onChange={(e) => set("intervalMinutes", Number(e.target.value))} />
              </label>
              <label className="label">
                Confirmations <span className="font-normal text-fog">before a change counts</span>
                <input className="input" type="number" min={1} max={5} value={def.debounce} onChange={(e) => set("debounce", Number(e.target.value))} />
              </label>
              <label className="label">
                Minimum confidence <span className="font-mono font-normal text-signal">{Math.round(def.minConfidence * 100)}%</span>
                <input className="mt-2 accent-[#8fd8ff]" type="range" min={0.3} max={0.95} step={0.05} value={def.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} />
              </label>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={def.onMotion} onChange={(v) => set("onMotion", v)} label="Check on motion and doorbell press" />
              <Toggle checked={def.actions.notify} onChange={(v) => set("actions", { ...def.actions, notify: v })} label="Notify me on alerts" />
              <Toggle checked={def.enabled} onChange={(v) => set("enabled", v)} label="Enabled" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="label">
                Play a chime on alert
                <select className="input" value={chimeId} onChange={(e) => set("actions", { ...def.actions, chime: e.target.value ? { deviceId: e.target.value, slotEvent: "" } : null })}>
                  <option value="">No chime</option>
                  {chimes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {def.actions.chime && (
                <label className="label">
                  Chime sound
                  <select className="input" value={def.actions.chime.slotEvent} onChange={(e) => set("actions", { ...def.actions, chime: { deviceId: chimeId, slotEvent: e.target.value } })}>
                    <option value="">Choose a sound…</option>
                    {slots
                      .filter((s) => !s.disabled)
                      .map((s) => (
                        <option key={s.event} value={s.event}>
                          {s.name ?? s.event}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {sensors.length > 0 && (
                <div className="label">
                  Corroborating Ring sensors <span className="font-normal text-fog">re-check when they fire</span>
                  <div className="flex flex-col gap-2 pt-1">
                    {sensors.map((s) => (
                      <Toggle key={s.id} checked={def.corroboratingDeviceIds.includes(s.id)} onChange={(v) => set("corroboratingDeviceIds", v ? [...def.corroboratingDeviceIds, s.id] : def.corroboratingDeviceIds.filter((x) => x !== s.id))} label={s.name} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <ErrorText error={error} />
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
              <button type="button" className="btn" onClick={runTest} disabled={!ready || busy !== null}>
                <FlaskConical className="size-4" />
                {busy === "test" ? "Asking the AI…" : "Test on a live snapshot"}
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={!ready || busy !== null || chimeIncomplete}>
                {busy === "save" ? "Saving…" : editId ? "Save changes" : "Create sensor"}
              </button>
              <span className="font-mono text-[11px] text-fog">Saving signs the definition into the ledger.</span>
            </div>

            {test && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="panel grid gap-5 p-5 sm:grid-cols-[minmax(0,240px)_1fr]">
                <div>
                  <img className="w-full rounded-lg border border-line" src={test.aiView} alt="Exactly what the AI saw" />
                  <p className="eyebrow mt-2 !text-[10px]">Exactly what the AI saw</p>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`state ${test.answer.state === "unknown" ? "state-idle" : def.alertStates.includes(test.answer.state) ? "state-alert" : "state-ok"}`}>
                      <span className="size-1.5 rounded-full bg-current" />
                      {test.answer.state}
                    </span>
                    <span className="font-mono text-[12px] text-mist">{Math.round(test.answer.confidence * 100)}% confident</span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-mist">{test.answer.observation}</p>
                  <p className="font-mono text-[11px] leading-relaxed text-fog">
                    {test.regionAreaPct}% of the frame · {test.privacyZonesApplied} privacy zone(s) · {test.facesBlurred} face(s) pixelated · {test.answer.provider} / {test.answer.model}
                  </p>
                  {test.answer.guardrail && <span className="chip border-amber/40 text-amber">guardrail: {test.answer.guardrail}</span>}
                </div>
              </motion.div>
            )}
          </div>
        </Step>
      )}
      {!(camera && regionDrawn) && <ErrorText error={error} />}
    </>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-mist">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full border transition ${checked ? "border-signal/60 bg-signal/25" : "border-line-strong bg-white/5"}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all duration-300 ${checked ? "left-[18px] bg-signal" : "left-0.5 bg-fog"}`} />
      </button>
      {label}
    </label>
  );
}

function roundRect(r: NormRect): NormRect {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const x = round(r.x);
  const y = round(r.y);
  return { x, y, w: Math.min(round(r.w), 1 - x), h: Math.min(round(r.h), 1 - y) };
}
