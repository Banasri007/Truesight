import { motion } from "framer-motion";
import { Activity, ArrowUpLeft, BadgeCheck, EyeOff, FlaskConical, Link2, ScanLine, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Wordmark } from "../components/Logo";
import type { Status } from "../types";

const NAV: { page: string; label: string; icon: LucideIcon; simOnly?: boolean; publicPage?: boolean }[] = [
  { page: "sensors", label: "Sensors", icon: Activity },
  { page: "teach", label: "Teach", icon: ScanLine },
  { page: "evidence", label: "Evidence", icon: ShieldCheck },
  { page: "privacy", label: "Privacy", icon: EyeOff },
  { page: "ledger", label: "Ledger", icon: Link2 },
  { page: "verify", label: "Verify", icon: BadgeCheck, publicPage: true },
  { page: "simulator", label: "Simulator", icon: FlaskConical, simOnly: true },
];

const normalize = (page: string) => (page === "dashboard" ? "sensors" : page);

export function Shell({ page, status, authed, children }: { page: string; status: Status | null; authed: boolean; children: ReactNode }) {
  const current = normalize(page);
  const items = NAV.filter((n) => (authed || n.publicPage) && (!n.simOnly || status?.ringMode === "simulator"));

  return (
    <div className="min-h-screen bg-ink-950 lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-ink-900/50 px-4 py-6 lg:flex">
        <a href="#/" className="px-2" aria-label="TrueSight home">
          <Wordmark />
        </a>
        <p className="eyebrow mt-2 px-2 !text-[9.5px]">Console</p>
        <nav className="mt-8 flex flex-col gap-0.5" aria-label="Console">
          {items.map((item) => {
            const active = current === item.page;
            const Icon = item.icon;
            return (
              <a
                key={item.page}
                href={`#/${item.page}`}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${active ? "text-snow" : "text-fog hover:bg-white/[0.03] hover:text-mist"}`}
              >
                {active && <motion.span layoutId="rail-active" className="absolute inset-0 rounded-lg border border-line bg-white/[0.045]" transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />}
                {active && <motion.span layoutId="rail-bar" className="absolute -left-4 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-signal" />}
                <Icon className={`relative size-4 ${active ? "text-signal" : ""}`} strokeWidth={1.75} />
                <span className="relative">{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="mt-auto space-y-4">
          {status && (
            <dl className="space-y-2 rounded-xl border border-line bg-ink-950/50 p-3.5 font-mono text-[11px]">
              <Row label="Ring" value={status.ringMode === "simulator" ? "simulator" : status.ring.linked ? "linked" : "not linked"} ok={status.ringMode === "simulator" || status.ring.linked} />
              <Row label="AI" value={status.vision.provider} ok={status.vision.provider !== "mock"} />
              <Row label="Ledger" value={`#${status.ledger.headSeq}`} ok />
            </dl>
          )}
          <a href="#/" className="flex items-center gap-2 px-2 text-[12.5px] text-fog transition-colors hover:text-snow">
            <ArrowUpLeft className="size-3.5" /> Back to the film
          </a>
        </div>
      </aside>

      {/* Compact top bar for small screens */}
      <header className="sticky top-0 z-30 border-b border-line bg-ink-950/80 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <a href="#/"><Wordmark /></a>
          <span className="eyebrow">Console</span>
        </div>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Console">
          {items.map((item) => (
            <a key={item.page} href={`#/${item.page}`} className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] ${current === item.page ? "bg-white/[0.07] text-snow" : "text-fog"}`}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="relative min-w-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(ellipse_60%_80%_at_70%_-10%,rgb(58_155_255/0.12),transparent_70%)]" />
        <div className="grid-texture pointer-events-none absolute inset-x-0 top-0 h-[460px] [mask-image:linear-gradient(to_bottom,#000,transparent)]" />
        <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-8 md:px-10 md:pt-12">{children}</div>
      </main>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-fog">{label}</dt>
      <dd className={`flex items-center gap-1.5 ${ok ? "text-mist" : "text-amber"}`}>
        <span className={`size-1.5 rounded-full ${ok ? "bg-verdant" : "bg-amber"}`} />
        {value}
      </dd>
    </div>
  );
}
