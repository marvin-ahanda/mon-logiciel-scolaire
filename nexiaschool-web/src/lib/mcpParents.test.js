// Serveur MCP : un jeton « nxa_… » (assistant d'un parent) n'ouvre que les outils « parent », tous servis par api_parent.
import { afterEach, describe, expect, it } from "vitest"
import { OUTILS_PARENT, remplacerFetch, traiter } from "../../supabase/functions/mcp/index.ts"

const CLE_PARENT = "nxa_" + "a".repeat(48)
const appels = []
afterEach(() => { appels.length = 0 })
remplacerFetch(async (url, init) => {
  appels.push({ nom: url.split("/rpc/")[1], corps: JSON.parse(init.body) })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})

const requete = (corps, cle = CLE_PARENT) => new Request("https://exemple.test/mcp", {
  method: "POST", headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) })

describe("MCP des parents", () => {
  it("liste uniquement les outils du parent", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()
    const noms = r.result.tools.map((o) => o.name)
    expect(noms).toEqual(OUTILS_PARENT.map((o) => o.name))
    expect(noms).not.toContain("saisir_notes")
    expect(noms).not.toContain("lister_eleves")
  })
  it("transmet l'outil et ses arguments à api_parent avec la clé", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bulletin", arguments: { periode: "t1" } } }))).json()
    expect(r.result.isError).toBeUndefined()
    expect(appels).toEqual([{ nom: "api_parent", corps: { p_cle: CLE_PARENT, p_outil: "bulletin", p_args: { periode: "t1" } } }])
  })
  it("refuse un outil du personnel", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "saisir_notes", arguments: {} } }))).json()
    expect(r.error.code).toBe(-32602)
    expect(appels).toEqual([])
  })
  it("présente des instructions propres aux parents et vérifie la clé à l'initialisation", async () => {
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json()
    expect(r.result.instructions).toMatch(/SON enfant/)
    expect(appels[0]).toMatchObject({ nom: "api_parent", corps: { p_outil: "contexte" } })
  })
  it("limite les lots à 10 messages pour un parent", async () => {
    const lot = Array.from({ length: 11 }, (_, k) => ({ jsonrpc: "2.0", id: k, method: "ping" }))
    const r = await traiter(requete(lot))
    expect(r.status).toBe(400)
  })
  it("renvoie l'erreur d'un outil (sans exception SQL) comme résultat en erreur", async () => {
    remplacerFetch(async () => new Response(JSON.stringify({ erreur: "Courrier introuvable (voir l'outil courriers)." }), { status: 200 }))
    const r = await (await traiter(requete({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "repondre_courrier", arguments: { courrier_id: "x", message: "ok" } } }))).json()
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toMatch(/Courrier introuvable/)
  })
  it("refuse une clé mal formée (401)", async () => {
    const r = await traiter(requete({ jsonrpc: "2.0", id: 5, method: "tools/list" }, "nxa_court"))
    expect(r.status).toBe(401)
  })
})
