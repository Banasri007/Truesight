import { motion } from "framer-motion";
import { BellRing, ImageUp, RotateCcw, Waves } from "lucide-react";
import { useEffect, useState } from "react";
import { api, del, errorMessage, get, post } from "../api";
import { EASE, ErrorText, PageHeader } from "../console/ui";
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

  const trigger = (deviceId: string, type: "motion_detected" | "button_press") => post("/api/sim/trigger", { deviceId, type }).catch((e: unknown) => setError(errorMessage(e)));

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
      <PageHeader
        index="07"
        eyebrow="Simulator"
        title={<>A Ring account, <span className="italic text-signal">simulated.</span></>}
        description={
          <>
            Three cameras, a chime and a gate contact sensor. Changing a scene sends signed <code className="font-mono text-[13px] text-signal">motion_detected</code> and <code className="font-mono text-[13px] text-signal">contact_sensor_*</code> webhooks to TrueSight, exactly as Ring does. Upload your own photo to test face pixelation.
          </>
        }
        actions={
          <label className="flex cursor-pointer items-center gap-2.5 rounded-full border border-line px-4 py-2 text-[13px] text-mist">
            <input type="checkbox" className="accent-[#8fd8ff]" checked={autoMotion} onChange={(e) => setAutoMotion(e.target.checked)} />
            Send motion when a scene changes
          </label>
        }
      />
      <ErrorText error={error} />
      {state && (
        <div className="grid gap-5 lg:grid-cols-3">
          {CAMERAS.map((cam, i) => {
            const scene = state.scenes[cam.id] ?? {};
            const custom = state.customFrames.includes(cam.id);
            return (
              <motion.article key={cam.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: i * 0.07, ease: EASE }} className="panel overflow-hidden">
                <div className="relative">
                  <img className="block aspect-video w-full object-cover" src={`/api/devices/${cam.id}/snapshot?t=${nonce}`} alt={cam.name} />
                  {custom && <span className="absolute right-3 top-3 rounded-md bg-ink-950/70 px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-signal">CUSTOM PHOTO</span>}
                </div>
                <div className="space-y-4 p-5">
                  <h3 className="text-[16px] font-medium">{cam.name}</h3>
                  <div className="space-y-2.5">
                    {cam.controls.map((control) =>
                      control.options ? (
                        <div key={control.key} className="flex items-center justify-between gap-3">
                          <span className="text-[13.5px] text-mist">{control.label}</span>
                          <div className="flex gap-1 rounded-full border border-line p-0.5">
                            {control.options.map((option) => (
                              <button
                                key={option}
                                type="button"
                                disabled={custom}
                                onClick={() => patch(cam.id, { [control.key]: option })}
                                className={`rounded-full px-3 py-1 text-[12.5px] transition ${scene[control.key] === option ? "bg-snow text-ink-950" : "text-fog hover:text-snow"} disabled:opacity-40`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <label key={control.key} className="flex cursor-pointer items-center justify-between gap-3 text-[13.5px] text-mist">
                          {control.label}
                          <input type="checkbox" className="size-4 accent-[#8fd8ff]" checked={!!scene[control.key]} disabled={custom} onChange={(e) => patch(cam.id, { [control.key]: e.target.checked })} />
                        </label>
                      ),
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                    <button type="button" className="btn btn-sm" onClick={() => trigger(cam.id, "motion_detected")}>
                      <Waves className="size-3.5" /> Motion
                    </button>
                    {cam.id === "sim-cam-front" && (
                      <button type="button" className="btn btn-sm" onClick={() => trigger(cam.id, "button_press")}>
                        <BellRing className="size-3.5" /> Doorbell
                      </button>
                    )}
                    <label className="btn btn-ghost btn-sm cursor-pointer">
                      <ImageUp className="size-3.5" /> Photo
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
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          del<SimState>(`/api/sim/frame/${cam.id}`).then((s) => {
                            setState(s);
                            setNonce(Date.now());
                          })
                        }
                      >
                        <RotateCcw className="size-3.5" /> Drawn scene
                      </button>
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </>
  );
}
