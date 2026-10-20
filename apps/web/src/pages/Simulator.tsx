import { useEffect, useState } from "react";
import { api, del, errorMessage, get, post } from "../api";
import { ErrorText } from "../components";
import { useEvent } from "../events";
import type { SimState } from "../types";

const CAMERAS: { id: string; name: string; controls: { key: string; label: string; options?: [string, string] }[] }[] = [
  {
    id: "sim-cam-front",
    name: "Front Door",
    controls: [
      { key: "package", label: "Package on porch" },
      { key: "person", label: "Person at door" },
      { key: "night", label: "Night" },
    ],
  },
  {
    id: "sim-cam-side",
    name: "Side Yard",
    controls: [
      { key: "gate", label: "Gate", options: ["closed", "open"] },
      { key: "bins", label: "Bins", options: ["yard", "curb"] },
      { key: "night", label: "Night" },
    ],
  },
  {
    id: "sim-cam-driveway",
    name: "Driveway",
    controls: [
      { key: "garageDoor", label: "Garage door", options: ["closed", "open"] },
      { key: "car", label: "Car in driveway" },
      { key: "night", label: "Night" },
    ],
  },
];

/**
 * A stand-in Ring account. Every change sends an HMAC-signed webhook in Ring's
 * format to this server, so the full pipeline runs exactly as with real devices.
 */
export function SimulatorPage() {
  const [state, setState] = useState<SimState | null>(null);
  const [autoMotion, setAutoMotion] = useState(true);
  const [nonce, setNonce] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<SimState>("/api/sim/state").then(setState, (e) => setError(errorMessage(e)));
  }, []);
  useEvent<SimState>("sim", (s) => {
    setState(s);
    setNonce(Date.now());
  });

  const patch = async (deviceId: string, change: Record<string, string | boolean>) => {
    setError(null);
    try {
      setState(await post<SimState>(`/api/sim/scene/${deviceId}`, { patch: change, autoMotion }));
      setNonce(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const trigger = (deviceId: string, type: "motion_detected" | "button_press") =>
    post("/api/sim/trigger", { deviceId, type }).catch((e: unknown) => setError(errorMessage(e)));

  const upload = async (deviceId: string, file: File) => {
    try {
      setState(await api<SimState>(`/api/sim/frame/${deviceId}`, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } }));
      setNonce(Date.now());
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ring simulator</h1>
          <p>
            A simulated Ring account with three cameras, a chime and a gate contact sensor. Changing a scene sends signed <code>motion_detected</code> and
            <code> contact_sensor_*</code> webhooks to Witness, exactly like Ring does. Upload your own photo to test face pixelation.
          </p>
        </div>
        <label className="check">
          <input type="checkbox" checked={autoMotion} onChange={(e) => setAutoMotion(e.target.checked)} /> Send a motion event when a scene changes
        </label>
      </div>
      <ErrorText error={error} />
      {state && (
        <div className="grid grid-3">
          {CAMERAS.map((cam) => {
            const scene = state.scenes[cam.id] ?? {};
            const custom = state.customFrames.includes(cam.id);
            return (
              <div key={cam.id} className="card">
                <img className="img-frame" style={{ borderRadius: "12px 12px 0 0", border: 0 }} src={`/api/devices/${cam.id}/snapshot?t=${nonce}`} alt={cam.name} />
                <div className="card-body stack" style={{ gap: 10 }}>
                  <div className="row between">
                    <h3>{cam.name}</h3>
                    {custom && <span className="badge accent">custom photo</span>}
                  </div>
                  {cam.controls.map((control) =>
                    control.options ? (
                      <div key={control.key} className="row between">
                        <span>{control.label}</span>
                        <div className="row" style={{ gap: 4 }}>
                          {control.options.map((option) => (
                            <button
                              key={option}
                              className={scene[control.key] === option ? "primary" : ""}
                              onClick={() => patch(cam.id, { [control.key]: option })}
                              disabled={custom}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <label key={control.key} className="check">
                        <input type="checkbox" checked={!!scene[control.key]} disabled={custom} onChange={(e) => patch(cam.id, { [control.key]: e.target.checked })} />
                        {control.label}
                      </label>
                    ),
                  )}
                  <div className="actions">
                    <button onClick={() => trigger(cam.id, "motion_detected")}>Motion</button>
                    {cam.id === "sim-cam-front" && <button onClick={() => trigger(cam.id, "button_press")}>🔔 Press doorbell</button>}
                    <label className="btn">
                      Upload photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void upload(cam.id, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {custom && (
                      <button className="ghost" onClick={() => del<SimState>(`/api/sim/frame/${cam.id}`).then((s) => { setState(s); setNonce(Date.now()); })}>
                        Use drawn scene
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
