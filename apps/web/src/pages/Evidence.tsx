import { useEffect, useState } from "react";
import { verifyBundle, type BundleReport, type EvidenceBundle } from "witness-verify";
import { downloadJson, errorMessage, get, post } from "../api";
import { ErrorText, short, timeAgo, useTicker } from "../components";
import { useEvent } from "../events";
import type { EvidenceRecord } from "../types";

export function EvidencePage() {
  useTicker(15_000);
  const [items, setItems] = useState<EvidenceRecord[] | null>(null);
  const [reports, setReports] = useState<Record<string, BundleReport>>({});
  const [original, setOriginal] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<EvidenceRecord[]>("/api/evidence").then(setItems, (e) => setError(errorMessage(e)));
  }, []);
  useEvent<EvidenceRecord>("evidence", (r) => setItems((list) => [r, ...(list ?? []).filter((x) => x.id !== r.id)]));

  const exportBundle = async (record: EvidenceRecord, download: boolean) => {
    setBusy(record.id);
    setError(null);
    try {
      const bundle = await post<EvidenceBundle>(`/api/evidence/${record.id}/export`);
      const report = await verifyBundle(bundle);
      setReports((r) => ({ ...r, [record.id]: report }));
      if (download) downloadJson(`witness-${record.id}.json`, bundle);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const viewOriginal = (record: EvidenceRecord) => {
    if (!confirm("Viewing the unredacted original is recorded in the signed ledger. Continue?")) return;
    setOriginal(`/api/evidence/${record.id}/original?t=${Date.now()}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Evidence</h1>
          <p>
            When a sensor enters an alert state, the triggering frame is hashed and signed <em>before</em> anything touches it. Faces and privacy zones are then
            pixelated, and the redaction is signed as an edit with a digest of every untouched pixel. Export a bundle and anyone can verify it, without seeing the original.
          </p>
        </div>
      </div>
      <ErrorText error={error} />

      {original && (
        <div className="card card-body stack" style={{ marginBottom: 16 }}>
          <div className="row between">
            <strong>Unredacted original (access logged)</strong>
            <button onClick={() => setOriginal(null)}>Close</button>
          </div>
          <img className="img-frame" src={original} alt="Unredacted original" />
        </div>
      )}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card empty">
          <h2>No evidence yet</h2>
          <p>Evidence is captured automatically when a sensor enters one of its alert states, for example a gate that changes from “latched” to “open”.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {items.map((record) => {
            const report = reports[record.id];
            return (
              <div key={record.id} className="card">
                <img className="img-frame" style={{ borderRadius: "12px 12px 0 0", border: 0 }} src={`/api/evidence/${record.id}/redacted`} alt={`Redacted evidence ${record.id}`} />
                <div className="card-body stack" style={{ gap: 8 }}>
                  <div className="row between">
                    <h3>{record.sensorName}</h3>
                    <span className="pill alert"><span className="dot" />{record.state}</span>
                  </div>
                  <div className="small muted">
                    {record.deviceName} · {new Date(record.capturedAt).toLocaleString()} ({timeAgo(record.capturedAt)})
                  </div>
                  <div className="small">
                    <span className="badge">{record.regions.filter((r) => r.kind === "face").length} face(s)</span>{" "}
                    <span className="badge">{record.regions.filter((r) => r.kind === "privacy_zone").length} privacy zone(s)</span>{" "}
                    {record.clip && <span className="badge ok">clip attached</span>}{" "}
                    {record.purgedAt ? <span className="badge">original purged</span> : <span className="badge">original kept until retention</span>}
                  </div>
                  <div className="small mono muted">
                    original {short(record.originalSha256, 16)} · ledger #{record.capturedSeq}
                    <br />
                    redacted {short(record.redactedSha256, 16)} · ledger #{record.redactedSeq}
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={busy === record.id} onClick={() => exportBundle(record, true)}>
                      ⬇ Export bundle
                    </button>
                    <button disabled={busy === record.id} onClick={() => exportBundle(record, false)}>
                      Verify now
                    </button>
                    {!record.purgedAt && (
                      <button className="ghost" onClick={() => viewOriginal(record)}>
                        View original
                      </button>
                    )}
                  </div>
                  {report && (
                    <div className={`callout ${report.ok ? "" : "warn"}`}>
                      {report.ok ? "✔ Verified: " : "✘ Not verified: "}
                      {report.checks.filter((c) => c.ok).length}/{report.checks.length} checks passed.{" "}
                      <a href="#/verify">Open the public verifier →</a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
