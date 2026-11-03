// Rendu image par image de hero.html puis encodage (ffmpeg). Usage : node rendu.cjs <dossier de sortie>
const { chromium } = require("playwright")
const { spawn } = require("child_process")
const path = require("path")
const IPS = 30, DUREE = 16
;(async () => {
  const sortie = process.argv[2]
  const maitre = path.join(sortie, "maitre.mp4")
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(IPS), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", maitre], { stdio: ["pipe", "inherit", "inherit"] })
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
  await p.goto("file://" + path.join(__dirname, "hero.html"))
  const total = IPS * DUREE
  for (let i = 0; i < total; i++) {
    await p.evaluate((t) => window.render(t), i / IPS)
    const img = await p.screenshot({ type: "png" })
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once("drain", r))
    if (i % 60 === 0) console.log(`image ${i}/${total}`)
  }
  ff.stdin.end()
  await new Promise((r) => ff.on("close", r))
  await b.close()
  console.log("maître :", maitre)
})()
