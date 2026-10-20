/**
 * A small illustrated side-yard camera frame (640x360) used by the landing
 * demos. Returned as an SVG string so it can be shown inline, cropped with a
 * viewBox, or rasterized for real pixel work (mosaic, hashing, signing).
 */
export const FRAME = { w: 640, h: 360 };

/** The sensor region around the gate, the neighbor's window (privacy zone) and the visitor's face. */
export const REGION = { x: 236, y: 138, w: 168, h: 156 };
export const ZONE = { x: 62, y: 88, w: 66, h: 50 };
export const FACE = { x: 302, y: 166, w: 34, h: 38 };

export const regionAreaPct = Math.round(((REGION.w * REGION.h) / (FRAME.w * FRAME.h)) * 1000) / 10;

export function yardSvg(opts: { gate: "open" | "closed"; person?: boolean; viewBox?: string; night?: boolean }): string {
  const planks = (x0: number, x1: number, fill: string) =>
    Array.from({ length: Math.ceil((x1 - x0) / 20) }, (_, i) => {
      const x = x0 + i * 20;
      const w = Math.min(18, x1 - x - 1);
      return `<rect x="${x + 1}" y="154" width="${w}" height="132" fill="${fill}" stroke="#6b4a2c" stroke-width="1"/><polygon points="${x + 1},154 ${x + 10},145 ${x + 1 + w},154" fill="${fill}" stroke="#6b4a2c" stroke-width="1"/>`;
    }).join("");
  const closed = `${planks(250, 390, "#b98a5a")}
    <rect x="250" y="178" width="140" height="8" fill="#86592f"/><rect x="250" y="252" width="140" height="8" fill="#86592f"/>
    <line x1="255" y1="256" x2="385" y2="182" stroke="#86592f" stroke-width="8"/>
    <rect x="374" y="206" width="20" height="12" rx="2" fill="#a0a4aa" stroke="#555" stroke-width="1"/>`;
  const open = `<rect x="250" y="150" width="140" height="136" fill="#93c47d"/>
    <rect x="250" y="210" width="140" height="76" fill="#7fb468"/>
    <circle cx="330" cy="176" r="30" fill="#4f8f3a"/><rect x="326" y="192" width="8" height="40" fill="#6b4a2c"/>
    <polygon points="250,150 296,166 296,300 250,286" fill="#a57a4c" stroke="#6b4a2c" stroke-width="1.5"/>
    <line x1="255" y1="172" x2="292" y2="184" stroke="#86592f" stroke-width="6"/>
    <line x1="255" y1="252" x2="292" y2="270" stroke="#86592f" stroke-width="6"/>`;
  const person = opts.person
    ? `<g>
        <rect x="292" y="198" width="52" height="96" rx="18" fill="#3d5a80"/>
        <rect x="296" y="286" width="18" height="44" rx="7" fill="#293241"/><rect x="322" y="286" width="18" height="44" rx="7" fill="#293241"/>
        <circle cx="319" cy="184" r="17" fill="#c68b59"/>
        <path d="M 302 179 Q 319 156 336 179 Q 319 170 302 179 Z" fill="#2b2118"/>
        <circle cx="313" cy="185" r="2" fill="#1b1b1b"/><circle cx="325" cy="185" r="2" fill="#1b1b1b"/>
      </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.w}" height="${FRAME.h}" viewBox="${opts.viewBox ?? `0 0 ${FRAME.w} ${FRAME.h}`}" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${opts.night ? "#0c1630" : "#9fd3ff"}"/><stop offset="1" stop-color="${opts.night ? "#22325a" : "#e8f5ff"}"/></linearGradient></defs>
    <rect width="${FRAME.w}" height="${FRAME.h}" fill="url(#s)"/>
    <polygon points="20,80 95,40 175,80" fill="#8d6e63"/><rect x="28" y="78" width="140" height="80" fill="#d7ccc8"/>
    <rect x="${ZONE.x}" y="${ZONE.y}" width="${ZONE.w}" height="${ZONE.h}" fill="#ffd27a" stroke="#fff" stroke-width="3"/>
    <line x1="${ZONE.x + ZONE.w / 2}" y1="${ZONE.y}" x2="${ZONE.x + ZONE.w / 2}" y2="${ZONE.y + ZONE.h}" stroke="#fff" stroke-width="3"/>
    <rect x="0" y="282" width="${FRAME.w}" height="78" fill="#6aa84f"/>
    <rect x="0" y="330" width="${FRAME.w}" height="30" fill="#5a5a5a"/><rect x="0" y="326" width="${FRAME.w}" height="5" fill="#bdbdbd"/>
    ${planks(0, 250, "#c49563")}${planks(390, 470, "#c49563")}
    <rect x="243" y="146" width="7" height="146" fill="#6b4a2c"/><rect x="390" y="146" width="7" height="146" fill="#6b4a2c"/>
    ${opts.gate === "open" ? open : closed}
    <polygon points="270,286 370,286 420,326 225,326" fill="#cfc6b8"/>
    <rect x="470" y="60" width="170" height="232" fill="#e2d6c4"/>
    <rect x="520" y="100" width="70" height="56" fill="#9ec9e8" stroke="#fff" stroke-width="5"/>
    <g><polygon points="490,220 534,220 530,292 494,292" fill="#2e7d32" stroke="#1b5e20" stroke-width="2"/><rect x="486" y="212" width="52" height="10" rx="2" fill="#212121"/>
    <polygon points="548,220 592,220 588,292 552,292" fill="#2e7d32" stroke="#1b5e20" stroke-width="2"/><rect x="544" y="212" width="52" height="10" rx="2" fill="#212121"/></g>
    ${person}
    ${opts.night ? `<rect width="${FRAME.w}" height="${FRAME.h}" fill="#06122b" opacity="0.45"/>` : ""}
  </svg>`;
}

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Rasterize an SVG to 8-bit RGBA (alpha is 255 everywhere, so canvas premultiplication is lossless). */
export async function rasterize(svg: string): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = FRAME.w;
  canvas.height = FRAME.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, FRAME.w, FRAME.h);
  const data = ctx.getImageData(0, 0, FRAME.w, FRAME.h);
  return { width: FRAME.w, height: FRAME.h, rgba: new Uint8Array(data.data.buffer.slice(0)) };
}

/** Same coarse mosaic the server applies to faces and privacy zones. */
export function mosaic(image: { width: number; rgba: Uint8Array }, rects: { x: number; y: number; w: number; h: number }[], block = 9): Uint8Array {
  const out = new Uint8Array(image.rgba);
  const W = image.width;
  for (const r of rects) {
    for (let by = r.y; by < r.y + r.h; by += block) {
      for (let bx = r.x; bx < r.x + r.w; bx += block) {
        const x1 = Math.min(bx + block, r.x + r.w);
        const y1 = Math.min(by + block, r.y + r.h);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let y = by; y < y1; y++)
          for (let x = bx; x < x1; x++) {
            const o = (y * W + x) * 4;
            sr += out[o]!;
            sg += out[o + 1]!;
            sb += out[o + 2]!;
            n++;
          }
        for (let y = by; y < y1; y++)
          for (let x = bx; x < x1; x++) {
            const o = (y * W + x) * 4;
            out[o] = Math.round(sr / n);
            out[o + 1] = Math.round(sg / n);
            out[o + 2] = Math.round(sb / n);
            out[o + 3] = 255;
          }
      }
    }
  }
  return out;
}
