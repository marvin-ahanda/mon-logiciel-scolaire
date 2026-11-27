// Génère public/og/nexia-school-1200x630.png (image de partage : logo, nom, promesse en français). À relancer si le logo change :
//   node scripts/image-og.mjs
import { mkdirSync } from "node:fs"
import sharp from "sharp"

const L = 1200, H = 630
const fond = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b46e5"/><stop offset="1" stop-color="#062a8f"/></linearGradient></defs>
  <rect width="${L}" height="${H}" fill="url(#g)"/>
  <rect x="80" y="150" width="220" height="220" rx="44" fill="#ffffff"/>
  <text x="340" y="250" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="78" font-weight="700" fill="#ffffff">NexIA School</text>
  <text x="342" y="320" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="38" fill="#dbe4ff">Logiciel de gestion scolaire</text>
  <text x="80" y="470" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="44" font-weight="600" fill="#ffffff">Moins de gestion, plus de réussite.</text>
  <text x="80" y="530" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="30" fill="#dbe4ff">Notes, bulletins, discipline, frais de scolarité et espace parents</text>
</svg>`
const logo = await sharp(new URL("../public/logo-nexia-512.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).resize(180, 180).png().toBuffer()
mkdirSync(new URL("../public/og/", import.meta.url), { recursive: true })
await sharp(Buffer.from(fond)).composite([{ input: logo, left: 100, top: 170 }]).png({ compressionLevel: 9 })
  .toFile(new URL("../public/og/nexia-school-1200x630.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"))
console.log("public/og/nexia-school-1200x630.png")
