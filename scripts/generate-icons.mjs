// Genera los íconos PWA de Cuadra a partir de un SVG (solo formas, sin fuentes).
// Motivo: la "barra de vida" del saldo sobre el degradado verde de la marca.
// Correr con: npm run icons
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size, rounded) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#27B06E"/>
      <stop offset="1" stop-color="#0F5C39"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 118 : 0}" fill="url(#g)"/>
  <rect x="104" y="150" width="304" height="56" rx="28" fill="rgba(255,255,255,0.30)"/>
  <rect x="104" y="150" width="230" height="56" rx="28" fill="#FFFFFF"/>
  <rect x="104" y="238" width="304" height="56" rx="28" fill="rgba(255,255,255,0.30)"/>
  <rect x="104" y="238" width="150" height="56" rx="28" fill="#EAF6EF"/>
  <rect x="104" y="326" width="304" height="56" rx="28" fill="rgba(255,255,255,0.30)"/>
  <rect x="104" y="326" width="86" height="56" rx="28" fill="#D9EFE2"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });

const jobs = [
  { file: "public/icons/icon-192.png", size: 192, rounded: true },
  { file: "public/icons/icon-512.png", size: 512, rounded: true },
  { file: "public/icons/apple-touch-icon.png", size: 180, rounded: false },
  { file: "public/icons/icon-maskable-512.png", size: 512, rounded: false },
];

for (const { file, size, rounded } of jobs) {
  await sharp(Buffer.from(svg(size, rounded))).resize(size, size).png().toFile(file);
  console.log("ok", file);
}
