import { beforeEach, describe, expect, it, vi } from "vitest"

// Environnement navigateur minimal : stockage, état du réseau, évènements
const stockage = new Map()
vi.stubGlobal("localStorage", { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) })
const reseau = { onLine: true }
vi.stubGlobal("navigator", { get onLine() { return reseau.onLine }, languages: ["fr-FR"] })
vi.stubGlobal("window", new EventTarget())
vi.stubGlobal("CustomEvent", class extends Event { constructor(n, o) { super(n); this.detail = o?.detail } })

// Faux client Supabase : enregistre les appels ; « panne » simule une coupure, « refus » une erreur du serveur
const appels = []
let panne = false, refus = null
function requete(table) {
  const r = { table, filtres: [] }
  const fin = () => {
    if (panne) return Promise.resolve({ error: { message: "TypeError: Failed to fetch" } })
    if (refus) return Promise.resolve({ error: { message: refus } })
    appels.push(r); return Promise.resolve({ error: null })
  }
  const chaine = { eq: (c, v) => { r.filtres.push([c, v]); return chaine }, in: (c, v) => { r.filtres.push([c, v]); return fin() } }
  return {
    upsert: (lignes, o) => { r.action = "upsert"; r.lignes = lignes; r.options = o; return fin() },
    delete: () => { r.action = "delete"; return chaine },
  }
}
vi.mock("../supabase.js", () => ({
  supabase: { from: (t) => requete(t), auth: { getSession: async () => ({ data: { session: { user: { id: "moi" } } } }) } },
  sessionLocale: () => null,
}))
const { abandonner, enAttente, envoyer, synchroniser } = await import("./horsLigne.js")

const notes = (valeur) => ({ attribution_id: "a1", sequence_id: "s1", ecrire: [{ inscription_id: "i1", valeur }], effacer: [] })

describe("saisies hors ligne", () => {
  beforeEach(() => { stockage.clear(); appels.length = 0; panne = false; refus = null; reseau.onLine = true })

  it("en ligne : enregistre tout de suite", async () => {
    expect(await envoyer("notes", notes(12), "Notes")).toEqual({ enAttente: false })
    expect(appels[0]).toMatchObject({ table: "notes", action: "upsert", lignes: [{ inscription_id: "i1", valeur: 12, attribution_id: "a1", sequence_id: "s1" }] })
    expect(enAttente("moi")).toEqual([])
  })

  it("hors ligne : garde la saisie sur l'appareil, puis l'envoie dans l'ordre au retour du réseau", async () => {
    reseau.onLine = false
    expect(await envoyer("notes", notes(10), "Notes 1")).toEqual({ enAttente: true })
    expect(await envoyer("appel", { sequence_id: "s1", date: "2026-11-06", absences: [{ inscription_id: "i1", heures_non_justifiees: 2, heures_justifiees: 0, motif: "" }],
                                    effacerAbsences: [], retards: ["i2"], effacerRetards: ["i3"] }, "Appel")).toEqual({ enAttente: true })
    expect(await envoyer("notes", notes(14), "Notes 2")).toEqual({ enAttente: true })
    expect(appels).toEqual([])
    expect(enAttente("moi").map((x) => x.description)).toEqual(["Notes 1", "Appel", "Notes 2"])
    expect(await synchroniser()).toEqual({ envoyees: 0, refusees: 0 })        // toujours hors ligne : rien ne part
    reseau.onLine = true
    expect(await synchroniser()).toEqual({ envoyees: 3, refusees: 0 })
    expect(appels.map((a) => `${a.table}:${a.action}`)).toEqual(["notes:upsert", "absences:upsert", "retards:upsert", "retards:delete", "notes:upsert"])
    expect(appels.at(-1).lignes[0].valeur).toBe(14)                              // la dernière saisie l'emporte
    expect(enAttente("moi")).toEqual([])
  })

  it("une coupure pendant l'envoi garde la saisie pour plus tard", async () => {
    panne = true
    expect(await envoyer("notes", notes(11), "Notes")).toEqual({ enAttente: true })
    expect(await synchroniser()).toEqual({ envoyees: 0, refusees: 0 })
    expect(enAttente("moi")).toHaveLength(1)
    panne = false
    expect(await synchroniser()).toEqual({ envoyees: 1, refusees: 0 })
  })

  it("un refus du serveur est signalé et peut être ignoré, sans bloquer les autres", async () => {
    reseau.onLine = false
    await envoyer("notes", notes(9), "Notes refusées"); await envoyer("notes", notes(8), "Notes suivantes")
    reseau.onLine = true; refus = "Opération refusée : la séquence est verrouillée."
    expect(await synchroniser()).toEqual({ envoyees: 0, refusees: 2 })
    expect(enAttente("moi").map((x) => x.erreur)).toEqual([refus, refus])
    refus = null
    expect(await synchroniser()).toEqual({ envoyees: 0, refusees: 0 })          // une saisie refusée n'est pas renvoyée seule
    abandonner(enAttente("moi")[0].id)
    expect(enAttente("moi")).toHaveLength(1)
  })

  it("une erreur du serveur en ligne est levée normalement (rien n'est mis en attente)", async () => {
    refus = "Action non autorisée pour votre rôle."
    await expect(envoyer("notes", notes(7), "Notes")).rejects.toThrow("Action non autorisée")
    expect(enAttente("moi")).toEqual([])
  })

  it("les saisies d'une autre personne ne sont ni affichées ni envoyées", async () => {
    stockage.set("nexiaschool.envois", JSON.stringify([{ id: "x", utilisateur: "autre", type: "notes", donnees: notes(5), description: "Autre" }]))
    expect(enAttente("moi")).toEqual([])
    expect(await synchroniser()).toEqual({ envoyees: 0, refusees: 0 })
    expect(appels).toEqual([])
  })
})
