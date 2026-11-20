// Archive ZIP minimale (fichiers stockés sans recompression : PDF et images sont déjà compressés).
// fichiers = [{ nom, donnees: Uint8Array | ArrayBuffer | string }] → Uint8Array (format ZIP standard, noms en UTF-8).

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()

export function crc32(octets) {
  let c = 0xffffffff
  for (let i = 0; i < octets.length; i++) c = TABLE[(c ^ octets[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enOctets = (d) => (typeof d === "string" ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d))

export function creerZip(fichiers, date = new Date()) {
  const heure = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff
  const jour = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  const locaux = [], centraux = []
  let decalage = 0
  const vus = new Set()
  for (const f of fichiers) {
    let nom = String(f.nom).replace(/[\\:*?"<>|]/g, "-")
    for (let k = 2; vus.has(nom); k++) nom = String(f.nom).replace(/(\.[^.]+)?$/, (ext) => `-${k}${ext || ""}`)
    vus.add(nom)
    const n = new TextEncoder().encode(nom), d = enOctets(f.donnees), crc = crc32(d)
    const l = new DataView(new ArrayBuffer(30))
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true)
    l.setUint16(10, heure, true); l.setUint16(12, jour, true); l.setUint32(14, crc, true)
    l.setUint32(18, d.length, true); l.setUint32(22, d.length, true); l.setUint16(26, n.length, true); l.setUint16(28, 0, true)
    locaux.push(new Uint8Array(l.buffer), n, d)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true)
    c.setUint16(12, heure, true); c.setUint16(14, jour, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true)
    c.setUint16(28, n.length, true); c.setUint32(42, decalage, true)
    centraux.push(new Uint8Array(c.buffer), n)
    decalage += 30 + n.length + d.length
  }
  const tailleCentrale = centraux.reduce((s, x) => s + x.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true)
  fin.setUint32(12, tailleCentrale, true); fin.setUint32(16, decalage, true)
  const morceaux = [...locaux, ...centraux, new Uint8Array(fin.buffer)]
  const sortie = new Uint8Array(morceaux.reduce((s, x) => s + x.length, 0))
  let p = 0
  for (const m of morceaux) { sortie.set(m, p); p += m.length }
  return sortie
}

/** Fait télécharger l'archive au navigateur. */
export function telechargerZip(octets, nom) {
  const url = URL.createObjectURL(new Blob([octets], { type: "application/zip" }))
  const a = document.createElement("a"); a.href = url; a.download = nom.endsWith(".zip") ? nom : `${nom}.zip`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
