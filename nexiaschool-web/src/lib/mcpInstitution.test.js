// Serveur MCP : une clé « nxd_… » (délégation) n'ouvre que des outils de lecture, tous servis par api_institution.
import { afterEach, describe, expect, it } from "vitest"
import { OUTILS_INSTITUTION, remplacerFetch, traiter } from "../../supabase/functions/mcp/index.ts"
import { compterAnomalies, lireValeur, normaliserBrouillon, sourceValeur, tauxLigne } from "./institution.js"

const CLE = "nxd_" + "c".repeat(48)
const appels = []
let reponse = { perimetre: "Délégation départementale — Mfoundi", periode: "T1 2026-2027", nb_fiches_utilisees: 2, lecture_seule: true, donnees: {} }
afterEach(() => { appels.length = 0 })
remplacerFetch(async (url, init) => {
  appels.push({ nom: url.split("/rpc/")[1], corps: JSON.parse(init.body) })
  return new Response(JSON.stringify(reponse), { status: 200 })
})
const requete = (corps, cle = CLE) => new Request("https://exemple.test/mcp", {
  method: "POST", headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) })

describe("MCP des délégations", () => {
  it("ne propose que des outils en lecture seule, sans outil d'établissement", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()
    const noms = r.result.tools.map((o) => o.name)
    expect(noms).toEqual(OUTILS_INSTITUTION.map((o) => o.name))
    expect(r.result.tools.every((o) => o.annotations?.readOnlyHint)).toBe(true)
    for (const interdit of ["saisir_notes", "enregistrer_paiement", "publier", "repondre_courrier"]) expect(noms).not.toContain(interdit)
  })
  it("refuse un outil d'écriture sans rien appeler", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "saisir_notes", arguments: {} } }))).json()
    expect(r.error.code).toBe(-32602)
    expect(appels).toEqual([])
  })
  it("transmet la clé à api_institution et renvoie période, périmètre et nombre de fiches", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "consolidation", arguments: { periode: "t1" } } }))).json()
    expect(appels).toEqual([{ nom: "api_institution", corps: { p_cle: CLE, p_outil: "consolidation", p_args: { periode: "t1" } } }])
    const texte = JSON.parse(r.result.content[0].text)
    expect(texte).toMatchObject({ periode: "T1 2026-2027", nb_fiches_utilisees: 2, lecture_seule: true })
  })
  it("annonce la lecture seule et l'absence de mandat officiel dès l'initialisation", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json()
    expect(r.result.instructions).toMatch(/LECTURE SEULE/)
    expect(r.result.instructions).toMatch(/non mandaté par le MINESEC/)
    expect(appels[0].nom).toBe("api_institution")
  })
  it("refuse une clé mal formée", async () => {
    const r = await traiter(requete({ jsonrpc: "2.0", id: 5, method: "tools/list" }, "nxd_123"))
    expect(r.status).toBe(401)
  })
})

describe("saisie des fiches statistiques", () => {
  it("distingue nombre, non applicable et donnée manquante", () => {
    expect(lireValeur("12,5")).toBe(12.5)
    expect(lireValeur("NA")).toBe("na")
    expect(lireValeur("")).toBeNull()
    expect(lireValeur("abc")).toBeNull()
  })
  it("calcule le taux d'une ligne comme le serveur (incomplet, non applicable ou dénominateur nul → pas de taux)", () => {
    expect(tauxLigne({ prevues_t: 10, faites_t: 6, digit_t: 2 }, ["faites_t", "digit_t"], "prevues_t")).toBe(80)
    expect(tauxLigne({ prevues_t: 10, faites_t: null, digit_t: 2 }, ["faites_t", "digit_t"], "prevues_t")).toBeNull()
    expect(tauxLigne({ prevues_t: "na", faites_t: 3 }, ["faites_t"], "prevues_t")).toBeNull()
    expect(tauxLigne({ prevues_t: 0, faites_t: 3 }, ["faites_t"], "prevues_t")).toBeNull()
  })
  it("normalise un brouillon incomplet sans inventer de valeur", () => {
    const b = normaliserBrouillon({ lignes: [{ classe: "6e", prevues_t: 4 }] })
    expect(b.lignes[0]).toMatchObject({ classe: "6e", prevues_t: 4, faites_t: null, source: "manuel" })
    expect(b.synthese.eleves).toBeNull()
    expect(b.assiduite.eleves).toEqual({ heures_dues: null, heures_absence: null })
  })
  it("qualifie la source d'une valeur et compte les anomalies", () => {
    expect(sourceValeur(12, "auto")).toBe("calculee")
    expect(sourceValeur(12, "manuel")).toBe("saisie")
    expect(sourceValeur(null, "auto")).toBe("manquante")
    expect(sourceValeur("na")).toBe("non_applicable")
    expect(compterAnomalies([{ niveau: "alerte" }, { niveau: "alerte" }, { niveau: "bloquant" }])).toEqual({ bloquant: 1, alerte: 2, info: 0 })
  })
})
