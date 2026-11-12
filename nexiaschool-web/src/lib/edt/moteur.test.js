import { describe, expect, it } from "vitest"
import { configParDefaut, genererPeriodes, lignesGrille, semaine } from "./modele.js"
import { criteres, resoudre, verifierGrille } from "./moteur.js"
import { analyser, appliquerReponse, expliquerEchec } from "./faisabilite.js"
import { etablissementEssai } from "./jeuEssai.js"

/** Petite configuration : 2 classes, 3 enseignants, 5 jours de 7 périodes. */
function petite() {
  const cfg = configParDefaut()
  cfg.enseignants = [
    { cle: "e1", nom: "Mbarga", prenom: "Paul", jours: [], creneaux: [] },
    { cle: "e2", nom: "Ngo", prenom: "Marie", jours: [1, 2], creneaux: [] },
    { cle: "e3", nom: "Essomba", prenom: "Jean", jours: [], creneaux: [] },
  ]
  cfg.affectations = [
    { id: "a1", enseignant: "e1", classe_id: "c1", classe: "6e A", discipline: "Mathématiques", volume: 5 },
    { id: "a2", enseignant: "e1", classe_id: "c2", classe: "6e B", discipline: "Mathématiques", volume: 5 },
    { id: "a3", enseignant: "e2", classe_id: "c1", classe: "6e A", discipline: "Français", volume: 4 },
    { id: "a4", enseignant: "e3", classe_id: "c2", classe: "6e B", discipline: "Informatique", volume: 2 },
    { id: "a5", enseignant: "e3", classe_id: "c1", classe: "6e A", discipline: "Informatique", volume: 2 },
  ]
  cfg.salles = [{ id: "s1", nom: "Salle info", type: "Informatique" }]
  cfg.classes = {
    c1: { libelle: "6e A", salles: { Informatique: "Informatique" }, permanences: { heures: 2, jours: [3, 4], debut: "", fin: "" }, interdits: ["5-0", "5-1"] },
    c2: { libelle: "6e B", salles: { Informatique: "Informatique" } },
  }
  return cfg
}
const cle = (g) => `${g.j}-${g.p}`

describe("horaires", () => {
  it("génère les périodes sans chevaucher les pauses", () => {
    const h = configParDefaut().horaires
    const p = genererPeriodes(h)
    expect(p.map((x) => x.debut)).toEqual(["07:30", "08:25", "09:20", "10:30", "11:25", "13:00", "13:55"])
    expect(lignesGrille(h).filter((l) => l.type === "pause").length).toBe(2)
  })
  it("les pauses de midi séparent les heures consécutives, pas les récréations", () => {
    const s = semaine(configParDefaut().horaires)
    expect(s.contigu[0][2]).toBe(true)    // 09:20 -> récréation -> 10:30 : enchaînées
    expect(s.contigu[0][4]).toBe(false)   // 11:25 -> midi -> 13:00 : séparées
    expect(s.matin[0][4]).toBe(true); expect(s.matin[0][5]).toBe(false)
  })
  it("une interruption propre à un jour ferme ses créneaux", () => {
    const cfg = configParDefaut()
    cfg.horaires.pauses.push({ id: "i", libelle: "Mercredi après-midi", type: "interruption", debut: "12:20", fin: "15:30", jours: [3] })
    const s = semaine(cfg.horaires)
    expect(s.ouvert[2].slice(5)).toEqual([false, false]); expect(s.ouvert[1].slice(5)).toEqual([true, true])
  })
})

describe("moteur : contraintes obligatoires", () => {
  const cfg = petite()
  const r = resoudre(cfg, { graine: 4, intensite: 0.3 })
  const affs = new Map(cfg.affectations.map((a) => [a.id, a]))
  it("place tout, sans aucune violation", () => {
    expect(r.complet).toBe(true)
    expect(verifierGrille(cfg, r.grille)).toEqual([])
  })
  it("aucun conflit d'enseignant ni de classe", () => {
    const ens = r.grille.filter((g) => g.a).map((g) => `${affs.get(g.a).enseignant}|${cle(g)}`)
    expect(new Set(ens).size).toBe(ens.length)
    const cls = r.grille.map((g) => `${g.c}|${cle(g)}`)
    expect(new Set(cls).size).toBe(cls.length)
  })
  it("respecte les volumes horaires et les permanences", () => {
    for (const a of cfg.affectations) expect(r.grille.filter((g) => g.a === a.id).length).toBe(a.volume)
    const perms = r.grille.filter((g) => g.c === "c1" && g.a === null)
    expect(perms.length).toBe(2)
    expect(perms.every((g) => [3, 4].includes(g.j))).toBe(true)
  })
  it("respecte les indisponibilités, les créneaux interdits et les pauses", () => {
    expect(r.grille.filter((g) => g.a === "a3").every((g) => [1, 2].includes(g.j))).toBe(true)
    expect(r.grille.some((g) => g.c === "c1" && ["5-0", "5-1"].includes(cle(g)))).toBe(false)
    const s = semaine(cfg.horaires)
    expect(r.grille.every((g) => s.ouvert[s.jours.indexOf(g.j)][g.p])).toBe(true)
  })
  it("attribue la salle spécialisée sans double occupation", () => {
    const info = r.grille.filter((g) => g.a === "a4" || g.a === "a5")
    expect(info.every((g) => g.s === "s1")).toBe(true)
    expect(new Set(info.map(cle)).size).toBe(info.length)
  })
  it("est déterministe (même graine, même résultat) et propose des variantes", () => {
    expect(resoudre(cfg, { graine: 4, intensite: 0.3 }).grille).toEqual(r.grille)
    expect(resoudre(cfg, { graine: 9, intensite: 0.3 }).grille).not.toEqual(r.grille)
  })
  it("le contrôle détecte toute grille invalide", () => {
    const g = structuredClone(r.grille)
    const a1 = g.find((x) => x.a === "a1"), a2 = g.find((x) => x.a === "a2")
    a2.j = a1.j; a2.p = a1.p                      // même enseignant, deux classes, même heure
    expect(verifierGrille(cfg, g).map((x) => x.k)).toContain("Un enseignant a deux cours en même temps.")
    expect(verifierGrille(cfg, r.grille.slice(1)).length).toBeGreaterThan(0)       // volume manquant
    const pause = structuredClone(r.grille); pause[0].p = 99
    expect(verifierGrille(cfg, pause).length).toBeGreaterThan(0)
  })
  it("respecte les maximums journaliers et consécutifs", () => {
    const c = petite()
    c.generales.enseignant.max_jour = 2; c.generales.enseignant.max_consecutives = 1; c.generales.classe.max_consecutives = 1
    const x = resoudre(c, { graine: 2, intensite: 0.3 })
    expect(x.complet).toBe(true)
    expect(verifierGrille(c, x.grille)).toEqual([])
    const parJour = {}
    for (const g of x.grille.filter((y) => y.a)) { const k = `${c.affectations.find((a) => a.id === g.a).enseignant}|${g.j}`; parJour[k] = (parJour[k] || 0) + 1 }
    expect(Math.max(...Object.values(parJour))).toBeLessThanOrEqual(2)
  })
})

describe("faisabilité", () => {
  it("bilan chiffré d'une configuration faisable", () => {
    const a = analyser(petite())
    expect(a.ok).toBe(true)
    expect(a.chiffres.total.heures).toBe(20)
    expect(a.chiffres.enseignants.find((e) => e.cle === "e2").disponibles).toBe(14)
  })
  it("enseignant trop chargé pour ses disponibilités : bloquant, avec question", () => {
    const cfg = petite(); cfg.affectations[2].volume = 15
    const a = analyser(cfg)
    expect(a.ok).toBe(false)
    const e = a.erreurs.find((x) => x.cible?.enseignant === "e2")
    expect(e.questions[0]).toMatchObject({ type: "jours", champ: "jours" })
    // la réponse de l'utilisateur (ajouter des jours) lève le blocage ; rien n'est assoupli sans elle
    const cfg2 = appliquerReponse(cfg, e.questions[0], [1, 2, 3, 4, 5])
    expect(cfg.enseignants[1].jours).toEqual([1, 2])
    expect(analyser(cfg2).erreurs.some((x) => x.cible?.enseignant === "e2")).toBe(false)
  })
  it("salle spécialisée absente ou insuffisante : bloquant", () => {
    const cfg = petite(); cfg.salles = []
    expect(analyser(cfg).erreurs.some((x) => x.cible?.salle === "Informatique")).toBe(true)
    const cfg2 = petite(); cfg2.affectations[3].volume = 33; cfg2.affectations[4].volume = 3
    expect(analyser(cfg2).ok).toBe(false)
  })
  it("classe surchargée et permanences impossibles : bloquant", () => {
    const cfg = petite(); cfg.affectations[0].volume = 40
    expect(analyser(cfg).erreurs.some((x) => x.cible?.classe === "c1")).toBe(true)
    const cfg2 = petite(); cfg2.classes.c1.permanences = { heures: 20, jours: [3], debut: "", fin: "" }
    expect(analyser(cfg2).erreurs.some((x) => x.cible?.classe === "c1")).toBe(true)
  })
  it("enseignant au-delà de son maximum hebdomadaire", () => {
    const cfg = petite(); cfg.enseignants[0].max_semaine = 8
    const e = analyser(cfg).erreurs.find((x) => x.cible?.enseignant === "e1")
    expect(e.questions[0]).toMatchObject({ type: "nombre", champ: "max_semaine" })
  })
  it("impossibilité non détectée d'avance : le moteur l'explique sans violer de contrainte", () => {
    const cfg = petite()
    // deux enseignants disponibles le seul lundi, chacun 7 h dans la même classe : 14 h pour 7 créneaux
    cfg.enseignants.push({ cle: "e4", nom: "Fouda", prenom: "Luc", jours: [1], creneaux: [] }, { cle: "e5", nom: "Abena", prenom: "Rose", jours: [1], creneaux: [] })
    cfg.affectations.push({ id: "a6", enseignant: "e4", classe_id: "c2", classe: "6e B", discipline: "SVT", volume: 5 },
      { id: "a7", enseignant: "e5", classe_id: "c2", classe: "6e B", discipline: "PCT", volume: 5 })
    const r = resoudre(cfg, { graine: 1, intensite: 0.3 })
    expect(r.complet).toBe(false)
    const placees = r.grille
    // aucune violation parmi les cours placés : seulement des volumes incomplets
    expect(verifierGrille(cfg, placees).every((v) => /Volume horaire/.test(v.k))).toBe(true)
    const ex = expliquerEchec(cfg, r.nonPlaces)
    expect(ex.length).toBeGreaterThan(0)
    expect(ex[0].questions.some((q) => q.type === "jours")).toBe(true)
  })
})

describe("scénario réaliste", () => {
  it("40 classes, plusieurs dizaines d'enseignants, salles et permanences : complet et valide", () => {
    const cfg = etablissementEssai({ classes: 40, permanences: 2, graine: 5 })
    cfg.salles.push({ id: "s3", nom: "Salle info 3", type: "Informatique" })
    expect(cfg.enseignants.length).toBeGreaterThan(60)
    const a = analyser(cfg)
    expect(a.ok).toBe(true)
    const debut = Date.now()
    const r = resoudre(cfg, { graine: 1, intensite: 0.3 })
    expect(Date.now() - debut).toBeLessThan(20000)
    expect(r.complet).toBe(true)
    expect(verifierGrille(cfg, r.grille)).toEqual([])
    const q = criteres(cfg, r.grille)
    expect(q.cours).toBe(a.chiffres.total.heures)
    expect(q.trousClasses).toBeLessThanOrEqual(5)
  }, 30000)
})
