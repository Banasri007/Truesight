import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, ShieldCheck, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { asEs256PublicJwk, verifyLedger, type LedgerEntry, type LedgerReport } from "truesight-verify";
import { downloadJson, errorMessage, get } from "../api";
import { EASE, ErrorText, PageHeader, short } from "../console/ui";
import { useEvent } from "../events";

const TYPE_TONE: Record<string, string> = {
  "sensor.state_changed": "text-signal",
  "evidence.captured": "text-ember",
  "evidence.redacted": "text-ember",
  "evidence.exported": "text-amber",
  "evidence.viewed": "text-amber",
  "ring.event": "text-verdant",
  "ledger.genesis": "text-signal",
};

function summary(entry: LedgerEntry): string {
  const d = entry.data as Record<string, unknown>;
  switch (entry.type) {
    case "sensor.state_changed":
      return `${String(d.sensorName)}: ${String(d.from)} → ${String(d.to)} · ${Math.round(Number(d.confidence) * 100)}% · ${String(d.trigger)}`;
    case "ring.event":
      return `${String(d.type)}${d.subType ? ` (${String(d.subType)})` : ""} · ${String(d.deviceId ?? "account")} · HMAC verified`;
    case "evidence.captured":
      return `${String(d.evidenceId)} · original ${short(String(d.originalSha256), 12)}`;
    case "evidence.redacted":
      return `${String(d.evidenceId)} · ${(d.regions as unknown[]).length} region(s) → ${short(String(d.redactedSha256), 12)}`;
    case "sensor.created":
    case "sensor.updated":
      return `${String((d.definition as { name?: string })?.name)} · “${String((d.definition as { question?: string })?.question)}”`;
    default:
      return Object.entries(d)
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" · ")
        .slice(0, 160);
  }
}

export function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ entries: LedgerEntry[] }>("/api/ledger?limit=200").then((r) => setEntries(r.entries), (e) => setError(errorMessage(e)));
  }, []);
  useEvent<LedgerEntry>("ledger", (entry) => setEntries((list) => [entry, ...list].slice(0, 500)));

  const verifyAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const [all, signer] = await Promise.all([get<LedgerEntry[]>("/api/ledger/all"), get<{ publicJwk: unknown }>("/api/public/signer")]);
      setReport(await verifyLedger(all, asEs256PublicJwk(signer.publicJwk), { requireGenesis: true }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    const [all, signer] = await Promise.all([get<LedgerEntry[]>("/api/ledger/all"), get<unknown>("/api/public/signer")]);
    downloadJson("truesight-ledger.json", { signer, entries: all });
  };

  return (
    <>
      <PageHeader
        index="05"
        eyebrow="Ledger"
        title={<>The signed <span className="italic text-signal">record.</span></>}
        description="Append-only and hash-chained: each entry carries the hash of the one before it and an ES256 signature. Sensor definitions, Ring webhooks, state changes, evidence, redactions, exports and every view of an original are recorded here."
        actions={
          <>
            <button type="button" className="btn" onClick={exportAll}>
              <Download className="size-4" /> Export
            </button>
            <button type="button" className="btn btn-primary" onClick={verifyAll} disabled={busy}>
              <ShieldCheck className="size-4" /> {busy ? "Verifying…" : "Verify entire ledger"}
            </button>
          </>
        }
      />
      <ErrorText error={error} />

      <AnimatePresence>
        {report && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className={`mb-6 flex items-start gap-4 rounded-xl border px-5 py-4 ${report.ok ? "border-verdant/30 bg-verdant/[0.05]" : "border-ember/30 bg-ember/[0.06]"}`}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${report.ok ? "bg-verdant/15 text-verdant" : "bg-ember/15 text-ember"}`}>
              {report.ok ? <Check className="size-4" strokeWidth={2.5} /> : <X className="size-4" strokeWidth={2.5} />}
            </span>
            <div>
              <div className={`display text-2xl ${report.ok ? "text-verdant" : "text-ember"}`}>{report.ok ? "Ledger intact" : "Ledger problems found"}</div>
              <p className="mt-1 font-mono text-[11.5px] text-mist">
                {report.entries} entries (#{report.firstSeq}–#{report.lastSeq}) · {report.linksChecked} chain links · {report.entries} signatures · checked in your browser
              </p>
              {report.problems.slice(0, 3).map((p) => (
                <p key={p} className="mt-1 text-[12.5px] text-ember">
                  {p}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="panel overflow-hidden">
        <div className="scrollbar-thin max-h-[72vh] overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur">
              <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
                <th className="px-5 py-3 font-normal">#</th>
                <th className="px-3 py-3 font-normal">Time</th>
                <th className="px-3 py-3 font-normal">Type</th>
                <th className="px-3 py-3 font-normal">Summary</th>
                <th className="px-5 py-3 font-normal">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((entry) => (
                <Fragment key={entry.seq}>
                  <tr onClick={() => setOpen(open === entry.seq ? null : entry.seq)} className={`cursor-pointer transition-colors hover:bg-white/[0.02] ${open === entry.seq ? "bg-white/[0.03]" : ""}`}>
                    <td className="px-5 py-3 font-mono text-[12px] text-fog">{entry.seq}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11.5px] text-fog">{new Date(entry.ts).toLocaleTimeString()}</td>
                    <td className={`whitespace-nowrap px-3 py-3 font-mono text-[11.5px] ${TYPE_TONE[entry.type] ?? "text-mist"}`}>{entry.type}</td>
                    <td className="px-3 py-3 text-mist [overflow-wrap:anywhere]">{summary(entry)}</td>
                    <td className="px-5 py-3 font-mono text-[11.5px] text-fog">{short(entry.hash, 10)}</td>
                  </tr>
                  {open === entry.seq && (
                    <tr>
                      <td colSpan={5} className="bg-ink-950/50 px-5 py-4">
                        <pre className="scrollbar-thin max-h-72 overflow-auto font-mono text-[11.5px] leading-relaxed text-mist">{JSON.stringify(entry, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
