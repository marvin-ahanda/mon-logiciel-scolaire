import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { EN } from "../i18n-en.js"

// Chaque texte passé à t("…") dans le code doit avoir sa traduction anglaise.
const racine = join(__dirname, "..")
function fichiers(d) {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    if (statSync(p).isDirectory()) return fichiers(p)
    return /\.(jsx?|mjs)$/.test(f) && !/test|i18n-en|Console\.jsx/.test(f) ? [p] : []
  })
}

describe("traductions anglaises", () => {
  it("couvrent toutes les clés t(\"…\") du code", () => {
    const manquantes = new Set()
    for (const f of fichiers(racine)) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g)) {
        const cle = JSON.parse(`"${m[1]}"`).trim()
        if (cle && EN[cle] === undefined) manquantes.add(`${cle}  (${f.slice(racine.length + 1)})`)
      }
    }
    expect([...manquantes]).toEqual([])
  })

  it("gardent les mêmes variables {v0}, {v1}… que le français", () => {
    const vars = (s) => (s.match(/\{v\d\}/g) || []).sort().join()
    const ecarts = Object.entries(EN).filter(([fr, en]) => typeof en === "string" && vars(fr) !== vars(en)).map(([fr]) => fr)
    expect(ecarts).toEqual([])
  })
})

describe("libellés traduits à l'affichage", () => {
  const lire = (f) => readFileSync(join(racine, f), "utf8")
  const CONSTANTES = [
    ["composants/MiseEnPage.jsx", /LIBELLES_ROLES = (\{[^\n]*\})/], ["pages/Personnel.jsx", /const ROLES = (\{[^\n]*\})/],
    ["lib/financePdf.js", /export const MODES = (\{[^\n]*\})/], ["pages/Finance.jsx", /const LIGNES = (\[[^\n]*\])/],
    ["pages/Finance.jsx", /const CYCLES = (\{[^\n]*\})/], ["pages/Parametres.jsx", /export const CYCLES = (\[[^\n]*\])/],
    ["pages/Statistiques.jsx", /const ENTETES_RESUME = (\[[^\n]*\])/], ["lib/statistiques.js", /export const SEXES = (\[[^\n]*\])/],
    ["lib/calculs.js", /(\[0, 3, [\s\S]*?\[18, 20, "[^"]+"\])/], ["pages/Developpeurs.jsx", /const OUTILS = (\[[\s\S]*?\n\])/],
  ]
  it.each(CONSTANTES)("%s", (f, re) => {
    const m = lire(f).match(re)
    expect(m).not.toBeNull()
    const valeurs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((v) => /[a-zà-ÿ]{3}/i.test(v) && !/^[a-z_ /✎]+$/.test(v.trim()))
    expect(valeurs.filter((v) => EN[v] === undefined)).toEqual([])
  })
})
