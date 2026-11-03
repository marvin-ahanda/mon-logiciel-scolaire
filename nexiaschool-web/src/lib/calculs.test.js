import { describe, expect, it } from "vitest"
import { appreciation, arrondi, calculerResultats, moyennePonderee, moyenneSimple, notePeriode, rangs } from "./calculs.js"

describe("règles reprises du logiciel d'origine", () => {
  it("appréciations et bornes", () => {
    expect(appreciation(2.99)).toBe("Nul")
    expect(appreciation(3)).toBe("Très faible")
    expect(appreciation(9.99)).toBe("Médiocre")
    expect(appreciation(10)).toBe("Passable")
    expect(appreciation(17.99)).toBe("Très bien")
    expect(appreciation(20)).toBe("Excellent")
    expect(appreciation(null)).toBe("")
  })
  it("arrondi à la moitié supérieure", () => {
    expect(arrondi(11.125)).toBe(11.13)
    expect(arrondi(13.142857)).toBe(13.14)
  })
  it("rangs olympiques avec ex æquo", () => {
    expect(rangs([12, 15, 12, null, 9])).toEqual([
      { rang: 2, exAequo: true }, { rang: 1, exAequo: false }, { rang: 2, exAequo: true },
      { rang: null, exAequo: false }, { rang: 4, exAequo: false }])
  })
  it("moyenne pondérée sans erreurs d'arrondi", () => {
    expect(moyennePonderee([{ note: 14, coefficient: 4 }, { note: 12, coefficient: 3 }, { note: null, coefficient: 2 }]))
      .toEqual({ totalCoef: 7, totalPoints: 92, moyenne: 13.14 })
    expect(moyenneSimple([10.1, 10.2])).toBe(10.15)
  })
  it("notes de trimestre et d'année", () => {
    const seq = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `s${n}`, numero: n, trimestre: Math.ceil(n / 2) }))
    const notes = new Map([["s1", 10], ["s2", 13], ["s3", 8], ["s5", 16], ["s6", 15]])
    expect(notePeriode({ type: "sequence", sequenceId: "s4" }, notes, seq)).toBeNull()
    expect(notePeriode({ type: "trimestre", trimestre: 1 }, notes, seq)).toBe(11.5)
    expect(notePeriode({ type: "trimestre", trimestre: 2 }, notes, seq)).toBe(8)
    expect(notePeriode({ type: "annee" }, notes, seq)).toBe(11.67)     // (11,5 + 8 + 15,5) / 3
  })
  it("résultats d'une classe : coefficients minimum et statistiques", () => {
    const attributions = [{ id: "m", matiere: "Maths", coefficient: 4, groupe: 1 }, { id: "f", matiere: "Français", coefficient: 3, groupe: 1 }]
    const eleves = ["a", "b", "c"].map((x) => ({ inscriptionId: x, eleve: { nom: x } }))
    const notes = new Map([["a|m", 14], ["a|f", 12], ["b|m", 6], ["b|f", 8], ["c|m", 11]])
    const { resultats, stats } = calculerResultats(eleves, attributions, notes, 5)
    expect(resultats[0]).toMatchObject({ moyenne: 13.14, rang: 1, appreciation: "Assez bien" })
    expect(resultats[1]).toMatchObject({ moyenne: 6.86, rang: 2 })
    expect(resultats[2]).toMatchObject({ moyenne: null, moyenneNonClassee: 11, rang: null })   // coef 4 < 5
    expect(resultats[0].lignes[0]).toMatchObject({ rang: 1, points: 56 })
    expect(stats).toMatchObject({ effectif: 3, classes: 2, moyenneClasse: 10, reussis: 1, tauxReussite: 50 })
  })
})
