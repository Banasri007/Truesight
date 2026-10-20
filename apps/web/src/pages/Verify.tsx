import { useEffect, useRef, useState } from "react";
import { base64Decode, base64Encode, verifyBundle, type BundleReport, type EvidenceBundle } from "witness-verify";

/**
 * Public verifier. Runs entirely in the browser with WebCrypto: the bundle
 * never leaves this page, and no Witness account is needed.
 */
export function VerifyPage() {
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [report, setReport] = useState<BundleReport | null>(null);
  const [tampered, setTampered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (b: EvidenceBundle) => {
    setReport(await verifyBundle(b));
    const asset = b.assets?.[0];
    if (asset) {
      setImageUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(new Blob([base64Decode(asset.dataBase64).slice().buffer], { type: asset.mediaType }));
      });
    }
  };

  const load = async (file: File) => {
    setError(null);
    setTampered(false);
    try {
      const parsed = JSON.parse(await file.text()) as EvidenceBundle;
      setBundle(parsed);
      await run(parsed);
    } catch (e) {
      setBundle(null);
      setReport(null);
      setError(`Could not read that file: ${(e as Error).message}`);
    }
  };

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  /** Flip one pixel outside the redaction and re-verify, to show what tampering looks like. */
  const toggleTamper = async () => {
    if (!bundle) return;
    if (tampered) {
      setTampered(false);
      await run(bundle);
      return;
    }
    const copy = structuredClone(bundle);
    const asset = copy.assets[0];
    if (!asset) return;
    const bytes = base64Decode(asset.dataBase64);
    const index = Math.floor(bytes.length * 0.6);
    bytes[index] = (bytes[index] ?? 0) ^ 0x01;
    asset.dataBase64 = base64Encode(bytes);
    setTampered(true);
    await run(copy);
  };

  const subject = report?.subject;
  const regions = bundle?.ledger.find((e) => e.type === "evidence.redacted" && e.data.evidenceId === subject?.evidenceId)?.data.regions as
    | { x: number; y: number; w: number; h: number; kind?: string }[]
    | undefined;
  const asset = bundle?.assets?.[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Verify an evidence bundle</h1>
          <p>Drop a Witness bundle (.json). Verification runs in your browser with WebCrypto: nothing is uploaded, and you don't need an account.</p>
        </div>
      </div>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void load(file);
        }}
      >
        <strong>Drop a bundle here</strong> or click to choose a file
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="error-text">{error}</p>}

      {report && (
        <div className="split" style={{ marginTop: 20 }}>
          <div className="stack">
            <div className={`verdict ${report.ok ? "ok" : "bad"}`}>
              <span style={{ fontSize: 28 }}>{report.ok ? "✔" : "✘"}</span>
              <div>
                {report.ok ? "Authentic and unmodified" : "Verification failed"}
                <div className="small" style={{ fontWeight: 500 }}>
                  {report.checks.filter((c) => c.ok).length} of {report.checks.length} checks passed{tampered ? " · tamper demo active" : ""}
                </div>
              </div>
            </div>
            <div className="card card-body">
              <ul className="checks">
                {report.checks.map((check) => (
                  <li key={check.id}>
                    <span className={`icon ${check.ok ? "ok" : "bad"}`}>{check.ok ? "✔" : "✘"}</span>
                    <div>
                      {check.label}
                      {check.detail && <div className="small muted mono">{check.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {bundle && (
              <details className="card card-body">
                <summary>Signed ledger excerpt ({bundle.ledger.length} entries)</summary>
                {bundle.ledger.map((entry) => (
                  <div key={entry.seq} style={{ marginTop: 10 }}>
                    <span className="badge accent">#{entry.seq}</span> <strong>{entry.type}</strong> <span className="small muted">{new Date(entry.ts).toLocaleString()}</span>
                    <pre className="json">{JSON.stringify(entry.data, null, 2)}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>

          <div className="stack">
            {imageUrl && asset && (
              <div className="card">
                <div style={{ position: "relative" }}>
                  <img className="img-frame" style={{ borderRadius: "12px 12px 0 0", border: 0 }} src={imageUrl} alt="Redacted evidence" />
                  {regions && asset.width && asset.height && (
                    <svg viewBox={`0 0 ${asset.width} ${asset.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                      {regions.map((r, i) => (
                        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={r.kind === "face" ? "#ffb020" : "#fff"} strokeWidth={4} strokeDasharray="10 6" />
                      ))}
                    </svg>
                  )}
                </div>
                <div className="card-body small muted">Dashed boxes are the declared redactions. Every other pixel is proven identical to the original.</div>
              </div>
            )}
            {subject && (
              <div className="card card-body stack small" style={{ gap: 4 }}>
                <strong>{subject.sensorName}: {subject.state}</strong>
                {subject.question && <span className="muted">“{subject.question}”</span>}
                <span>Camera: {subject.deviceName}</span>
                {subject.capturedAt && <span>Captured: {new Date(subject.capturedAt).toLocaleString()}</span>}
                <span className="mono muted">Signer: {report.signerKid}</span>
              </div>
            )}
            <button onClick={toggleTamper} disabled={!bundle}>
              {tampered ? "↺ Restore original bundle" : "⚠ Tamper demo: flip one byte of the image"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
