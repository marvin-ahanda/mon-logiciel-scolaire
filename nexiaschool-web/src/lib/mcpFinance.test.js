// Serveur MCP : outils financiers en lecture seule, servis par api_finance (droits, période, journal vérifiés par la base).
import { afterEach, describe, expect, it } from "vitest"
import { OUTILS_FINANCE, remplacerFetch, traiter } from "../../supabase/functions/mcp/index.ts"

const CLE = "nxs_" + "b".repeat(48)
const appels = []
let reponse = { periode: { debut: "2026-11-01", fin: "2026-11-24", origine: "mois_en_cours" }, manquants: [], lecture_seule: true, resultat: { ok: true } }
afterEach(() => { appels.length = 0 })
remplacerFetch(async (url, init) => {
  appels.push({ nom: url.split("/rpc/")[1], corps: JSON.parse(init.body) })
  return new Response(JSON.stringify(reponse), { status: 200 })
})
const requete = (corps) => new Request("https://exemple.test/mcp", {
  method: "POST", headers: { Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) })
const appeler = async (name, args) => (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }))).json()

describe("MCP : assistant financier", () => {
  it("expose les outils financiers, tous en lecture seule", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()
    const finance = r.result.tools.filter((o) => o.name.startsWith("finance_"))
    expect(finance.map((o) => o.name)).toEqual(OUTILS_FINANCE)
    expect(finance.every((o) => o.annotations.readOnlyHint === true)).toBe(true)
  })
  it("transmet l'outil, la période et la clé à api_finance, et renvoie les chiffres du serveur", async () => {
    const r = await appeler("finance_rapport", { type: "impayes", annee_scolaire: "2026-2027" })
    expect(appels).toEqual([{ nom: "api_finance", corps: { p_cle: CLE, p_outil: "finance_rapport", p_args: { type: "impayes", annee_scolaire: "2026-2027" } } }])
    expect(JSON.parse(r.result.content[0].text).periode.origine).toBe("mois_en_cours")
  })
  it("un refus de droit (paie, assistant) remonte comme une erreur, sans données", async () => {
    reponse = { erreur: "Les données de paie sont réservées au droit « paie ».", statut: "refuse" }
    const r = await appeler("finance_rapport", { type: "masse_salariale" })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toMatch(/paie/)
    reponse = { resultat: {} }
  })
  it("aucun outil financier d'écriture n'est proposé", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()
    const noms = r.result.tools.map((o) => o.name)
    for (const interdit of ["annuler_paiement", "valider_depense", "virement", "payer_paie", "modifier_facture"]) expect(noms.some((n) => n.includes(interdit))).toBe(false)
  })
})
