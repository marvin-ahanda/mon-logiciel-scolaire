import { beforeEach, describe, expect, it, vi } from "vitest"

// Environnement navigateur minimal : stockage, état du réseau, évènements
const stockage = new Map()
vi.stubGlobal("localStorage", { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) })
const reseau = { onLine: true }
vi.stubGlobal("navigator", { get onLine() { return reseau.onLine }, languages: ["fr-FR"] })
vi.stubGlobal("window", new EventTarget())
vi.stubGlobal("CustomEvent", class extends Event { constructor(n, o) { super(n); this.detail = o?.detail } })

// Faux client Supabase : enregistre les appels ; « panne » simule une coupure, « refus » une erreur du serveur ;
// « serveur » contient les lignes renvoyées par les lectures (détection des conflits)
const appels = []
let panne = false, refus = null
const serveur = { notes: [], eleves: [] }
function requete(table) {
  const r = { table, filtres: [] }
  const fin = (donnees) => {
    if (panne) return Promise.resolve({ error: { message: "TypeError: Failed to fetch" } })
    if (refus && r.action !== "select") return Promise.resolve({ error: { message: refus } })
    if (r.action !== "select") appels.push(r)
    return Promise.resolve({ data: donnees ?? null, error: null })
  }
  const lus = () => (serveur[table] || []).filter((l) => r.filtres.every(([c, v]) => (Array.isArray(v) ? v.includes(l[c]) : l[c] === v)))
  const chaine = {
    eq: (c, v) => { r.filtres.push([c, v]); return chaine },
    in: (c, v) => { r.filtres.push([c, v]); return fin(r.action === "select" ? lus() : null) },
    maybeSingle: () => fin(lus()[0] || null),
    then: (ok, ko) => fin(r.action === "select" ? lus() : null).then(ok, ko),
  }
  return {
    upsert: (lignes, o) => { r.action = "upsert"; r.lignes = lignes; r.options = o; return fin() },
    delete: () => { r.action = "delete"; return chaine },
    update: (v) => { r.action = "update"; r.valeurs = v; return chaine },
    select: () => { r.action = "select"; return chaine },
  }
}
vi.mock("../supabase.js", () => ({
  supabase: { from: (t) => requete(t), auth: { getSession: async () => ({ data: { session: { user: { id: "moi" } } } }) } },
  sessionLocale: () => null,
}))
const { abandonner, enAttente, envoyer, reinitialiser, resoudreConflit, synchroniser } = await import("./horsLigne.js")

const notes = (valeur) => ({ attribution_id: "a1", sequence_id: "s1", ecrire: [{ inscription_id: "i1", valeur }], effacer: [] })

describe("saisies hors ligne", () => {
  beforeEach(() => { stockage.clear(); reinitialiser(); appels.length = 0; panne = false; refus = null; reseau.onLine = true; serveur.notes = []; serveur.eleves = [] })

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
    expect(await synchroniser()).toMatchObject({ envoyees: 0, refusees: 0 })        // toujours hors ligne : rien ne part
    reseau.onLine = true
    expect(await synchroniser()).toMatchObject({ envoyees: 3, refusees: 0 })
    expect(appels.map((a) => `${a.table}:${a.action}`)).toEqual(["notes:upsert", "absences:upsert", "retards:upsert", "retards:delete", "notes:upsert"])
    expect(appels.at(-1).lignes[0].valeur).toBe(14)                              // la dernière saisie l'emporte
    expect(enAttente("moi")).toEqual([])
  })

  it("une coupure pendant l'envoi garde la saisie pour plus tard", async () => {
    panne = true
    expect(await envoyer("notes", notes(11), "Notes")).toEqual({ enAttente: true })
    expect(await synchroniser()).toMatchObject({ envoyees: 0, refusees: 0 })
    expect(enAttente("moi")).toHaveLength(1)
    panne = false
    expect(await synchroniser()).toMatchObject({ envoyees: 1, refusees: 0 })
  })

  it("un refus du serveur est signalé et peut être ignoré, sans bloquer les autres", async () => {
    reseau.onLine = false
    await envoyer("notes", notes(9), "Notes refusées"); await envoyer("notes", notes(8), "Notes suivantes")
    reseau.onLine = true; refus = "Opération refusée : la séquence est verrouillée."
    expect(await synchroniser()).toMatchObject({ envoyees: 0, refusees: 2 })
    expect(enAttente("moi").map((x) => x.erreur)).toEqual([refus, refus])
    refus = null
    expect(await synchroniser()).toMatchObject({ envoyees: 0, refusees: 0 })          // une saisie refusée n'est pas renvoyée seule
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
    expect(await synchroniser()).toMatchObject({ envoyees: 0, refusees: 0 })
    expect(appels).toEqual([])
  })

  it("conflit sur une note : rien n'est écrasé, les autres notes partent, l'utilisateur choisit", async () => {
    reseau.onLine = false
    await envoyer("notes", { attribution_id: "a1", sequence_id: "s1", ecrire: [{ inscription_id: "i1", valeur: 12 }, { inscription_id: "i2", valeur: 15 }], effacer: [],
                             base: { i1: 10, i2: null }, noms: { i1: "ABENA Lucie", i2: "BELLA Paul" } }, "Notes")
    serveur.notes = [{ attribution_id: "a1", sequence_id: "s1", inscription_id: "i1", valeur: 9 }]   // modifiée par quelqu'un d'autre (10 -> 9)
    reseau.onLine = true
    expect(await synchroniser()).toMatchObject({ envoyees: 0, conflits: 1 })
    expect(appels[0].lignes.map((l) => l.inscription_id)).toEqual(["i2"])            // la note sans conflit est envoyée
    const [c] = enAttente("moi")
    expect(c.conflits).toEqual([{ cle: "i1", libelle: "ABENA Lucie", mien: 12, serveur: 9, base: 10 }])
    expect(await synchroniser()).toMatchObject({ envoyees: 0, conflits: 0 })      // en attente de la décision
    await resoudreConflit(c.id, true)                                               // « garder ma version »
    expect(appels.at(-1).lignes).toEqual([{ inscription_id: "i1", valeur: 12, attribution_id: "a1", sequence_id: "s1" }])
    expect(enAttente("moi")).toEqual([])
  })

  it("pas de conflit si le serveur a gardé la valeur de départ ou a déjà la même valeur", async () => {
    reseau.onLine = false
    await envoyer("notes", { attribution_id: "a1", sequence_id: "s1", ecrire: [{ inscription_id: "i1", valeur: 12 }, { inscription_id: "i2", valeur: 14 }], effacer: [],
                             base: { i1: 10, i2: 11 } }, "Notes")
    serveur.notes = [{ attribution_id: "a1", sequence_id: "s1", inscription_id: "i1", valeur: 10 }, { attribution_id: "a1", sequence_id: "s1", inscription_id: "i2", valeur: 14 }]
    reseau.onLine = true
    expect(await synchroniser()).toMatchObject({ envoyees: 1, conflits: 0 })
  })

  it("élève : ajout et modification hors ligne ; conflit seulement sur le champ modifié des deux côtés", async () => {
    reseau.onLine = false
    await envoyer("eleve", { id: "e-neuf", nouveau: true, valeurs: { matricule: "M9", nom: "NGO", sexe: "F" },
                             inscription: { exercice_id: "x1", classe_id: "c1", redoublant: false, nouveau: true } }, "Ajout de NGO")
    await envoyer("eleve", { id: "e1", nouveau: false, valeurs: { telephone_parent: "699", lieu_naissance: "Kribi" },
                             base: { telephone_parent: "677", lieu_naissance: "Douala" }, inscription: null }, "Modification de ABENA")
    serveur.eleves = [{ id: "e1", telephone_parent: "655", lieu_naissance: "Douala" }]     // téléphone changé ailleurs
    reseau.onLine = true
    expect(await synchroniser()).toMatchObject({ envoyees: 1, conflits: 1 })
    expect(appels.map((a) => `${a.table}:${a.action}`)).toEqual(["eleves:upsert", "inscriptions:upsert", "eleves:update"])
    expect(appels[0].lignes).toMatchObject({ id: "e-neuf", matricule: "M9" })
    expect(appels[2].valeurs).toEqual({ lieu_naissance: "Kribi" })
    const [c] = enAttente("moi")
    expect(c.conflits.map((x) => [x.cle, x.mien, x.serveur])).toEqual([["telephone_parent", "699", "655"]])
    resoudreConflit(c.id, false)                                                      // « garder celle du serveur »
    expect(enAttente("moi")).toEqual([])
  })

  it("infraction saisie hors ligne : envoyée une seule fois même si l'envoi est rejoué", async () => {
    reseau.onLine = false
    await envoyer("incident", { ligne: { id: "inc1", inscription_id: "i1", infraction_id: "f1", sequence_id: "s1", date: "2026-11-12", observation: "" } }, "Infraction")
    reseau.onLine = true
    expect(await synchroniser()).toMatchObject({ envoyees: 1 })
    expect(appels[0]).toMatchObject({ table: "incidents", action: "upsert", options: { onConflict: "id", ignoreDuplicates: true } })
  })
})
