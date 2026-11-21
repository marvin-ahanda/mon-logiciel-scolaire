// Serveur MCP : un jeton « nxe_… » (enseignant indépendant) n'ouvre que ses outils SmartEval, tous servis par api_enseignant.
import { afterEach, describe, expect, it } from "vitest"
import { OUTILS_ENSEIGNANT, remplacerFetch, traiter } from "../../supabase/functions/mcp/index.ts"

const CLE = "nxe_" + "b".repeat(48)
const appels = []
let reponse = { ok: true }
afterEach(() => { appels.length = 0; reponse = { ok: true } })
remplacerFetch(async (url, init) => {
  appels.push({ nom: url.split("/rpc/")[1], corps: JSON.parse(init.body) })
  return new Response(JSON.stringify(reponse), { status: 200 })
})
const requete = (corps, cle = CLE) => new Request("https://exemple.test/mcp", {
  method: "POST", headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) })

describe("MCP des enseignants indépendants", () => {
  it("liste uniquement les outils SmartEval de l'enseignant", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()
    const noms = r.result.tools.map((o) => o.name)
    expect(noms).toEqual(OUTILS_ENSEIGNANT.map((o) => o.name))
    expect(noms).not.toContain("saisir_notes")
    expect(noms).not.toContain("bulletin")
  })
  it("refuse un outil d'établissement sans rien appeler", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lister_eleves", arguments: {} } }))).json()
    expect(r.error.code).toBe(-32602)
    expect(appels).toEqual([])
  })
  it("passe par api_enseignant et met en forme l'analyse (copies anonymisées telles que reçues)", async () => {
    reponse = { id: "e1", titre: "Fractions", matiere: "Maths", classe: "6e", anonymisee: true, questions: [{ id: "q1", type: "choix", intitule: "?", options: ["a", "b"], bonnes: [0], points: 1 }],
      soumissions: [{ numero: 1, nom: "MAT-007", prenom: "", classe: "6e", note20: 20, reponses: { q1: 0 }, details: [{ id: "q1", correct: true, obtenu: 1, max: 1 }] }] }
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "smarteval_resultats", arguments: { evaluation: "Fractions" } } }))).json()
    expect(appels[0]).toEqual({ nom: "api_enseignant", corps: { p_cle: CLE, p_outil: "smarteval_resultats", p_args: { evaluation: "Fractions" } } })
    const contenu = JSON.parse(r.result.content[0].text)
    expect(contenu.evaluation.anonymisee).toBe(true)
    expect(contenu.copies[0].eleve).toBe("MAT-007")
    expect(contenu.synthese.taux_reussite).toBe(100)
  })
  it("renvoie l'erreur de l'outil (évaluation d'un autre enseignant) sans fuite", async () => {
    reponse = { erreur: "Évaluation introuvable." }
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "smarteval_resultats", arguments: { evaluation: "x" } } }))).json()
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toMatch(/introuvable/)
  })
  it("présente des instructions propres à l'enseignant et vérifie la clé à l'initialisation", async () => {
    reponse = { compte: { id: "c" } }
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 5, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json()
    expect(r.result.instructions).toMatch(/SES évaluations/)
    expect(appels[0]).toMatchObject({ nom: "api_enseignant", corps: { p_outil: "contexte" } })
  })
  it("refuse une clé mal formée", async () => {
    const r = await traiter(requete({ jsonrpc: "2.0", id: 6, method: "tools/list" }, "nxe_court"))
    expect(r.status).toBe(401)
  })
})
