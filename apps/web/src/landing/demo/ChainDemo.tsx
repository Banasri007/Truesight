import { motion } from "framer-motion";
import { Link2, Link2Off, RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { GENESIS_PREV, canonicalize, sha256Hex, utf8 } from "truesight-verify";

interface Block {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
  edited: boolean;
}

const BASE: { type: string; data: Record<string, unknown> }[] = [
  { type: "ledger.genesis", data: { app: "TrueSight", alg: "ES256" } },
  { type: "sensor.created", data: { name: "Side gate", question: "Is the side gate latched?" } },
  { type: "ring.event", data: { type: "contact_sensor_faulted", hmac: "verified" } },
  { type: "sensor.state_changed", data: { from: "latched", to: "open", confidence: 0.93 } },
  { type: "evidence.captured", data: { evidenceId: "ev_7f2c", frame: "sha-256 sealed" } },
  { type: "evidence.redacted", data: { regions: 2, method: "mosaic" } },
];

const TAMPERED_SEQ = 3;

const hashOf = (b: Omit<Block, "hash" | "edited">) => sha256Hex(utf8(canonicalize({ seq: b.seq, type: b.type, data: b.data, prev: b.prev })));

/** Real SHA-256 over canonical JSON, computed in your browser. Edit one entry and watch the links fail. */
async function buildChain(tampered: boolean): Promise<Block[]> {
  const blocks: Block[] = [];
  let prev = GENESIS_PREV;
  for (const [seq, item] of BASE.entries()) {
    const honest = { seq, type: item.type, data: item.data, prev };
    const hash = await hashOf(honest);
    blocks.push({ ...honest, hash, edited: false });
    prev = hash;
  }
  if (tampered) {
    const target = blocks[TAMPERED_SEQ]!;
    // A quiet cover-up: rewrite "open" back to "latched" after the fact.
    const data = { ...target.data, to: "latched" };
    blocks[TAMPERED_SEQ] = { ...target, data, hash: await hashOf({ ...target, data }), edited: true };
  }
  return blocks;
}

export function ChainDemo() {
  const [tampered, setTampered] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selected, setSelected] = useState(TAMPERED_SEQ);

  useEffect(() => {
    void buildChain(tampered).then(setBlocks);
  }, [tampered]);

  const brokenAt = blocks.findIndex((b, i) => i > 0 && b.prev !== blocks[i - 1]!.hash);
  const current = blocks[selected];

  return (
    <div className="space-y-5">
      <div className="scrollbar-thin -mx-1 overflow-x-auto overflow-y-hidden px-1 pb-2">
        <div className="flex min-w-max items-stretch">
          {blocks.map((block, i) => {
            const linkOk = i === 0 || block.prev === blocks[i - 1]!.hash;
            return (
              <div key={block.seq} className="flex items-center">
                {i > 0 && (
                  <div className={`flex w-12 flex-col items-center gap-1 ${linkOk ? "text-signal/70" : "text-ember"}`}>
                    {linkOk ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
                    <div className={`h-px w-full ${linkOk ? "bg-signal/40" : "bg-ember/80 [mask-image:repeating-linear-gradient(90deg,#000_0_4px,transparent_4px_7px)]"}`} />
                  </div>
                )}
                <motion.button
                  type="button"
                  layout
                  onClick={() => setSelected(block.seq)}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  // Solid surfaces: the 3D device can pass behind this section, so nothing here is see-through.
                  className={`w-44 rounded-xl border p-3.5 text-left shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] transition-colors ${
                    block.edited
                      ? "border-ember/60 bg-[#1c0f0c]"
                      : !linkOk || (brokenAt > 0 && i > brokenAt)
                        ? "border-ember/30 bg-ink-900"
                        : selected === block.seq
                          ? "border-signal/50 bg-ink-850"
                          : "border-line-strong bg-ink-900 hover:border-signal/40"
                  }`}
                >
                  <div className="flex items-center justify-between font-mono text-[10.5px] text-fog">
                    <span>#{block.seq}</span>
                    {block.edited && <span className="text-ember">edited</span>}
                  </div>
                  <div className="mt-1.5 truncate text-[13px] font-medium text-snow">{block.type}</div>
                  <div className="mt-3 space-y-0.5 font-mono text-[10.5px] leading-relaxed">
                    <div className="truncate text-fog">prev {block.prev.slice(0, 10)}</div>
                    <div className={`truncate ${block.edited ? "text-ember" : "text-signal"}`}>hash {block.hash.slice(0, 10)}</div>
                  </div>
                </motion.button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-start">
        <div className="min-w-0 rounded-xl border border-line-strong bg-ink-900 p-4">
          {current && (
            <>
              <div className="eyebrow mb-2">Entry #{current.seq} · canonical JSON</div>
              <pre className="scrollbar-thin overflow-x-auto font-mono text-[11.5px] leading-relaxed text-mist">
                {canonicalize({ seq: current.seq, type: current.type, data: current.data, prev: `${current.prev.slice(0, 16)}…` })}
              </pre>
              <div className="mt-2 font-mono text-[11px] text-fog">
                sha-256 <span className={current.edited ? "text-ember" : "text-signal"}>{current.hash}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3 md:w-72">
          <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] ${brokenAt > 0 ? "border-ember/40 bg-[#1c0f0c] text-ember" : "border-verdant/30 bg-[#0b1912] text-verdant"}`}>
            {brokenAt > 0 ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <Link2 className="mt-0.5 size-4 shrink-0" />}
            <span>
              {brokenAt > 0
                ? `Tampering detected. Entry #${brokenAt - 1} was edited, so #${brokenAt} no longer links to it.`
                : `${blocks.length} entries, ${Math.max(0, blocks.length - 1)} links intact. Nothing has been edited.`}
            </span>
          </div>
          <button type="button" className="btn bg-ink-900" onClick={() => setTampered((t) => !t)}>
            {tampered ? <RotateCcw className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
            {tampered ? "Undo the tampering" : "Try to tamper with the record"}
          </button>
          <p className="rounded-xl border border-line bg-ink-900 px-4 py-3 text-[12.5px] leading-relaxed text-fog">
            {tampered
              ? `Entry #${TAMPERED_SEQ} now says the gate went to “latched”, hiding the alert. Its hash changed, so the link from #${TAMPERED_SEQ + 1} breaks. Covering it up would mean rewriting every later entry, and those carry signatures only TrueSight's key can make.`
              : `Pretend someone secretly edits entry #${TAMPERED_SEQ} afterwards, changing “open” to “latched” to hide that the gate was open. The hashes are real SHA-256, computed in your browser.`}
          </p>
        </div>
      </div>
    </div>
  );
}
