import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { analyserEvaluation, attenduTexte, copiesEleves, estCorrigible, reponseTexte } from "./smarteval.js"

const questions = [
  { id: "q1", type: "choix", intitule: "1/2 + 1/4", options: ["3/4", "2/6"], bonnes: [0], points: 2, notion: "Fractions" },
  { id: "q2", type: "cases", intitule: "Pairs", options: ["2", "3", "4"], bonnes: [0, 2], points: 2, notion: "Parité" },
  { id: "q3", type: "paragraphe", intitule: "Expliquez", points: 3, notion: "Fractions" },
  { id: "q4", type: "echelle", intitule: "Difficulté", echelle: { min: 1, max: 5 }, points: 0 },
]
const soumission = (numero, nom, q1, q2, note20) => ({ numero, nom, prenom: "A", classe: "6e A", note20, a_corriger: 1,
  reponses: { q1, q2, q3: "texte", q4: 3 }, details: [{ id: "q1", correct: q1 === 0, obtenu: q1 === 0 ? 2 : 0, max: 2 },
    { id: "q2", correct: JSON.stringify(q2) === "[0,2]", obtenu: JSON.stringify(q2) === "[0,2]" ? 2 : 0, max: 2 }, { id: "q3", correct: null, a_corriger: true }] })

describe("SmartEval : analyse des soumissions", () => {
  const ev = { questions, soumissions: [soumission(1, "BELLA", 0, [0, 2], 20), soumission(2, "NGO", 1, [0, 2], 10), soumission(3, "ABA", 1, [1], 0)] }
  const a = analyserEvaluation(ev)
  it("synthèse : taux de réussite, moyenne, médiane", () => {
    expect(a.synthese).toMatchObject({ soumissions: 3, moyenne: 10, mediane: 10, taux_reussite: 66.7, reponses_a_apprecier: 3 })
  })
  it("réussite par question et répartition des réponses", () => {
    expect(a.par_question[0]).toMatchObject({ corrigible: true, justes: 1, taux_reussite: 33.3, attendu: "3/4" })
    expect(a.par_question[0].repartition).toEqual([{ reponse: "3/4", nombre: 1, bonne: true }, { reponse: "2/6", nombre: 2, bonne: false }])
    expect(a.par_question[2].corrigible).toBe(false)
    expect(a.par_question[3].repartition.find((r) => r.reponse === "3").nombre).toBe(3)
  })
  it("notions : les moins réussies d'abord, élèves en difficulté et à l'aise", () => {
    expect(a.par_notion.map((n) => n.notion)).toEqual(["Fractions", "Parité"])
    expect(a.par_notion[0]).toMatchObject({ taux_reussite: 33.3, eleves_en_difficulte: ["NGO A", "ABA A"], eleves_a_l_aise: ["BELLA A"] })
  })
  it("profils des élèves : notions à revoir et maîtrisées", () => {
    const aba = a.eleves.find((e) => e.eleve === "ABA A")
    expect(aba).toMatchObject({ reussi: false, notions_a_revoir: ["Fractions", "Parité"], notions_maitrisees: [] })
    expect(a.eleves[0].eleve).toBe("BELLA A")
  })
  it("copies lisibles", () => {
    const c = copiesEleves(ev)[2]
    expect(c.reponses[1]).toMatchObject({ reponse: "3", attendu: "2 ; 4", resultat: "faux", points: "0/2" })
    expect(c.reponses[2].resultat).toBe("à apprécier")
    expect(reponseTexte(questions[1], [0, 2])).toBe("2 ; 4")
    expect(attenduTexte({ type: "courte", acceptees: ["Yaoundé", "Yaounde"] })).toBe("Yaoundé / Yaounde")
    expect(estCorrigible({ type: "courte", acceptees: [], points: 1 })).toBe(false)
  })
  it("le serveur MCP utilise exactement le même module", () => {
    const racine = join(__dirname, "..", "..")
    expect(readFileSync(join(racine, "supabase/functions/mcp/smarteval.js"), "utf8")).toBe(readFileSync(join(racine, "src/lib/smarteval.js"), "utf8"))
  })
})
