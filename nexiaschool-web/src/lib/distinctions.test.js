import { describe, expect, it } from "vitest"
import { conditionsManquantes, dansCible, periodePrecedente, preselection, progression, remplirTexte, resumeCriteres } from "./distinctions.js"

const classe = (id, niveau = "6e", cycle = 1) => ({ id, libelle: id.toUpperCase(), niveau, cycle, section_id: "fr" })
const s = (id, moyenne, extra = {}) => ({ inscriptionId: id, eleve: { nom: id }, classe: classe(extra.classe || "6a"), moyenne, moyenneNonClassee: null,
  lignes: [{ code: "MATH", note: extra.math ?? 12, groupe: 1 }, { code: "FR", note: extra.fr ?? 11, groupe: 1 }],
  groupes: [{ groupe: 1, moyenne: extra.g1 ?? 11.5 }], conduite: { nj: extra.nj ?? 0, retards: 0, note: extra.disc ?? 16, sanctions: extra.sanctions ?? 0 },
  paiement: extra.paiement === undefined ? { en_regle: true, solde: false } : extra.paiement, precedente: extra.prec ?? null, ...extra.autres })

describe("conditions d'éligibilité", () => {
  it("bornes de moyenne (min incluse, max exclue)", () => {
    expect(conditionsManquantes({ moyenne_min: 12, moyenne_max: 14 }, s("a", 12))).toEqual([])
    expect(conditionsManquantes({ moyenne_min: 12, moyenne_max: 14 }, s("a", 14))).toContain("moyenne_max")
    expect(conditionsManquantes({ moyenne_min: 12 }, s("a", 11.99))).toContain("moyenne_min")
  })
  it("élève non classé exclu par défaut, accepté si l'établissement le veut", () => {
    const nc = { ...s("a", null), moyenneNonClassee: 15 }
    expect(conditionsManquantes({ moyenne_min: 12 }, nc)).toContain("moyenne_min")
    expect(conditionsManquantes({ moyenne_min: 12, classe_requise: false }, nc)).toEqual([])
  })
  it("matière, groupe, note minimale partout", () => {
    expect(conditionsManquantes({ matieres: [{ code: "math", min: 13 }] }, s("a", 15))).toEqual(["matiere:math"])
    expect(conditionsManquantes({ groupes: [{ groupe: 1, min: 12 }] }, s("a", 15))).toEqual(["groupe:1"])
    expect(conditionsManquantes({ note_min_toutes: 11 }, s("a", 15, { fr: 10.5 }))).toEqual(["note_min_toutes"])
  })
  it("assiduité, discipline, sanctions, paiement, progression", () => {
    expect(conditionsManquantes({ nj_max: 4 }, s("a", 15, { nj: 5 }))).toEqual(["nj_max"])
    expect(conditionsManquantes({ discipline_min: 17 }, s("a", 15))).toEqual(["discipline_min"])
    expect(conditionsManquantes({ sans_sanction: true }, s("a", 15, { sanctions: 1 }))).toEqual(["sans_sanction"])
    expect(conditionsManquantes({ paiement: "en_regle" }, s("a", 15, { paiement: null }))).toEqual(["paiement"])
    expect(conditionsManquantes({ paiement: "solde" }, s("a", 15))).toEqual(["paiement"])
    expect(conditionsManquantes({ progression_min: 1 }, s("a", 12, { prec: 11.5 }))).toEqual(["progression_min"])
    expect(conditionsManquantes({ progression_min: 1 }, s("a", 12, { prec: 10 }))).toEqual([])
    expect(progression(s("a", 12, { prec: 10.75 }))).toBe(1.25)
  })
})

describe("cible et sélection", () => {
  it("cible par classe, niveau, cycle", () => {
    expect(dansCible({}, classe("6a"))).toBe(true)
    expect(dansCible({ niveaux: ["5e"] }, classe("6a"))).toBe(false)
    expect(dansCible({ cycles: [1], classes: ["6a", "6b"] }, classe("6a"))).toBe(true)
  })
  it("tous les éligibles au-dessus du seuil", () => {
    const r = preselection({ criteres: { moyenne_min: 12 }, selection: { mode: "seuils" } }, [s("a", 13), s("b", 11), s("c", 12)])
    expect(r.map((x) => x.situation.inscriptionId)).toEqual(["a", "c"])
  })
  it("meilleur de chaque classe, ex æquo inclus", () => {
    const r = preselection({ criteres: {}, selection: { mode: "meilleurs", portee: "classe", nombre: 1 } },
      [s("a", 15), s("b", 15), s("c", 14), s("d", 13, { classe: "6b" }), s("e", 9, { classe: "6b" })])
    expect(r.map((x) => x.situation.inscriptionId).sort()).toEqual(["a", "b", "d"])
  })
  it("meilleur de l'établissement et meilleure progression", () => {
    const liste = [s("a", 15, { prec: 14.5 }), s("b", 12, { prec: 9 }), s("d", 16, { classe: "6b", prec: 15 })]
    expect(preselection({ criteres: {}, selection: { mode: "meilleurs", portee: "etablissement", nombre: 1 } }, liste)[0].situation.inscriptionId).toBe("d")
    const p = preselection({ criteres: {}, selection: { mode: "meilleurs", portee: "etablissement", nombre: 1, par: "progression" } }, liste)
    expect(p.map((x) => x.situation.inscriptionId)).toEqual(["b"])
    expect(p[0].valeurs.progression).toBe(3)
  })
})

describe("outils", () => {
  it("période précédente de même type seulement", () => {
    const p = [{ code: "s1", type: "sequence" }, { code: "s2", type: "sequence" }, { code: "t1", type: "trimestre" }]
    expect(periodePrecedente(p[1], p).code).toBe("s1")
    expect(periodePrecedente(p[2], p)).toBe(null)
  })
  it("variables du certificat et résumé", () => {
    expect(remplirTexte("Décerné à {eleve} ({classe}){inconnu}", { eleve: "ABENA Grâce", classe: "6e A" })).toBe("Décerné à ABENA Grâce (6e A)")
    expect(resumeCriteres({ moyenne_min: 12.5, sans_sanction: true })).toBe("moyenne ≥ 12,5 · aucune sanction")
  })
})
