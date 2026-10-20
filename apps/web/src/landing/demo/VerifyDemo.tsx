import { motion, useInView } from "framer-motion";
import { Check, Download, RotateCcw, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { base64Decode, base64Encode, verifyBundle, type BundleReport, type EvidenceBundle } from "truesight-verify";
import { downloadJson } from "../../api";
import { makeSampleBundle } from "./sample";

/**
 * Generates a real signed bundle in the browser, then runs the open-source
 * verifier on it. "Flip one byte" edits the image and verifies again.
 */
export function VerifyDemo() {
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root, { once: true, amount: 0.35 });
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [report, setReport] = useState<BundleReport | null>(null);
  const [tampered, setTampered] = useState(false);
  const [run, setRun] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inView || bundle) return;
    makeSampleBundle()
      .then(async (b) => {
        setBundle(b);
        setReport(await verifyBundle(b));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [inView, bundle]);

  const toggleTamper = async () => {
    if (!bundle) return;
    if (tampered) {
      setTampered(false);
      setReport(await verifyBundle(bundle));
    } else {
      const copy = structuredClone(bundle);
      const asset = copy.assets[0]!;
      const bytes = base64Decode(asset.dataBase64);
      const i = Math.floor(bytes.length * 0.55);
      bytes[i] = (bytes[i] ?? 0) ^ 0x01;
      asset.dataBase64 = base64Encode(bytes);
      setTampered(true);
      setReport(await verifyBundle(copy));
    }
    setRun((r) => r + 1);
  };

  const passed = report?.checks.filter((c) => c.ok).length ?? 0;
  const total = report?.checks.length ?? 11;

  return (
    <div ref={root} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <ol className="divide-y divide-line border-y border-line">
        {(report?.checks ?? Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, label: "Preparing a fresh bundle…", ok: true }))).map((check, i) => (
          <motion.li
            key={`${run}-${check.id}`}
            initial={{ opacity: 0, x: -10 }}
            animate={report ? { opacity: 1, x: 0 } : { opacity: 0.25, x: 0 }}
            transition={{ duration: 0.45, delay: report ? i * 0.07 : 0, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-4 py-3"
          >
            <span className="w-6 font-mono text-[11px] text-fog">{String(i + 1).padStart(2, "0")}</span>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full ${!report ? "bg-white/5" : check.ok ? "bg-verdant/15 text-verdant" : "bg-ember/15 text-ember"}`}>
              {report && (check.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />)}
            </span>
            <span className={`text-[14px] ${report && !check.ok ? "text-ember" : "text-mist"}`}>{check.label}</span>
          </motion.li>
        ))}
      </ol>

      <div className="flex flex-col gap-4">
        <div className="panel p-5">
          <div className="eyebrow">Live result</div>
          <div className={`display mt-2 text-5xl ${!report ? "text-fog" : report.ok ? "text-verdant" : "text-ember"}`}>
            {passed}
            <span className="text-fog">/{total}</span>
          </div>
          <p className="mt-2 text-[13px] text-mist">
            {!report ? "Generating a key and signing a bundle in your browser…" : report.ok ? "Authentic and unmodified." : "Tampering detected. The bundle no longer verifies."}
          </p>
          {error && <p className="mt-2 text-[12.5px] text-ember">{error}</p>}
        </div>
        <button type="button" className="btn" disabled={!bundle} onClick={() => void toggleTamper()}>
          {tampered ? <RotateCcw className="size-3.5" /> : <Zap className="size-3.5" />}
          {tampered ? "Restore the original bytes" : "Flip one byte of the image"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={!bundle} onClick={() => bundle && downloadJson("truesight-sample-bundle.json", bundle)}>
          <Download className="size-3.5" /> Download this bundle
        </button>
        <a href="#/verify" className="text-[12.5px] text-signal hover:underline">
          Open the standalone verifier →
        </a>
      </div>
    </div>
  );
}
