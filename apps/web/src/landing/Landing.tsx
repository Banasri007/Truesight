import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, ExternalLink, Move3d, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark, Wordmark } from "../components/Logo";
import { ChainDemo } from "./demo/ChainDemo";
import { PrivacyDemo } from "./demo/PrivacyDemo";
import { TeachDemo } from "./demo/TeachDemo";
import { Telemetry } from "./demo/Telemetry";
import { VerifyDemo } from "./demo/VerifyDemo";
import { EASE, Magnetic, Reveal, RevealItem } from "./motion";
import { FINISHES, HOTSPOTS, live, ui, useUi, type FinishId, type HotspotId } from "./scene/store";

gsap.registerPlugin(ScrollTrigger);

const Scene = lazy(() => import("./scene/Scene"));

const REPO = "https://github.com/Banasri007/Truesight";

const NAV: { label: string; section: number }[] = [
  { label: "Teach", section: 1 },
  { label: "Privacy", section: 2 },
  { label: "Proof", section: 3 },
  { label: "Verify", section: 4 },
  { label: "Signal", section: 5 },
];

const SWATCH: Record<FinishId, string> = {
  graphite: "linear-gradient(135deg,#4a525f,#1b1f26)",
  satin: "linear-gradient(135deg,#e3e7ec,#7e8793)",
  pearl: "linear-gradient(135deg,#fffdf8,#cfc8bc)",
};

const HOTSPOT_ORDER: HotspotId[] = ["lens", "motion", "light", "core"];

const STACK: [string, string][] = [
  ["Ring Partner API", "Webhooks, snapshots, clips, event history, chimes and sensors."],
  ["Claude", "Answers each question from the cropped region, as structured JSON limited to your labels."],
  ["Amazon Bedrock", "Optional. Keeps inference inside your own AWS account and region."],
  ["AWS KMS", "Signs every ledger entry and bundle with ES256. The private key never leaves KMS."],
  ["Amazon DynamoDB", "Append-only ledger. A sequence number can never be overwritten."],
  ["Amazon S3 Object Lock", "Write-once storage for evidence originals until their retention date."],
  ["Amazon Rekognition", "Finds face locations to pixelate. It is never used to identify anyone."],
  ["truesight-verify", "MIT-licensed verifier for browsers and Node. Anyone can check a bundle offline."],
];

export default function Landing() {
  const reduced = !!useReducedMotion();
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [loaderDone, setLoaderDone] = useState(false);
  const focus = useUi((s) => s.focus);
  const finish = useUi((s) => s.finish);
  const ready = useUi((s) => s.ready);

  // Scroll choreography: each section's arrival advances the device one keyframe.
  useEffect(() => {
    live.reduced = reduced;
    const contributions = new Array<number>(sections.current.length).fill(0);
    const ctx = gsap.context(() => {
      sections.current.forEach((el, i) => {
        if (!el || i === 0) return;
        ScrollTrigger.create({
          trigger: el,
          start: "top bottom",
          end: "top top",
          onUpdate: (self) => {
            contributions[i] = self.progress;
            const stage = contributions.reduce((a, b) => a + b, 0);
            live.stage = stage;
            if (stage > 0.3 && ui.get().focus) ui.set({ focus: null });
            const index = Math.round(stage);
            setActive((prev) => (prev === index ? prev : index));
          },
        });
      });
      if (!reduced) {
        gsap.to("[data-hero-copy]", {
          yPercent: -14,
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: sections.current[0], start: "top top", end: "bottom top", scrub: true },
        });
        gsap.fromTo(
          "[data-finale]",
          { scale: 0.92, opacity: 0.15 },
          { scale: 1, opacity: 1, ease: "none", scrollTrigger: { trigger: "[data-finale]", start: "top bottom", end: "center 60%", scrub: true } },
        );
      }
    });
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      ctx.revert();
      window.removeEventListener("scroll", onScroll);
      live.stage = 0;
      ui.set({ focus: null });
    };
  }, [reduced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ui.set({ focus: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Elegant loader: wait for the first WebGL frame, but never longer than 3s.
  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setLoaderDone(true), 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLoaderDone(true), 3000);
    return () => clearTimeout(t);
  }, [ready]);

  const scrollTo = (i: number) => sections.current[i]?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  const register = (i: number) => (el: HTMLElement | null) => {
    sections.current[i] = el;
  };

  const focusIndex = focus ? HOTSPOT_ORDER.indexOf(focus) : -1;
  const stepFocus = (d: number) => ui.set({ focus: HOTSPOT_ORDER[(focusIndex + d + HOTSPOT_ORDER.length) % HOTSPOT_ORDER.length]! });

  return (
    <div className="relative bg-ink-950 text-snow">
      {/* Atmosphere + WebGL layer */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_72%_45%,rgb(58_155_255/0.13),transparent_70%),radial-gradient(ellipse_50%_40%_at_20%_100%,rgb(143_216_255/0.06),transparent_70%)]" />
        <div className="grid-texture absolute inset-0 [mask-image:radial-gradient(ellipse_80%_70%_at_60%_40%,#000_10%,transparent_75%)]" />
      </div>
      <div className={`fixed inset-0 z-0 transition-opacity duration-700 ${reduced && active > 0 ? "opacity-0" : active > 0 ? "max-md:opacity-30" : ""}`}>
        <Suspense fallback={<Poster />}>
          <Scene reduced={reduced} />
        </Suspense>
      </div>

      {/* Loader */}
      <AnimatePresence>
        {!loaderDone && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink-950" exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: EASE }}>
            <div className="text-center">
              <LogoMark size={44} className="mx-auto text-snow" />
              <div className="display mt-4 text-3xl">
                True<span className="italic text-signal">Sight</span>
              </div>
              <div className="mx-auto mt-6 h-px w-48 overflow-hidden bg-line">
                <motion.div className="h-full bg-signal" initial={{ width: "0%" }} animate={{ width: ready ? "100%" : "72%" }} transition={{ duration: ready ? 0.35 : 2.4, ease: EASE }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <header className={`fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-500 ${scrolled ? "border-line bg-ink-950/85 backdrop-blur-xl" : "border-transparent"}`}>
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6 md:px-12">
          <a href="#/" aria-label="TrueSight home" onClick={(e) => (e.preventDefault(), scrollTo(0))}>
            <Wordmark />
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
            {NAV.map((n) => (
              <button key={n.label} type="button" onClick={() => scrollTo(n.section)} className={`relative rounded-full px-3.5 py-2 text-[13px] transition-colors ${active === n.section ? "text-snow" : "text-fog hover:text-mist"}`}>
                {n.label}
                {active === n.section && <motion.span layoutId="nav-indicator" className="absolute -bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-signal" transition={{ duration: 0.4, ease: EASE }} />}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="#/verify" className="btn btn-ghost btn-sm hidden sm:inline-flex">Verify</a>
            <Magnetic href="#/sensors" className="btn btn-primary btn-sm">
              Open console <ArrowRight className="size-3.5" />
            </Magnetic>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* 00 · Hero */}
        <section ref={register(0)} className="pointer-events-none relative flex min-h-[100svh] items-center">
          <div data-hero-copy className="mx-auto w-full max-w-[1440px] px-6 pt-[46svh] md:px-12 md:pt-0">
            <AnimatePresence mode="wait">
              {!focus ? (
                <motion.div key="copy" exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.4, ease: EASE }} className="pointer-events-auto max-w-[600px]">
                  <Reveal immediate>
                    <RevealItem>
                      <p className="eyebrow mb-6 flex items-center gap-3">
                        <span className="h-px w-8 bg-signal/60" /> TrueSight · for Ring cameras
                      </p>
                    </RevealItem>
                    <RevealItem>
                      <h1 className="display text-[clamp(3.1rem,7.2vw,6.6rem)] leading-[0.94]">
                        See what matters.
                        <br />
                        <span className="italic text-signal">Prove</span> what happened.
                      </h1>
                    </RevealItem>
                    <RevealItem>
                      <p className="mt-7 max-w-[30rem] text-[17px] leading-relaxed text-mist">
                        Teach any Ring camera a question in plain words. TrueSight answers it with Claude and seals every alert as signed, privacy-redacted evidence. Anyone can verify it, without seeing what you chose to hide.
                      </p>
                    </RevealItem>
                    <RevealItem>
                      <div className="mt-9 flex flex-wrap items-center gap-3">
                        <Magnetic href="#/sensors" className="btn btn-primary px-5 py-2.5">
                          Open the console <ArrowRight className="size-4" />
                        </Magnetic>
                        <Magnetic onClick={() => scrollTo(1)} className="btn px-5 py-2.5">
                          Watch it work <ArrowDown className="size-4" />
                        </Magnetic>
                      </div>
                    </RevealItem>
                    <RevealItem>
                      <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
                        <span>Claude perception</span>
                        <span className="text-line-strong">/</span>
                        <span>ES256 ledger</span>
                        <span className="text-line-strong">/</span>
                        <span>Region-only AI</span>
                      </div>
                    </RevealItem>
                  </Reveal>
                </motion.div>
              ) : (
                <FocusPanel key={focus} id={focus} onClose={() => ui.set({ focus: null })} onStep={stepFocus} />
              )}
            </AnimatePresence>
          </div>

          <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[1440px] items-end justify-between gap-6 px-6 pb-7 md:px-12">
            <button type="button" onClick={() => scrollTo(1)} className="pointer-events-auto hidden items-center gap-3 text-fog transition-colors hover:text-snow md:flex">
              <span className="relative h-10 w-px overflow-hidden bg-line">
                <span className="absolute inset-x-0 top-0 h-1/2 animate-[slide-y_2.2s_ease-in-out_infinite] bg-signal" />
              </span>
              <span className="eyebrow">Scroll</span>
            </button>
            <div className="pointer-events-auto ml-auto flex flex-col items-end gap-3">
              <div className="flex items-center gap-3 rounded-full border border-line bg-ink-950/50 py-1.5 pl-4 pr-2 backdrop-blur-md">
                <span className="eyebrow">Finish</span>
                <span className="w-24 font-mono text-[11.5px] text-mist">{FINISHES[finish].label}</span>
                {(Object.keys(FINISHES) as FinishId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`${FINISHES[id].label} finish`}
                    aria-pressed={finish === id}
                    onClick={() => ui.set({ finish: id })}
                    className={`size-6 rounded-full border border-white/20 transition duration-300 ${finish === id ? "scale-110 ring-1 ring-signal ring-offset-2 ring-offset-ink-950" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: SWATCH[id] }}
                  />
                ))}
              </div>
              <p className="flex items-center gap-2 font-mono text-[10.5px] text-fog">
                <Move3d className="size-3.5" /> Drag to inspect · select a point to explore · illustrative device
              </p>
            </div>
          </div>
        </section>

        {/* 01 · Teach */}
        <Chapter register={register(1)} index="01" eyebrow="Teach" side="left"
          title={<>Any camera. <span className="italic text-signal">Any question.</span></>}
          body="Draw a box around what you care about and ask a question. Choose the answers that count and which of them are alerts. Claude checks on every motion event, every doorbell press, and on a schedule. Two matching answers in a row make it official."
        >
          <TeachDemo />
        </Chapter>

        {/* 02 · Privacy */}
        <Chapter register={register(2)} index="02" eyebrow="Privacy" side="right"
          title={<>It sees the box. <span className="italic text-signal">Nothing else.</span></>}
          body="Privacy zones and faces are pixelated before any pixel leaves the pipeline, and only your region ever reaches the AI. Frames are discarded after every check unless they become evidence, and every check leaves a privacy receipt."
        >
          <PrivacyDemo />
        </Chapter>

        {/* 03 · Proof */}
        <section ref={register(3)} className="pointer-events-none relative min-h-[150vh] py-[22vh]">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-6 md:grid-cols-2 md:px-12">
            <Reveal className="pointer-events-auto md:col-start-2">
              <ChapterHeading index="03" eyebrow="Proof" title={<>Sealed <span className="italic text-signal">before</span> it's redacted.</>} />
              <RevealItem>
                <p className="mt-6 max-w-lg text-[16.5px] leading-relaxed text-mist">
                  The moment a sensor alerts, the original frame is hashed and signed. The redaction is signed as an edit, together with a digest of every untouched pixel. Each entry is chained to the one before it. Tamper with one, and the chain shows you where.
                </p>
              </RevealItem>
            </Reveal>
            <div className="pointer-events-auto md:col-span-2 md:mt-[26vh]">
              <ChainDemo />
            </div>
          </div>
        </section>

        {/* 04 · Verify */}
        <section ref={register(4)} className="pointer-events-none relative min-h-[130vh] py-[18vh]">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-6 md:grid-cols-[1fr_1.45fr] md:px-12">
            <div className="pointer-events-auto md:col-start-2">
              <Reveal>
                <ChapterHeading index="04" eyebrow="Verify" title={<>Anyone can check. <span className="italic text-signal">No account needed.</span></>} />
                <RevealItem>
                  <p className="mt-6 mb-10 max-w-xl text-[16.5px] leading-relaxed text-mist">
                    A bundle carries the redacted image and the signed history behind it. The open-source verifier runs in any browser. Below, a bundle is created and verified live on this page, with a key that never leaves your device.
                  </p>
                </RevealItem>
              </Reveal>
              <VerifyDemo />
            </div>
          </div>
        </section>

        {/* 05 · Signal */}
        <section ref={register(5)} className="pointer-events-none relative min-h-[120vh] py-[16vh]">
          <div className="pointer-events-auto mx-auto max-w-[1440px] px-6 md:px-12">
            <Reveal className="mb-10 max-w-2xl">
              <ChapterHeading index="05" eyebrow="Signal" title={<>Confidence, <span className="italic text-signal">debounced.</span></>} />
              <RevealItem>
                <p className="mt-6 text-[16.5px] leading-relaxed text-mist">A single noisy frame should never wake you up. Change how many confirmations an alert needs and watch the trade-off between false alarms and speed.</p>
              </RevealItem>
            </Reveal>
            <Telemetry />
          </div>
        </section>

        {/* 06 · Stack */}
        <section ref={register(6)} className="pointer-events-none relative min-h-[110vh] py-[16vh]">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-6 md:grid-cols-2 md:px-12">
            <div className="pointer-events-auto md:col-start-2">
              <Reveal>
                <ChapterHeading index="06" eyebrow="Built on" title={<>Ring in. <span className="italic text-signal">Proof out.</span></>} />
              </Reveal>
              <Reveal amount={0.08} className="mt-10 divide-y divide-line border-y border-line">
                {STACK.map(([name, role]) => (
                  <RevealItem key={name} className="grid grid-cols-[minmax(0,180px)_1fr] gap-6 py-4">
                    <span className="text-[14px] font-medium text-snow">{name}</span>
                    <span className="text-[14px] leading-relaxed text-fog">{role}</span>
                  </RevealItem>
                ))}
              </Reveal>
            </div>
          </div>
        </section>

        {/* Finale */}
        <section ref={register(7)} className="pointer-events-none relative flex min-h-[100svh] flex-col justify-end">
          <div className="pointer-events-auto mx-auto w-full max-w-[1440px] px-6 pb-10 text-center md:px-12">
            <h2 data-finale className="display text-[clamp(3rem,8vw,7.5rem)] leading-[0.92]">
              Every frame, <span className="italic text-signal">accountable.</span>
            </h2>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Magnetic href="#/sensors" className="btn btn-primary px-6 py-3">
                Open the console <ArrowRight className="size-4" />
              </Magnetic>
              <Magnetic href="#/verify" className="btn px-6 py-3">
                Verify a bundle
              </Magnetic>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-ghost px-5 py-3">
                Source on GitHub <ExternalLink className="size-3.5" />
              </a>
            </div>
            <footer className="mt-24 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 text-[12px] text-fog md:flex-row">
              <Wordmark className="opacity-80" />
              <span>Amazon Developer Hackathon 2026 · Ring track · MIT licensed</span>
              <span>Not affiliated with or endorsed by Ring or Amazon.</span>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}

function ChapterHeading({ index, eyebrow, title }: { index: string; eyebrow: string; title: ReactNode }) {
  return (
    <>
      <RevealItem>
        <p className="eyebrow mb-5 flex items-center gap-3">
          <span className="text-signal">{index}</span>
          <span className="h-px w-8 bg-line-strong" />
          {eyebrow}
        </p>
      </RevealItem>
      <RevealItem>
        <h2 className="display text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[0.98]">{title}</h2>
      </RevealItem>
    </>
  );
}

function Chapter({ register, index, eyebrow, title, body, side, children }: { register: (el: HTMLElement | null) => void; index: string; eyebrow: string; title: ReactNode; body: string; side: "left" | "right"; children: ReactNode }) {
  return (
    <section ref={register} className="pointer-events-none relative flex min-h-[140vh] items-center py-[16vh]">
      <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-6 md:grid-cols-2 md:px-12">
        <div className={`pointer-events-auto max-w-[580px] ${side === "right" ? "md:col-start-2 md:justify-self-end" : ""}`}>
          <Reveal>
            <ChapterHeading index={index} eyebrow={eyebrow} title={title} />
            <RevealItem>
              <p className="mt-6 mb-10 text-[16.5px] leading-relaxed text-mist">{body}</p>
            </RevealItem>
          </Reveal>
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: 1, ease: EASE }}>
            {children}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FocusPanel({ id, onClose, onStep }: { id: HotspotId; onClose: () => void; onStep: (d: number) => void }) {
  const info = HOTSPOTS[id];
  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="pointer-events-auto max-w-[440px]"
      role="dialog"
      aria-label={info.title}
    >
      <p className="eyebrow mb-5 flex items-center gap-3">
        <span className="text-signal">{info.index}</span>
        <span className="h-px w-8 bg-line-strong" />
        {info.label}
      </p>
      <h2 className="display text-[clamp(2.6rem,5vw,4.6rem)] leading-[0.95]">{info.title}</h2>
      <p className="mt-6 text-[16.5px] leading-relaxed text-mist">{info.body}</p>
      <p className="mt-6 border-l border-signal/50 pl-4 font-mono text-[11.5px] uppercase tracking-[0.14em] text-signal/90">{info.spec}</p>
      <div className="mt-10 flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => onStep(-1)} aria-label="Previous point">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onStep(1)} aria-label="Next point">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          <X className="size-3.5" /> Back to overview <span className="ml-1 font-mono text-[10px] text-fog">ESC</span>
        </button>
      </div>
    </motion.div>
  );
}

/** Shown while the WebGL chunk loads, so the hero never appears empty. */
function Poster() {
  return (
    <div className="absolute inset-0 flex items-center justify-end pr-[12vw] max-md:items-start max-md:justify-center max-md:pr-0 max-md:pt-[14vh]">
      <svg viewBox="0 0 120 280" className="h-[56vh] max-h-[620px] opacity-70" aria-hidden="true">
        <defs>
          <radialGradient id="g" cx="50%" cy="78%" r="40%">
            <stop offset="0" stopColor="#8fd8ff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#8fd8ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="8" y="6" width="104" height="268" rx="16" fill="#1b2029" stroke="rgba(150,180,225,0.25)" />
        <rect x="14" y="12" width="92" height="256" rx="13" fill="#05070b" />
        <circle cx="60" cy="58" r="20" fill="none" stroke="#2a313d" strokeWidth="4" />
        <circle cx="60" cy="58" r="8" fill="#0d1a24" stroke="#8fd8ff" strokeOpacity="0.6" />
        <circle cx="60" cy="218" r="40" fill="url(#g)" />
        <circle cx="60" cy="218" r="22" fill="none" stroke="#8fd8ff" strokeWidth="2.5" />
      </svg>
    </div>
  );
}
