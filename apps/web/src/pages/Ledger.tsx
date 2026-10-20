import { Fragment, useEffect, useState } from "react";
import { asEs256PublicJwk, verifyLedger, type LedgerEntry, type LedgerReport } from "witness-verify";
import { downloadJson, errorMessage, get } from "../api";
import { ErrorText, short } from "../components";
import { useEvent } from "../events";

const TYPE_STYLE: Record<string, string> = {
  "sensor.state_changed": "accent",
  "evidence.captured": "alert",
  "evidence.redacted": "alert",
  "evidence.exported": "warn",
  "evidence.viewed": "warn",
  "evidence.purged": "",
  "ring.event": "ok",
  "ledger.genesis": "accent",
};

function summary(entry: LedgerEntry): string {
  const d = entry.data as Record<string, unknown>;
  switch (entry.type) {
    case "sensor.state_changed":
      return `${String(d.sensorName)}: ${String(d.from)} → ${String(d.to)} (${Math.round(Number(d.confidence) * 100)}%, ${String(d.trigger)})`;
    case "ring.event":
      return `${String(d.type)}${d.subType ? ` (${String(d.subType)})` : ""} from ${String(d.deviceId ?? "account")}, HMAC verified`;
    case "evidence.captured":
      return `${String(d.evidenceId)}: original ${short(String(d.originalSha256), 12)}`;
    case "evidence.redacted":
      return `${String(d.evidenceId)}: ${(d.regions as unknown[]).length} region(s) redacted → ${short(String(d.redactedSha256), 12)}`;
    case "sensor.created":
    case "sensor.updated":
      return `${String((d.definition as { name?: string })?.name)}: “${String((d.definition as { question?: string })?.question)}”`;
    default:
      return Object.entries(d)
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" · ")
        .slice(0, 140);
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
    downloadJson("witness-ledger.json", { signer, entries: all });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Signed ledger</h1>
          <p>
            Append-only and hash-chained: each entry includes the hash of the one before it and is signed with ES256. Sensor definitions, Ring webhooks, state
            changes, evidence, redactions, exports and every view of an original are recorded here.
          </p>
        </div>
        <div className="row">
          <button onClick={exportAll}>⬇ Export</button>
          <button className="primary" onClick={verifyAll} disabled={busy}>
            {busy ? "Verifying…" : "Verify entire ledger"}
          </button>
        </div>
      </div>
      <ErrorText error={error} />
      {report && (
        <div className={`verdict ${report.ok ? "ok" : "bad"}`} style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 26 }}>{report.ok ? "✔" : "✘"}</span>
          <div>
            {report.ok ? "Ledger intact" : "Ledger problems found"}
            <div className="small" style={{ fontWeight: 500 }}>
              {report.entries} entries (#{report.firstSeq}–#{report.lastSeq}), {report.linksChecked} chain links and {report.entries} signatures checked in your browser.
              {report.problems.slice(0, 3).map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Type</th>
              <th>Summary</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <Fragment key={entry.seq}>
                <tr onClick={() => setOpen(open === entry.seq ? null : entry.seq)} style={{ cursor: "pointer" }}>
                  <td className="mono">{entry.seq}</td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{new Date(entry.ts).toLocaleTimeString()}</td>
                  <td>
                    <span className={`badge ${TYPE_STYLE[entry.type] ?? ""}`}>{entry.type}</span>
                  </td>
                  <td>{summary(entry)}</td>
                  <td className="mono muted">{short(entry.hash, 10)}</td>
                </tr>
                {open === entry.seq && (
                  <tr>
                    <td colSpan={5}>
                      <pre className="json">{JSON.stringify(entry, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
