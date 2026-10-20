import { motion } from "framer-motion";
import { Check, Download, Eye, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { verifyBundle, type BundleReport, type EvidenceBundle } from "truesight-verify";
import { downloadJson, errorMessage, get, post } from "../api";
import { EASE, Empty, ErrorText, PageHeader, short, timeAgo, useTicker } from "../console/ui";
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
      if (download) downloadJson(`truesight-${record.id}.json`, bundle);
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
      <PageHeader
        index="03"
        eyebrow="Evidence"
        title={<>Sealed, <span className="italic text-signal">then</span> redacted.</>}
        description="When a sensor enters an alert state, the triggering frame is hashed and signed before anything touches it. Faces and privacy zones are then pixelated, and the redaction is signed as an edit, with a digest of every untouched pixel."
      />
      <ErrorText error={error} />

      {original && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-6 backdrop-blur-md" onClick={() => setOriginal(null)}>
          <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">Unredacted original · this view was logged</span>
              <button type="button" className="btn btn-sm" onClick={() => setOriginal(null)}>
                <X className="size-3.5" /> Close
              </button>
            </div>
            <img className="w-full rounded-xl border border-line" src={original} alt="Unredacted original" />
          </div>
        </motion.div>
      )}

      {items === null ? (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="panel h-96 animate-pulse" />
          <div className="panel h-96 animate-pulse" />
        </div>
      ) : items.length === 0 ? (
        <Empty title="No evidence yet" body="Evidence is captured automatically when a sensor enters one of its alert states, for example a gate that changes from “latched” to “open”." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {items.map((record, i) => {
            const report = reports[record.id];
            const faces = record.regions.filter((r) => r.kind === "face").length;
            const zones = record.regions.filter((r) => r.kind === "privacy_zone").length;
            return (
              <motion.article key={record.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }} className="panel overflow-hidden">
                <div className="relative">
                  <img className="block aspect-video w-full object-cover" src={`/api/evidence/${record.id}/redacted`} alt={`Redacted evidence ${record.id}`} />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink-950/90 to-transparent p-4 pt-12">
                    <div>
                      <h3 className="text-[16px] font-medium">{record.sensorName}</h3>
                      <p className="font-mono text-[11px] text-mist">
                        {record.deviceName} · {new Date(record.capturedAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="state state-alert">
                      <span className="size-1.5 rounded-full bg-current" />
                      {record.state}
                    </span>
                  </div>
                </div>
                <div className="space-y-4 p-5">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px]">
                    <dt className="text-fog">original</dt>
                    <dd className="truncate text-mist">
                      {short(record.originalSha256, 14)} <span className="text-fog">#{record.capturedSeq}</span>
                    </dd>
                    <dt className="text-fog">redacted</dt>
                    <dd className="truncate text-mist">
                      {short(record.redactedSha256, 14)} <span className="text-fog">#{record.redactedSeq}</span>
                    </dd>
                    <dt className="text-fog">regions</dt>
                    <dd className="text-mist">
                      {faces} face · {zones} zone
                    </dd>
                    <dt className="text-fog">original copy</dt>
                    <dd className="text-mist">{record.purgedAt ? "purged" : `kept · ${timeAgo(record.capturedAt)}`}</dd>
                  </dl>

                  {report && (
                    <div className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] ${report.ok ? "border-verdant/30 bg-verdant/[0.06] text-verdant" : "border-ember/30 bg-ember/[0.06] text-ember"}`}>
                      {report.ok ? <Check className="size-4" /> : <X className="size-4" />}
                      {report.ok ? "Verified" : "Not verified"} · {report.checks.filter((c) => c.ok).length}/{report.checks.length} checks
                      <a href="#/verify" className="ml-auto text-[12px] underline-offset-2 hover:underline">
                        Public verifier →
                      </a>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy === record.id} onClick={() => exportBundle(record, true)}>
                      <Download className="size-3.5" /> Export bundle
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy === record.id} onClick={() => exportBundle(record, false)}>
                      <ShieldCheck className="size-3.5" /> Verify now
                    </button>
                    {!record.purgedAt && (
                      <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => viewOriginal(record)}>
                        <Eye className="size-3.5" /> Original
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
