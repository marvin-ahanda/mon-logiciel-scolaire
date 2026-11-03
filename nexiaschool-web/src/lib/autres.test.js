import { describe, expect, it } from "vitest"
import { calculerBilans } from "./discipline.js"
import { age, effectifsSexeAge, repartition, resume } from "./statistiques.js"
import { calculerResultats } from "./calculs.js"
import { statistiquesClasse } from "./statistiques.js"

describe("discipline", () => {
  it("note de discipline et rubriques", () => {
    const b = calculerBilans(["a", "b"], [{ inscription_id: "a", heures_non_justifiees: 3, heures_justifiees: 2 }],
      [{ inscription_id: "a" }, { inscription_id: "a" }], [{ inscription_id: "a", libelle: "Bavardage", points: "1.5" }],
      { note_max: 20, points_par_retard: 0.25, points_par_heure: 0.25 })
    expect(b.get("a")).toMatchObject({ nj: 3, j: 2, retards: 2, pointsPonctualite: 0.5, pointsAssiduite: 0.75, pointsAutres: 1.5, note: 17.25, appreciation: "Très bien" })
    expect(b.get("b").note).toBe(20)
  })
  it("la note ne descend pas sous zéro", () => {
    const b = calculerBilans(["a"], [{ inscription_id: "a", heures_non_justifiees: 24, heures_justifiees: 0 }], [], [],
      { note_max: 20, points_par_retard: 1, points_par_heure: 1 })
    expect(b.get("a").note).toBe(0)
  })
})

describe("statistiques", () => {
  it("résumé et répartition par tranches et par sexe", () => {
    expect(resume([8, 12, 15.5, null])).toEqual({ n: 3, moyenne: 11.83, min: 8, max: 15.5, reussite: 2, taux: 66.67 })
    const r = repartition({ M: [4.99, 5, 10], F: [20, 16] })
    expect(r.find((l) => l.libelle === "[0 ; 5[")).toMatchObject({ total: 1, parSexe: { M: 1, F: 0 } })
    expect(r.find((l) => l.libelle === "[16 ; 20]")).toMatchObject({ total: 2, parSexe: { M: 0, F: 2 } })
  })
  it("statistiques d'une classe par sexe et par matière", () => {
    const attributions = [{ id: "m", matiere: "Maths", coefficient: 4, groupe: 1 }]
    const eleves = [{ inscriptionId: "a", eleve: { sexe: "M" } }, { inscriptionId: "b", eleve: { sexe: "F" } }]
    const { resultats } = calculerResultats(eleves, attributions, new Map([["a|m", 14], ["b|m", 6]]))
    const s = statistiquesClasse(resultats, attributions)
    expect(s.global).toMatchObject({ n: 2, moyenne: 10, reussite: 1 })
    expect(s.parSexe.F).toMatchObject({ n: 1, moyenne: 6 })
    expect(s.matieres[0].tous).toMatchObject({ n: 2, taux: 50 })
  })
  it("âge au 1er janvier et effectifs", () => {
    const ref = new Date(Date.UTC(2027, 0, 1))
    expect(age("2015-01-01", ref)).toBe(12)
    expect(age("2015-01-02", ref)).toBe(11)
    const e = effectifsSexeAge([{ id: "c", libelle: "6e" }],
      [{ classe_id: "c", eleves: { sexe: "M", date_naissance: "2015-03-01" } }, { classe_id: "c", eleves: { sexe: "F", date_naissance: null } }], "2026-2027")
    expect(e.colonnes).toEqual([11, "inconnu"])
    expect(e.lignes[0]).toMatchObject({ garcons: 1, filles: 1 })
  })
})

import { enDate, enNote, enSexe, normaliser } from "./excel.js"
describe("conversions Excel", () => {
  it("dates, notes, sexe, en-têtes", () => {
    expect(enDate("14/02/2013")).toBe("2013-02-14")
    expect(enDate("2013-02-14")).toBe("2013-02-14")
    expect(() => enDate("31/02/2013")).toThrow()
    expect(enNote("12,5")).toBe(12.5)
    expect(enNote(null)).toBeNull()
    expect(() => enNote(21)).toThrow()
    expect(enSexe("Garçon")).toBe("M")
    expect(enSexe("f")).toBe("F")
    expect(enSexe("x")).toBeNull()
    expect(normaliser("Date de naissance")).toBe("datedenaissance")
  })
})
