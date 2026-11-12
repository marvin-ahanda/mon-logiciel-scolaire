import { describe, expect, it } from "vitest"
import { etablissementEssai } from "./jeuEssai.js"
import { resoudre } from "./moteur.js"
import { classesDe } from "./modele.js"
import { comparer, feuillesExcel, indexer, pdfEmploiDuTemps, tableauSemaine, totaux } from "./vues.js"
import { construireConfig, etatInitial, repondre, signature } from "./etat.js"
import { t } from "../../i18n.jsx"

const cfg = etablissementEssai({ classes: 6, permanences: 1, graine: 3 })
const { grille } = resoudre(cfg, { graine: 2, intensite: 0.2 })
const entete = { etablissement: "Collège d'essai", annee: "2026-2027", periode: "annee", version: "V1" }

describe("vues par classe et par enseignant", () => {
  const index = indexer(cfg, grille)
  it("chaque cours apparaît au même créneau dans la vue de sa classe et dans celle de son enseignant", () => {
    for (const g of grille.filter((x) => x.a)) {
      const a = cfg.affectations.find((x) => x.id === g.a)
      const vc = tableauSemaine(cfg, index, { classe: g.c }), ve = tableauSemaine(cfg, index, { enseignant: a.enseignant })
      const l = vc.lignes.findIndex((x) => x.type === "periode" && x.p === g.p), d = vc.jours.indexOf(g.j)
      expect(vc.lignes[l].cases[d]).toMatchObject({ type: "cours", discipline: a.discipline, enseignant: a.enseignant })
      expect(ve.lignes[l].cases[d]).toMatchObject({ type: "cours", discipline: a.discipline, c: g.c })
    }
  })
  it("pauses et permanences visibles", () => {
    const vc = tableauSemaine(cfg, index, { classe: classesDe(cfg)[0].id })
    expect(vc.lignes.filter((l) => l.type === "pause").map((l) => l.nom)).toEqual(["Récréation", "Pause de midi"])
    expect(vc.lignes.flatMap((l) => l.cases).filter((x) => x.type === "perm").length).toBe(1)
  })
  it("récapitulatif cohérent avec les volumes", () => {
    const tot = totaux(cfg, grille)
    expect(tot.classes.every((c) => c.cours === 30 && c.permanences === 1)).toBe(true)
    expect(tot.enseignants.reduce((s, e) => s + e.heures, 0)).toBe(cfg.affectations.reduce((s, a) => s + a.volume, 0))
  })
})

describe("exports", () => {
  it("PDF : une page par classe, au format A4 ou A3 paysage", async () => {
    const cibles = classesDe(cfg).map((c) => ({ classe: c.id, titre: c.libelle }))
    const doc = await pdfEmploiDuTemps({ cfg, grille, entete, cibles, format: "a4" })
    expect(doc.getNumberOfPages()).toBe(cibles.length)
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(297)
    const a3 = await pdfEmploiDuTemps({ cfg, grille, entete, cibles: [{ enseignant: cfg.enseignants[0].cle, titre: "X" }], format: "a3" })
    expect(Math.round(a3.internal.pageSize.getWidth())).toBe(420)
  })
  it("Excel : une feuille par classe et un récapitulatif", () => {
    const f = feuillesExcel({ cfg, grille, entete })
    expect(f.length).toBe(classesDe(cfg).length + 1)
    expect(f.at(-1).titre).toBe(t("Récapitulatif"))
    expect(f[0].entetes.length).toBe(1 + cfg.horaires.jours.length)
    expect(f[0].lignes.some((l) => l.includes(t("Permanence")))).toBe(true)
  })
})

describe("versions et brouillon", () => {
  it("comparaison : aucune différence avec soi-même, différences repérées sinon", () => {
    expect(comparer(cfg, grille, cfg, grille).cases.size).toBe(0)
    const autre = resoudre(cfg, { graine: 9, intensite: 0.2 }).grille
    const d = comparer(cfg, grille, cfg, autre)
    expect(d.cases.size).toBeGreaterThan(0)
    expect(d.classes[0].n).toBeGreaterThan(0)
  })
  it("une réponse modifie les données sources et invalide le résultat ; la signature change", () => {
    const etat = { ...etatInitial(), lignes: [{ numero: 2, valeurs: { nom: "A", prenom: "", matricule: "", discipline: "Maths", classe: "6e A", volume: "3", jours: "Lundi", creneaux: "" } }], resultat: { grille: [] } }
    const validation = { enseignants: [{ cle: "n:a", lignes: [2] }], affectations: [{ id: "a2", ligne: 2 }] }
    const e2 = repondre(etat, validation, { cible: { enseignant: "n:a" }, champ: "jours", type: "jours" }, [1, 3])
    expect(e2.lignes[0].valeurs.jours).toBe("Lundi, Mercredi")
    expect(e2.resultat).toBe(null)
    const e3 = repondre(e2, validation, { cible: { enseignant: "n:a" }, champ: "max_jour", type: "nombre" }, 5)
    expect(e3.reglagesEnseignants["n:a"].max_jour).toBe(5)
    const e4 = repondre(e3, validation, { cible: { affectation: "a2" }, champ: "volume", type: "nombre" }, 2)
    expect(e4.lignes[0].valeurs.volume).toBe("2")
    expect(etat.lignes[0].valeurs.jours).toBe("Lundi")                        // l'original n'est pas modifié
    const c1 = construireConfig(e3, [], null), c2 = construireConfig(e4, [], null)
    expect(signature(c1)).toBe(signature(construireConfig(e3, [], null)))
    expect(typeof signature(c2)).toBe("number")
  })
})
