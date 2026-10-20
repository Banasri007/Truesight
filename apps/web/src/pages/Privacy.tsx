import { useEffect, useState } from "react";
import type { LedgerEntry } from "witness-verify";
import { errorMessage, get, put } from "../api";
import { ErrorText, RegionCanvas, short, timeAgo, useTicker } from "../components";
import { useEvent } from "../events";
import type { Device, NormRect, PrivacyReceipt, Status } from "../types";

const ACCESS_TYPES = new Set(["evidence.viewed", "evidence.exported", "evidence.purged", "privacy.zones_updated"]);

export function PrivacyPage({ status }: { status: Status | null }) {
  useTicker(15_000);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [zones, setZones] = useState<NormRect[]>([]);
  const [dirty, setDirty] = useState(false);
  const [receipts, setReceipts] = useState<PrivacyReceipt[]>([]);
  const [access, setAccess] = useState<LedgerEntry[]>([]);
  const [nonce] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Device[]>("/api/devices").then((list) => {
      setDevices(list);
      const first = list.find((d) => d.kind === "camera");
      if (first) {
        setDeviceId(first.id);
        setZones(first.privacyZones);
      }
    }, (e) => setError(errorMessage(e)));
    get<PrivacyReceipt[]>("/api/receipts?limit=100").then(setReceipts, () => undefined);
    get<{ entries: LedgerEntry[] }>("/api/ledger?limit=500").then((r) => setAccess(r.entries.filter((e) => ACCESS_TYPES.has(e.type))), () => undefined);
  }, []);

  useEvent<PrivacyReceipt>("receipt", (r) => setReceipts((list) => [r, ...list].slice(0, 100)));
  useEvent<LedgerEntry>("ledger", (e) => ACCESS_TYPES.has(e.type) && setAccess((list) => [e, ...list]));

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
      <div className="page-head">
        <div>
          <h1>Privacy you can see</h1>
          <p>Witness sends the AI only the box you drew, never the whole frame. Privacy zones and faces are pixelated first, frames are thrown away after each check, and every look at an original is logged.</p>
        </div>
      </div>
      <ErrorText error={error} />

      <div className="strip">
        <div className="stat"><div className="label">AI sees</div><div className="value">Only your sensor's region</div></div>
        <div className="stat"><div className="label">Face handling</div><div className="value">{status?.faceDetector === "amazon-rekognition" ? "Detected & pixelated (no recognition)" : "Use privacy zones (no detector)"}</div></div>
        <div className="stat"><div className="label">Frames kept</div><div className="value">Only alert evidence</div></div>
        <div className="stat"><div className="label">Original retention</div><div className="value">{status?.retentionDays ?? "—"} days, then purged</div></div>
        <div className="stat"><div className="label">Evidence storage</div><div className="value" title={status?.blobs}>{status?.blobs ?? "—"}</div></div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head">
            <h2>Privacy receipts</h2>
            <span className="small muted">one per AI check</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Sensor</th>
                  <th>What the AI saw</th>
                  <th>Answer</th>
                  <th>Kept?</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">No checks yet.</td>
                  </tr>
                )}
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="small" style={{ whiteSpace: "nowrap" }}>
                      {timeAgo(r.at)}
                      <div className="muted">{r.trigger}</div>
                    </td>
                    <td>{r.sensorName}</td>
                    <td className="small">
                      {r.regionAreaPct}% of a {r.frameSize.width}×{r.frameSize.height} frame
                      <div className="muted">
                        {r.privacyZonesApplied} zone(s) · {r.facesBlurred} face(s) pixelated · {r.provider}
                      </div>
                      <div className="mono muted" title={r.aiViewSha256}>sent {short(r.aiViewSha256, 12)}</div>
                    </td>
                    <td className="small">
                      {r.state} ({Math.round(r.confidence * 100)}%)
                      {r.guardrail && <div><span className="badge warn" title={r.guardrail}>guardrail</span></div>}
                    </td>
                    <td className="small">{r.retainedAsEvidence ? <span className="badge alert">evidence</span> : <span className="badge ok">discarded</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card card-body stack">
            <h2>Privacy zones</h2>
            <p className="small muted" style={{ margin: 0 }}>Draw over neighbors' windows, the sidewalk, or anything that should never reach the AI or an evidence file. Changes are recorded in the ledger.</p>
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setZones(devices.find((d) => d.id === e.target.value)?.privacyZones ?? []);
                setDirty(false);
              }}
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {deviceId && (
              <RegionCanvas
                src={`/api/devices/${deviceId}/snapshot?t=${nonce}`}
                rects={zones}
                multiple
                color="#ffffff"
                onChange={(next) => {
                  setZones(next);
                  setDirty(true);
                }}
                hint="Drag to add a zone"
              />
            )}
            <div className="row">
              <button className="primary" disabled={!dirty} onClick={saveZones}>Save zones</button>
              <button disabled={zones.length === 0} onClick={() => { setZones(zones.slice(0, -1)); setDirty(true); }}>Undo last</button>
              <button className="ghost" disabled={zones.length === 0} onClick={() => { setZones([]); setDirty(true); }}>Clear</button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Access log</h2></div>
            <div className="feed" style={{ maxHeight: 320 }}>
              {access.length === 0 && <div className="feed-item muted">Nobody has viewed or exported evidence yet.</div>}
              {access.map((e) => (
                <div key={e.seq} className="feed-item">
                  <span className="badge warn">{e.type.replace("evidence.", "").replace("privacy.", "")}</span>{" "}
                  {String((e.data as { evidenceId?: string; deviceId?: string }).evidenceId ?? (e.data as { deviceId?: string }).deviceId ?? "")}
                  {(e.data as { variant?: string }).variant ? ` (${String((e.data as { variant?: string }).variant)})` : ""}
                  <div className="t">ledger #{e.seq} · {timeAgo(e.ts)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
