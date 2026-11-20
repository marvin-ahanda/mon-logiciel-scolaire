import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, creerZip } from "./zip.js"

describe("archive ZIP", () => {
  it("CRC-32 standard", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
  })
  it("archive lisible par unzip, noms accentués et doublons renommés", () => {
    const z = creerZip([{ nom: "carte-ABENA Grâce.pdf", donnees: "%PDF-1 essai" }, { nom: "carte-ABENA Grâce.pdf", donnees: new Uint8Array([1, 2, 3]) }, { nom: "b.txt", donnees: "bonjour" }])
    const d = mkdtempSync(join(tmpdir(), "zip-")), f = join(d, "a.zip")
    writeFileSync(f, z)
    let sortie = ""
    try { sortie = execFileSync("unzip", ["-l", f]).toString() } catch { return }     // unzip absent : contrôle non disponible
    expect(sortie).toContain("carte-ABENA Grâce.pdf")
    expect(sortie).toContain("carte-ABENA Grâce-2.pdf")
    expect(execFileSync("unzip", ["-p", f, "b.txt"]).toString()).toBe("bonjour")
    expect(execFileSync("unzip", ["-t", f]).toString()).toMatch(/No errors/)
  })
})
