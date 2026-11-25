// Genera los iconos PNG de la PWA a partir del SVG (npm run icons). Requiere "sharp" (devDependency).
import sharp from 'sharp';
import fs from 'node:fs';
const svg = fs.readFileSync('public/favicon.svg');
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1c4a2e"/><g transform="translate(9.6 9.6) scale(0.7)"><path d="M32 52V30" stroke="#f6f3ea" stroke-width="4" stroke-linecap="round"/><path d="M32 34c-9 0-15-5-15-14 9 0 15 5 15 14Z" fill="#8fd16a"/><path d="M32 30c0-8 5-13 14-13 0 9-5 13-14 13Z" fill="#f2b84b"/><path d="M20 52h24" stroke="#f6f3ea" stroke-width="4" stroke-linecap="round"/></g></svg>`);
await sharp(svg, { density: 384 }).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(maskable, { density: 384 }).resize(512, 512).png().toFile('public/icons/icon-512-maskable.png');
console.log('Iconos generados');
