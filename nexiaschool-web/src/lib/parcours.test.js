import { describe, expect, it } from "vitest"
import { libelleDestination, mentionDe, proposer } from "./parcours.js"

const regles = [
  { id: "r1", niveau_origine_id: "3e", niveau_destination_id: "2nde", serie_destination_id: "C", type: "changement_cycle", sur_demande: true,
    conditions: { moyenne_min: 10, matieres: [{ code: "MATH", min: 12 }] }, classes_destination: ["2C"], ordre: 1 },
  { id: "r2", niveau_origine_id: "3e", niveau_destination_id: "2nde", serie_destination_id: "A4", type: "changement_cycle", sur_demande: false, conditions: { moyenne_min: 10 }, classes_destination: [], ordre: 2 },
  { id: "r3", niveau_origine_id: "2nde", serie_origine_id: "C", niveau_destination_id: "1re", serie_destination_id: "C", type: "promotion", conditions: {}, classes_destination: [], ordre: 1 },
  { id: "r4", niveau_origine_id: "2nde", serie_origine_id: "C", niveau_destination_id: "1re", serie_destination_id: "D", type: "orientation", sur_demande: true, conditions: {}, classes_destination: [], ordre: 2 },
]
const eleve = (x) => ({ niveauId: "3e", serieId: null, moyenne: 13, decisionFin: "admis", lignes: [{ code: "MATH", note: 14 }], orientation: null, ...x })

describe("proposition de décision de passage", () => {
  it("3e → 2nde A4 par défaut ; 2nde C seulement sur orientation acceptée et conditions remplies", () => {
    expect(proposer(eleve(), regles)).toMatchObject({ decision: "change_cycle", serie_destination_id: "A4", regle_id: "r2" })
    expect(proposer(eleve({ orientation: { serie_id: "C" } }), regles)).toMatchObject({ decision: "change_cycle", serie_destination_id: "C", classe_destination_id: "2C" })
    const p = proposer(eleve({ orientation: { serie_id: "C" }, lignes: [{ code: "MATH", note: 9 }] }), regles)
    expect(p.decision).toBe("attente_conseil")
    expect(p.raison).toMatch(/conditions d'accès/)
  })
  it("2nde C → 1re C (promotion) ou 1re D (orientation demandée)", () => {
    expect(proposer(eleve({ niveauId: "2nde", serieId: "C" }), regles)).toMatchObject({ decision: "promu", serie_destination_id: "C" })
    expect(proposer(eleve({ niveauId: "2nde", serieId: "C", orientation: { serie_id: "D" } }), regles)).toMatchObject({ decision: "promu", serie_destination_id: "D" })
  })
  it("redoublement, exclusion, rattrapage, absence de règle, fin de cycle", () => {
    expect(proposer(eleve({ decisionFin: "redouble", niveauId: "2nde", serieId: "C" }), regles)).toMatchObject({ decision: "redoublant", niveau_destination_id: "2nde", serie_destination_id: "C" })
    expect(proposer(eleve({ decisionFin: "exclu" }), regles).decision).toBe("exclu")
    expect(proposer(eleve({ decisionFin: "rattrapage" }), regles).decision).toBe("admis_sous_condition")
    expect(proposer(eleve({ decisionFin: null }), regles).decision).toBe("attente_conseil")
    expect(proposer(eleve({ niveauId: "Tle" }), regles, { niveaux: [{ id: "Tle", fin_de_cycle: true }] }).decision).toBe("diplome")
    expect(proposer(eleve({ niveauId: "Tle" }), regles).decision).toBe("attente_conseil")
  })
})

describe("mention officielle", () => {
  it("mentions générées", () => {
    expect(mentionDe("promu", libelleDestination({ niveau: { libelle: "2nde" }, serie: { code: "A4 esp" } }))).toBe("Promu(e) en 2nde A4 esp")
    expect(mentionDe("change_cycle", libelleDestination({ niveau: { libelle: "2nde" }, serie: { code: "C" } }))).toBe("Promu(e) en 2nde C")
    expect(mentionDe("promu", libelleDestination({ classe: { libelle: "1re D" }, niveau: { libelle: "1re" } }))).toBe("Promu(e) en 1re D")
    expect(mentionDe("redoublant", "")).toBe("Redoublant(e)")
    expect(mentionDe("admis_sous_condition", "")).toBe("Admis(e) sous condition")
    expect(mentionDe("oriente", "Technique industriel")).toBe("Orienté(e) vers Technique industriel")
    expect(mentionDe("transfere", "3e B")).toBe("Transféré(e) vers 3e B")
  })
  it("modèles de l'établissement et de la règle ; destination absente", () => {
    expect(mentionDe("promu", "2nde C", { modeles: { promu: "Passe en {destination}" } })).toBe("Passe en 2nde C")
    expect(mentionDe("promu", "1re C", { modeleRegle: "Admis(e) en {destination} (série scientifique)" })).toBe("Admis(e) en 1re C (série scientifique)")
    expect(mentionDe("promu", "")).toBe("Promu(e)")
  })
})
