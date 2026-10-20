/**
 * Procedurally drawn camera scenes for the simulator. Each scene is an SVG
 * rendered to JPEG by sharp, so the whole pipeline (privacy, AI, evidence)
 * runs on real image bytes without a physical Ring device.
 */

export interface FrontDoorScene {
  package: boolean;
  person: boolean;
  night: boolean;
}

export interface SideYardScene {
  gate: "open" | "closed";
  bins: "curb" | "yard";
  night: boolean;
}

export interface DrivewayScene {
  garageDoor: "open" | "closed";
  car: boolean;
  night: boolean;
}

export type SceneState = FrontDoorScene | SideYardScene | DrivewayScene;

export const W = 1280;
export const H = 720;

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function sky(night: boolean): string {
  return night
    ? `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1530"/><stop offset="1" stop-color="#22325a"/></linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#sky)"/>`
    : `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3ff"/><stop offset="1" stop-color="#e8f5ff"/></linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#sky)"/>`;
}

/** Camera-style overlay: night vision tint and a watermark like the one Ring burns into media. */
function cameraOverlay(deviceName: string, night: boolean, at: Date): string {
  const stamp = at.toISOString().replace("T", " ").slice(0, 19);
  return `${night ? `<rect width="${W}" height="${H}" fill="#06122b" opacity="0.45"/>` : ""}
    <rect x="16" y="14" width="150" height="34" rx="6" fill="#000" opacity="0.45"/>
    <text x="30" y="38" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#fff">SIM CAM</text>
    <rect x="${W - 476}" y="14" width="460" height="34" rx="6" fill="#000" opacity="0.45"/>
    <text x="${W - 462}" y="37" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#fff">${escapeXml(deviceName)} · Witness · ${stamp}Z</text>`;
}

function person(x: number, y: number): string {
  // Simple standing figure; the face is drawn so face detection / blurring has something to act on.
  return `<g>
    <rect x="${x - 55}" y="${y + 70}" width="110" height="210" rx="40" fill="#3d5a80"/>
    <rect x="${x - 48}" y="${y + 270}" width="40" height="120" rx="14" fill="#293241"/>
    <rect x="${x + 8}" y="${y + 270}" width="40" height="120" rx="14" fill="#293241"/>
    <rect x="${x - 80}" y="${y + 90}" width="30" height="150" rx="14" fill="#3d5a80"/>
    <rect x="${x + 50}" y="${y + 90}" width="30" height="150" rx="14" fill="#3d5a80"/>
    <circle cx="${x}" cy="${y + 30}" r="44" fill="#c68b59"/>
    <path d="M ${x - 46} ${y + 18} Q ${x} ${y - 40} ${x + 46} ${y + 18} Q ${x} ${y - 4} ${x - 46} ${y + 18} Z" fill="#2b2118"/>
    <circle cx="${x - 15}" cy="${y + 32}" r="5" fill="#1b1b1b"/>
    <circle cx="${x + 15}" cy="${y + 32}" r="5" fill="#1b1b1b"/>
    <path d="M ${x - 14} ${y + 55} Q ${x} ${y + 64} ${x + 14} ${y + 55}" stroke="#7a3d1e" stroke-width="4" fill="none"/>
  </g>`;
}

export function renderFrontDoor(scene: FrontDoorScene, deviceName: string, at: Date): string {
  const siding = Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${40 * i + 20}" x2="${W}" y2="${40 * i + 20}" stroke="#c4b08f" stroke-width="3"/>`).join("");
  const box = scene.package
    ? `<g>
        <rect x="770" y="455" width="170" height="120" fill="#b07a45" stroke="#7d5229" stroke-width="4"/>
        <polygon points="770,455 810,425 980,425 940,455" fill="#c8915a" stroke="#7d5229" stroke-width="4"/>
        <polygon points="940,455 980,425 980,545 940,575" fill="#94653a" stroke="#7d5229" stroke-width="4"/>
        <rect x="842" y="455" width="26" height="120" fill="#e8d3a8"/>
        <rect x="785" y="490" width="50" height="34" fill="#fff" stroke="#999"/>
      </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#dccaa9"/>
    ${siding}
    <rect x="520" y="140" width="240" height="440" fill="#f4efe6"/>
    <rect x="545" y="165" width="190" height="415" fill="#7a3e2b"/>
    <rect x="570" y="195" width="140" height="150" rx="6" fill="#5e2e20"/>
    <rect x="570" y="370" width="140" height="180" rx="6" fill="#5e2e20"/>
    <circle cx="715" cy="390" r="10" fill="#d4af37"/>
    <rect x="455" y="250" width="34" height="60" rx="8" fill="#333"/>
    <rect x="461" y="258" width="22" height="42" rx="6" fill="${scene.night ? "#ffd86b" : "#fff6cf"}"/>
    <rect x="0" y="575" width="${W}" height="145" fill="#8f8f8f"/>
    <rect x="0" y="575" width="${W}" height="14" fill="#7a7a7a"/>
    <rect x="555" y="585" width="170" height="30" rx="4" fill="#5b4a3a"/>
    ${box}
    ${scene.person ? person(360, 190) : ""}
    ${cameraOverlay(deviceName, scene.night, at)}
  </svg>`;
}

function bin(x: number, y: number, scale = 1): string {
  const w = 90 * scale;
  const h = 150 * scale;
  return `<g>
    <polygon points="${x},${y} ${x + w},${y} ${x + w - 8 * scale},${y + h} ${x + 8 * scale},${y + h}" fill="#2e7d32" stroke="#1b5e20" stroke-width="3"/>
    <rect x="${x - 6 * scale}" y="${y - 16 * scale}" width="${w + 12 * scale}" height="${18 * scale}" rx="4" fill="#212121"/>
    <circle cx="${x + 18 * scale}" cy="${y + h}" r="${12 * scale}" fill="#111"/>
    <circle cx="${x + w - 18 * scale}" cy="${y + h}" r="${12 * scale}" fill="#111"/>
  </g>`;
}

export function renderSideYard(scene: SideYardScene, deviceName: string, at: Date): string {
  const gateX0 = 520;
  const gateX1 = 760;
  const planks = (x0: number, x1: number, color: string) =>
    Array.from({ length: Math.ceil((x1 - x0) / 40) }, (_, i) => {
      const x = x0 + i * 40;
      return `<rect x="${x + 2}" y="300" width="${Math.min(36, x1 - x - 2)}" height="270" fill="${color}" stroke="#6d4c2f" stroke-width="2"/>
              <polygon points="${x + 2},300 ${x + 20},282 ${x + Math.min(38, x1 - x)},300" fill="${color}" stroke="#6d4c2f" stroke-width="2"/>`;
    }).join("");
  const closedGate = `<g>
      ${planks(gateX0, gateX1, "#b98a5a")}
      <rect x="${gateX0}" y="350" width="${gateX1 - gateX0}" height="16" fill="#8a6038"/>
      <rect x="${gateX0}" y="500" width="${gateX1 - gateX0}" height="16" fill="#8a6038"/>
      <line x1="${gateX0 + 8}" y1="508" x2="${gateX1 - 8}" y2="358" stroke="#8a6038" stroke-width="16"/>
      <rect x="${gateX1 - 34}" y="410" width="40" height="22" rx="4" fill="#9e9e9e" stroke="#555" stroke-width="2"/>
    </g>`;
  const openGate = `<g>
      <rect x="${gateX0}" y="300" width="${gateX1 - gateX0}" height="270" fill="#8fc57a"/>
      <rect x="${gateX0}" y="420" width="${gateX1 - gateX0}" height="150" fill="#7cb868"/>
      <circle cx="660" cy="350" r="60" fill="#4f8f3a"/><rect x="652" y="380" width="16" height="80" fill="#6d4c2f"/>
      <polygon points="${gateX0},300 ${gateX0 + 95},335 ${gateX0 + 95},605 ${gateX0},570" fill="#a57a4c" stroke="#6d4c2f" stroke-width="3"/>
      <line x1="${gateX0 + 10}" y1="340" x2="${gateX0 + 88}" y2="368" stroke="#8a6038" stroke-width="12"/>
      <line x1="${gateX0 + 10}" y1="500" x2="${gateX0 + 88}" y2="540" stroke="#8a6038" stroke-width="12"/>
    </g>`;
  const bins = scene.bins === "curb" ? `${bin(70, 545, 0.9)}${bin(180, 545, 0.9)}` : `${bin(990, 430)}${bin(1110, 430)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${sky(scene.night)}
    <rect x="0" y="560" width="${W}" height="160" fill="#6aa84f"/>
    <rect x="0" y="655" width="${W}" height="65" fill="#5a5a5a"/>
    <rect x="0" y="648" width="${W}" height="10" fill="#bdbdbd"/>
    ${planks(0, gateX0, "#c49563")}
    ${planks(gateX1, 920, "#c49563")}
    <rect x="${gateX0 - 14}" y="285" width="14" height="295" fill="#6d4c2f"/>
    <rect x="${gateX1}" y="285" width="14" height="295" fill="#6d4c2f"/>
    ${scene.gate === "open" ? openGate : closedGate}
    <polygon points="560,570 720,570 820,655 470,655" fill="#cfc6b8"/>
    <rect x="920" y="120" width="360" height="460" fill="#e2d6c4"/>
    <rect x="1010" y="200" width="140" height="110" fill="${scene.night ? "#ffd86b" : "#9ec9e8"}" stroke="#fff" stroke-width="8"/>
    ${bins}
    ${cameraOverlay(deviceName, scene.night, at)}
  </svg>`;
}

export function renderDriveway(scene: DrivewayScene, deviceName: string, at: Date): string {
  const closedDoor = Array.from({ length: 4 }, (_, i) => {
    const y = 230 + i * 92;
    const windows = i === 0 ? Array.from({ length: 5 }, (_, k) => `<rect x="${395 + k * 100}" y="${y + 22}" width="70" height="40" fill="#9ec9e8" stroke="#bbb" stroke-width="3"/>`).join("") : "";
    return `<rect x="370" y="${y}" width="540" height="92" fill="#ececec" stroke="#c9c9c9" stroke-width="4"/>${windows}`;
  }).join("");
  const openDoor = `<rect x="370" y="230" width="540" height="368" fill="#262626"/>
    <rect x="370" y="230" width="540" height="34" fill="#ececec" stroke="#c9c9c9" stroke-width="4"/>
    <rect x="410" y="320" width="150" height="10" fill="#555"/><rect x="410" y="390" width="150" height="10" fill="#555"/>
    <rect x="430" y="290" width="40" height="30" fill="#8d6e63"/><rect x="480" y="360" width="50" height="30" fill="#5c6bc0"/>
    <rect x="760" y="420" width="70" height="120" fill="#455a64"/>`;
  const car = scene.car
    ? `<g>
        <rect x="420" y="560" width="440" height="100" rx="30" fill="#c62828"/>
        <path d="M 490 565 L 540 495 L 740 495 L 800 565 Z" fill="#b71c1c"/>
        <path d="M 510 560 L 550 505 L 630 505 L 630 560 Z" fill="#90caf9"/>
        <path d="M 645 560 L 645 505 L 730 505 L 775 560 Z" fill="#90caf9"/>
        <circle cx="510" cy="665" r="38" fill="#111"/><circle cx="510" cy="665" r="16" fill="#9e9e9e"/>
        <circle cx="770" cy="665" r="38" fill="#111"/><circle cx="770" cy="665" r="16" fill="#9e9e9e"/>
        <rect x="830" y="590" width="26" height="18" rx="4" fill="#ffe082"/>
      </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${sky(scene.night)}
    <polygon points="200,200 640,40 1080,200" fill="#6d4c41"/>
    <rect x="200" y="200" width="880" height="400" fill="#d7ccc8"/>
    ${scene.garageDoor === "open" ? openDoor : closedDoor}
    <rect x="356" y="216" width="568" height="16" fill="#bcaaa4"/>
    <rect x="${scene.night ? 950 : 960}" y="250" width="22" height="40" rx="5" fill="${scene.night ? "#ffd86b" : "#fff6cf"}"/>
    <polygon points="370,598 910,598 1120,${H} 160,${H}" fill="#bdbdbd"/>
    <rect x="0" y="598" width="160" height="${H - 598}" fill="#6aa84f"/>
    <rect x="1120" y="598" width="160" height="${H - 598}" fill="#6aa84f"/>
    ${car}
    ${cameraOverlay(deviceName, scene.night, at)}
  </svg>`;
}
