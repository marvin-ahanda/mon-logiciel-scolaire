import { describe, expect, it } from "vitest"
import { critereRempli, decisionProposee, resumeCritere, sanctionsParEleve } from "./decisions.js"

const criteres = [
  { periode: "a", decision: "admis", ordre: 1, moyenne_min: 10, heures_nj_max: 30 },
  { periode: "a", decision: "rattrapage", ordre: 2, moyenne_min: 8, moyenne_max: 10 },
  { periode: "a", decision: "redouble", ordre: 3, moyenne_max: 8 },
  { periode: "a", decision: "exclu", ordre: 4, heures_nj_min: 60, libelle: "Exclu(e) pour absentéisme" },
  { periode: "a", decision: "exclu", ordre: 5, sanction_id: "blame", sanctions_min: 3 },
  { periode: "t1", decision: "redouble", ordre: 1, moyenne_max: 8 },
]
const situation = (moyenne, nj = 0, blames = 0, note = 18) => ({ moyenne, conduite: { nj, retards: 0, note }, sanctions: new Map([["blame", blames]]) })

describe("décisions de fin de période", () => {
  it("fin d'année : admission, rattrapage, redoublement selon les seuils de moyenne", () => {
    expect(decisionProposee(criteres, "a", situation(12)).decision).toBe("admis")
    expect(decisionProposee(criteres, "a", situation(10)).decision).toBe("admis")
    expect(decisionProposee(criteres, "a", situation(9.99))).toEqual({ decision: "rattrapage", libelle: "Admis(e) au rattrapage" })
    expect(decisionProposee(criteres, "a", situation(7.5)).decision).toBe("redouble")
  })
  it("l'exclusion prime, et un critère disciplinaire OU un autre suffit", () => {
    expect(decisionProposee(criteres, "a", situation(15, 60))).toEqual({ decision: "exclu", libelle: "Exclu(e) pour absentéisme" })
    expect(decisionProposee(criteres, "a", situation(15, 0, 3)).decision).toBe("exclu")
    expect(decisionProposee(criteres, "a", situation(15, 0, 2)).decision).toBe("admis")
  })
  it("bonne moyenne mais trop d'absences : aucun critère d'admission rempli -> conseil de classe", () => {
    expect(decisionProposee(criteres, "a", situation(14, 40))).toEqual({ decision: null, libelle: "À l'appréciation du conseil de classe" })
  })
  it("trimestre : critères propres à chaque trimestre ; sans critère, pas de décision", () => {
    expect(decisionProposee(criteres, "t1", situation(7)).libelle).toBe("Risque de redoublement")
    expect(decisionProposee(criteres, "t1", situation(12))).toBe(null)
    expect(decisionProposee(criteres, "t2", situation(7))).toBe(null)
    expect(decisionProposee(criteres, "s1", situation(7))).toBe(null)
  })
  it("sans aucun critère : règle par défaut de fin d'année (10/20)", () => {
    expect(decisionProposee([], "a", situation(10)).decision).toBe("admis")
    expect(decisionProposee([], "a", situation(9)).decision).toBe("redouble")
    expect(decisionProposee([], "a", situation(null))).toBe(null)
  })
  it("une moyenne absente ne remplit pas une condition de moyenne", () => {
    expect(critereRempli({ moyenne_min: 10 }, situation(null))).toBe(false)
  })
  it("sanctions comptées par élève sur la période ; résumé lisible", () => {
    const m = sanctionsParEleve([{ inscription_id: "i1", sequence_id: "s1", infractions: { sanction_id: "blame" } },
      { inscription_id: "i1", sequence_id: "s1", infractions: { sanction_id: "blame" } }, { inscription_id: "i1", sequence_id: "s9", infractions: { sanction_id: "blame" } }], [{ id: "s1" }])
    expect(m.get("i1").get("blame")).toBe(2)
    expect(resumeCritere(criteres[0])).toBe("moyenne ≥ 10 et absences non justifiées < 30 h")
    expect(resumeCritere({ sanction_id: "b", sanctions_min: 3 }, () => "Blâme")).toBe("« Blâme » reçu(e) au moins 3 fois")
  })
})
