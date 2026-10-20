import { motion } from "framer-motion";
import { Eraser, Save, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LedgerEntry } from "truesight-verify";
import { errorMessage, get, put } from "../api";
import { EASE, ErrorText, PageHeader, RegionCanvas, SnapshotUnavailable, Stat, short, timeAgo, useSnapshot, useTicker } from "../console/ui";
import { useEvent } from "../events";
import type { Device, NormRect, PrivacyReceipt, Status } from "../types";

const ACCESS_TYPES = new Set(["evidence.viewed", "evidence.exported", "evidence.purged", "privacy.zones_updated"]);

export function PrivacyPage({ status }: { status: Status | null }) {
  useTicker(15_000);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [zones, setZones] = useState<NormRect[]>([]);
  const [dirty, setDirty] = useState(false);
  const [receipts, setReceipts] = useState<PrivacyReceipt[]>([]);
  const [access, setAccess] = useState<LedgerEntry[]>([]);
  const [nonce] = useState(() => Date.now());
  const snapshot = useSnapshot(deviceId || null, nonce);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Device[]>("/api/devices").then(
      (list) => {
        setDevices(list);
        const first = list.find((d) => d.kind === "camera");
        if (first) {
          setDeviceId(first.id);
          setZones(first.privacyZones);
        }
      },
      (e) => setError(errorMessage(e)),
    );
    get<PrivacyReceipt[]>("/api/receipts?limit=100").then(setReceipts, () => undefined);
    get<{ entries: LedgerEntry[] }>("/api/ledger?limit=500").then((r) => setAccess(r.entries.filter((e) => ACCESS_TYPES.has(e.type))), () => undefined);
  }, []);

  useEvent<PrivacyReceipt>("receipt", (r) => setReceipts((list) => [r, ...list].slice(0, 100)));
  useEvent<LedgerEntry>("ledger", (e) => {
    if (ACCESS_TYPES.has(e.type)) setAccess((list) => [e, ...list]);
  });

  const cameras = devices.filter((d) => d.kind === "camera");

  const saveZones = async () => {
    try {
      await put(`/api/devices/${deviceId}/privacy-zones`, zones);
      setDevices((list) => list.map((d) => (d.id === deviceId ? { ...d, privacyZones: zones } : d)));
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        index="04"
        eyebrow="Privacy"
        title={<>Privacy you can <span className="italic text-signal">see.</span></>}
        description="TrueSight sends the AI only the box you drew, never the whole frame. Privacy zones and faces are pixelated first, frames are discarded after each check, and every view of an original is logged."
      />
      <ErrorText error={error} />

      <div className="mb-10 grid grid-cols-2 gap-y-5 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="AI receives" value="your region only" />
        <Stat label="Faces" value={status?.faceDetector === "amazon-rekognition" ? "detected · pixelated" : "use privacy zones"} />
        <Stat label="Frames kept" value="alert evidence only" />
        <Stat label="Original retention" value={`${status?.retentionDays ?? "—"} days, then purged`} />
        <Stat label="Evidence store" value={status?.blobs ?? "—"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="panel min-w-0">
          <div className="panel-head">
            <h2 className="text-[14px] font-medium">Privacy receipts</h2>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-fog">one per AI check</span>
          </div>
          <div className="scrollbar-thin max-h-[72vh] overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
                <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
                  <th className="px-5 py-3 font-normal">When</th>
                  <th className="px-3 py-3 font-normal">Sensor</th>
                  <th className="px-3 py-3 font-normal">What the AI saw</th>
                  <th className="px-3 py-3 font-normal">Answer</th>
                  <th className="px-5 py-3 font-normal">Kept</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {receipts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-fog">
                      No checks yet.
                    </td>
                  </tr>
                )}
                {receipts.map((r) => (
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <div className="text-mist">{timeAgo(r.at)}</div>
                      <div className="font-mono text-[10.5px] text-fog">{r.trigger}</div>
                    </td>
                    <td className="px-3 py-3.5 text-snow">{r.sensorName}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full bg-signal" style={{ width: `${Math.max(2, r.regionAreaPct)}%` }} />
                        </div>
                        <span className="font-mono text-[11.5px] text-mist">{r.regionAreaPct}%</span>
                      </div>
                      <div className="mt-1 font-mono text-[10.5px] text-fog">
                        {r.privacyZonesApplied} zone · {r.facesBlurred} face · {r.provider} · sent {short(r.aiViewSha256, 8)}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-mist">{r.state}</span> <span className="font-mono text-[11px] text-fog">{Math.round(r.confidence * 100)}%</span>
                      {r.guardrail && <div className="mt-1 font-mono text-[10.5px] text-amber" title={r.guardrail}>guardrail fired</div>}
                    </td>
                    <td className="px-5 py-3.5">{r.retainedAsEvidence ? <span className="font-mono text-[11px] text-ember">evidence</span> : <span className="font-mono text-[11px] text-verdant">discarded</span>}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section className="panel space-y-4 p-5">
            <div>
              <h2 className="text-[14px] font-medium">Privacy zones</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-fog">Draw over a neighbor's windows, the sidewalk, or anything that must never reach the AI or an evidence file. Changes are signed into the ledger.</p>
            </div>
            <select
              className="input"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setZones(devices.find((d) => d.id === e.target.value)?.privacyZones ?? []);
                setDirty(false);
              }}
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {deviceId && !snapshot.url && <SnapshotUnavailable error={snapshot.error} loading={snapshot.loading} />}
            {deviceId && snapshot.url && (
              <RegionCanvas
                src={snapshot.url}
                rects={zones}
                multiple
                color="#ffffff"
                onChange={(next) => {
                  setZones(next);
                  setDirty(true);
                }}
                hint={`${zones.length} zone(s) · drag to add`}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={!dirty} onClick={saveZones}>
                <Save className="size-3.5" /> Save zones
              </button>
              <button type="button" className="btn btn-sm" disabled={zones.length === 0} onClick={() => { setZones(zones.slice(0, -1)); setDirty(true); }}>
                <Undo2 className="size-3.5" /> Undo
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={zones.length === 0} onClick={() => { setZones([]); setDirty(true); }}>
                <Eraser className="size-3.5" /> Clear
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="text-[14px] font-medium">Access log</h2>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-fog">signed</span>
            </div>
            <ol className="scrollbar-thin max-h-80 divide-y divide-line overflow-auto">
              {access.length === 0 && <li className="px-5 py-6 text-[13px] text-fog">Nobody has viewed or exported evidence yet.</li>}
              {access.map((e) => {
                const d = e.data as { evidenceId?: string; deviceId?: string; variant?: string };
                return (
                  <li key={e.seq} className="flex items-baseline justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <span className="text-[13px] text-mist">{e.type.replace("evidence.", "").replace("privacy.", "").replace("_", " ")}</span>{" "}
                      <span className="font-mono text-[11px] text-fog">{d.evidenceId ?? d.deviceId ?? ""}{d.variant ? ` · ${d.variant}` : ""}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[10.5px] text-fog">#{e.seq} · {timeAgo(e.ts)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
