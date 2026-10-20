import { motion } from "framer-motion";
import { Check, FileJson, RotateCcw, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { base64Decode, base64Encode, verifyBundle, type BundleReport, type EvidenceBundle } from "truesight-verify";
import { EASE, PageHeader } from "../console/ui";

/**
 * Public verifier. Runs entirely in the browser with WebCrypto: the bundle
 * never leaves this page, and no TrueSight account is needed.
 */
export function VerifyPage() {
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [report, setReport] = useState<BundleReport | null>(null);
  const [tampered, setTampered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const verify = async (b: EvidenceBundle) => {
    setReport(await verifyBundle(b));
    setRun((r) => r + 1);
    const asset = b.assets?.[0];
    if (asset) setImageUrl(URL.createObjectURL(new Blob([base64Decode(asset.dataBase64).slice().buffer], { type: asset.mediaType })));
  };

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const load = async (file: File) => {
    setError(null);
    setTampered(false);
    try {
      const parsed = JSON.parse(await file.text()) as EvidenceBundle;
      setBundle(parsed);
      await verify(parsed);
    } catch (e) {
      setBundle(null);
      setReport(null);
      setError(`Could not read that file: ${(e as Error).message}`);
    }
  };

  const toggleTamper = async () => {
    if (!bundle) return;
    if (tampered) {
      setTampered(false);
      return verify(bundle);
    }
    const copy = structuredClone(bundle);
    const asset = copy.assets[0];
    if (!asset) return;
    const bytes = base64Decode(asset.dataBase64);
    const index = Math.floor(bytes.length * 0.6);
    bytes[index] = (bytes[index] ?? 0) ^ 0x01;
    asset.dataBase64 = base64Encode(bytes);
    setTampered(true);
    await verify(copy);
  };

  const subject = report?.subject;
  const regions = bundle?.ledger.find((e) => e.type === "evidence.redacted" && e.data.evidenceId === subject?.evidenceId)?.data.regions as
    | { x: number; y: number; w: number; h: number; kind?: string }[]
    | undefined;
  const asset = bundle?.assets?.[0];
  const passed = report?.checks.filter((c) => c.ok).length ?? 0;

  return (
    <>
      <PageHeader
        index="06"
        eyebrow="Verify"
        title={<>Check a bundle. <span className="italic text-signal">No account.</span></>}
        description="Drop a TrueSight evidence bundle (.json). Verification runs in your browser with WebCrypto, so nothing is uploaded. Try the sample bundle from the landing page, or one exported from the console."
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
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
        className={`grid cursor-pointer place-items-center rounded-2xl border border-dashed px-6 py-14 text-center transition duration-300 ${over ? "border-signal bg-signal/[0.06]" : "border-line-strong bg-ink-900/40 hover:border-signal/50"}`}
      >
        <FileJson className="mb-4 size-7 text-signal" strokeWidth={1.5} />
        <p className="text-[15px] text-snow">Drop a bundle here, or click to choose a file</p>
        <p className="mt-1 font-mono text-[11px] text-fog">truesight.bundle/1 · verified locally · nothing leaves this page</p>
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
      {error && <p className="mt-4 text-[13px] text-ember">{error}</p>}

      {report && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <motion.div key={run} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className={`flex items-center gap-5 rounded-2xl border px-6 py-5 ${report.ok ? "border-verdant/30 bg-verdant/[0.05]" : "border-ember/30 bg-ember/[0.06]"}`}>
              <div className={`display text-6xl leading-none ${report.ok ? "text-verdant" : "text-ember"}`}>
                {passed}
                <span className="text-fog">/{report.checks.length}</span>
              </div>
              <div>
                <div className={`display text-2xl ${report.ok ? "text-verdant" : "text-ember"}`}>{report.ok ? "Authentic and unmodified" : "Verification failed"}</div>
                <p className="mt-1 font-mono text-[11px] text-fog">{tampered ? "tamper demo active · one byte flipped" : `signer ${report.signerKid ?? "unknown"}`}</p>
              </div>
            </motion.div>

            <ol className="panel divide-y divide-line">
              {report.checks.map((check, i) => (
                <motion.li key={`${run}-${check.id}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }} className="flex items-start gap-4 px-5 py-3.5">
                  <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${check.ok ? "bg-verdant/15 text-verdant" : "bg-ember/15 text-ember"}`}>
                    {check.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-[14px] ${check.ok ? "text-mist" : "text-ember"}`}>{check.label}</p>
                    {check.detail && <p className="mt-0.5 truncate font-mono text-[11px] text-fog">{check.detail}</p>}
                  </div>
                </motion.li>
              ))}
            </ol>

            {bundle && (
              <details className="panel group p-5">
                <summary className="cursor-pointer list-none text-[14px] font-medium text-mist group-open:text-snow">Signed ledger excerpt · {bundle.ledger.length} entries</summary>
                <div className="mt-4 space-y-4">
                  {bundle.ledger.map((entry) => (
                    <div key={entry.seq}>
                      <p className="font-mono text-[11.5px]">
                        <span className="text-signal">#{entry.seq}</span> <span className="text-snow">{entry.type}</span> <span className="text-fog">· {new Date(entry.ts).toLocaleString()}</span>
                      </p>
                      <pre className="scrollbar-thin mt-1.5 max-h-48 overflow-auto rounded-lg bg-ink-950/60 p-3 font-mono text-[11px] leading-relaxed text-mist">{JSON.stringify(entry.data, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="space-y-5">
            {imageUrl && asset && (
              <figure className="panel overflow-hidden">
                <div className="relative">
                  <img className="block w-full" src={imageUrl} alt="Redacted evidence" />
                  {regions && asset.width && asset.height && (
                    <svg viewBox={`0 0 ${asset.width} ${asset.height}`} className="absolute inset-0 h-full w-full">
                      {regions.map((r, i) => (
                        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={r.kind === "face" ? "#f3c46b" : "#ffffff"} strokeWidth={Math.max(2, (asset.width ?? 640) / 320)} strokeDasharray="8 6" />
                      ))}
                    </svg>
                  )}
                </div>
                <figcaption className="p-4 text-[12.5px] leading-relaxed text-fog">Dashed boxes are the declared redactions. Every other pixel is proven identical to the signed original.</figcaption>
              </figure>
            )}
            {subject && (
              <div className="panel space-y-1.5 p-5 text-[13px]">
                <p className="text-[15px] font-medium text-snow">
                  {subject.sensorName}: <span className="text-ember">{subject.state}</span>
                </p>
                {subject.question && <p className="text-fog">“{subject.question}”</p>}
                <p className="text-mist">Camera · {subject.deviceName}</p>
                {subject.capturedAt && <p className="text-mist">Captured · {new Date(subject.capturedAt).toLocaleString()}</p>}
              </div>
            )}
            <button type="button" className="btn w-full" onClick={() => void toggleTamper()} disabled={!bundle}>
              {tampered ? <RotateCcw className="size-4" /> : <Zap className="size-4" />}
              {tampered ? "Restore the original bundle" : "Tamper demo: flip one byte of the image"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
