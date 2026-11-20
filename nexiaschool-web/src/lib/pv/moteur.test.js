import { describe, expect, it } from "vitest"
import { bilanValeurs, comparer, completude, moyennesMatieres, pvClasse, pvGroupe, pvIndividuel, reglagesPv, taux } from "./moteur.js"
import { celluleCsv, texteCsv } from "./export.js"
import { note } from "../format.js"
import { syntheseClasse, syntheseGroupe, syntheseIndividuelle, texteControle, texteRecommandation } from "./textes.js"

const eleve = (nom, sexe = "M") => ({ nom, prenom: "", matricule: nom.toUpperCase(), sexe })
const E = [{ inscriptionId: "i1", eleve: eleve("Abena", "F") }, { inscriptionId: "i2", eleve: eleve("Bello") }, { inscriptionId: "i3", eleve: eleve("Chia", "F") }]
const A = [{ id: "m", matiere: "Mathématiques", enseignant: "M. Ndi" }, { id: "f", matiere: "Français", enseignant: "Mme Ewane" }]
const P = [{ code: "s1", libelle: "Séquence 1" }]
const notes = (o) => new Map(Object.entries(o))

describe("réglages et taux", () => {
  it("applique les réglages de l'établissement et garde des valeurs numériques", () => {
    expect(reglagesPv({ seuil_reussite: "12", part_echecs: null }).seuil_reussite).toBe(12)
    expect(reglagesPv({ part_echecs: null }).part_echecs).toBe(50)
    expect(reglagesPv(null).signataires).toEqual([])
  })
  it("taux et bilans au seuil choisi", () => {
    expect(taux(1, 3)).toBe(33.33)
    expect(taux(0, 0)).toBeNull()
    expect(bilanValeurs([12, 8, null, 10], 10)).toMatchObject({ n: 3, reussis: 2, echecs: 1, tauxReussite: 66.67, max: 12, min: 8 })
    expect(bilanValeurs([12, 8, 10], 12).reussis).toBe(1)
  })
})

describe("PV de classe (notes brutes)", () => {
  const entree = {
    eleves: E, attributions: A, periodes: P,
    notes: notes({ "i1|m|s1": 15, "i1|f|s1": 12, "i2|m|s1": 6, "i2|f|s1": 7, "i3|m|s1": 11 }),
    bilans: new Map([["i2", { nj: 4, j: 2, retards: 3 }]]),
  }
  it("aligne les notes sur les colonnes matière × période et compte les échecs", () => {
    const pv = pvClasse(entree)
    expect(pv.colonnes.map((c) => c.matiere)).toEqual(["Mathématiques", "Français"])
    expect(pv.lignes[0].notes).toEqual([15, 12])
    expect(pv.lignes[2].notes).toEqual([11, null])
    expect(pv.lignes[1]).toMatchObject({ echecs: 2, presentes: 2, partEchecs: 100, enDifficulte: true })
    expect(pv.lignes[0].moyennes).toBeNull()
  })
  it("calcule les pourcentages sans calculer de moyenne d'élève", () => {
    const g = pvClasse(entree).global
    expect(g).toMatchObject({ effectif: 3, notesAttendues: 6, notesPresentes: 5, notesManquantes: 1, reussis: 3, echecs: 2, tauxReussite: 60, tauxEchec: 40 })
    expect(g).toMatchObject({ heuresNJ: 4, heuresJ: 2, retards: 3, elevesAbsents: 1, tauxAbsents: 33.33 })
  })
  it("meilleures performances, élèves en difficulté et matières les plus faibles", () => {
    const pv = pvClasse(entree)
    expect(pv.meilleures[0]).toMatchObject({ note: 15, matiere: "Mathématiques" })
    expect(pv.enDifficulte.map((l) => l.inscriptionId)).toEqual(["i2"])
    expect(pv.matieresFaibles[0]).toMatchObject({ matiere: "Français", tauxReussite: 50 })
    expect(pv.matieres[0].meilleure.note).toBe(15)
  })
  it("seuils configurables : réussite à 12", () => {
    const pv = pvClasse({ ...entree, reglages: { seuil_reussite: 12 } })
    expect(pv.global.reussis).toBe(2)
    expect(pv.seuil).toBe(12)
  })
  it("plusieurs périodes : une colonne par matière et par période, moyennes en option", () => {
    const pv = pvClasse({ ...entree, periodes: [...P, { code: "s2", libelle: "Séquence 2" }], notes: notes({ "i1|m|s1": 15, "i1|m|s2": 9 }),
                          moyennes: new Map([["i1|s1", 15], ["i1|s2", 9]]) })
    expect(pv.colonnes).toHaveLength(4)
    expect(pv.lignes[0].notes).toEqual([15, null, 9, null])
    expect(pv.lignes[0].moyennes).toEqual([15, 9])
  })
  it("option « sans notes manquantes » : écarte les élèves incomplets", () => {
    const pv = pvClasse({ ...entree, incomplets: false })
    expect(pv.lignes.map((l) => l.inscriptionId)).toEqual(["i1", "i2"])
    expect(pv.exclus).toBe(1)
  })
  it("complétude : bloque un PV vide, avertit d'un PV partiel", () => {
    expect(completude(pvClasse({ ...entree, notes: new Map() })).bloquants.map((b) => b.code)).toEqual(["notes"])
    expect(completude(pvClasse({ ...entree, eleves: [] })).bloquants.map((b) => b.code)).toContain("eleves")
    const c = completude(pvClasse(entree))
    expect(c.bloquants).toEqual([])
    expect(c.partiel).toBe(true)
    expect(c.avertissements[0]).toMatchObject({ code: "manquantes", n: 1, eleves: 1 })
    expect(texteControle(c.avertissements[0])).toContain("1")
    const complet = completude(pvClasse({ ...entree, notes: notes({ "i1|m|s1": 15, "i1|f|s1": 12, "i2|m|s1": 6, "i2|f|s1": 7, "i3|m|s1": 11, "i3|f|s1": 10 }) }))
    expect(complet.partiel).toBe(false)
  })
  it("synthèse rédigée à partir des seules données", () => {
    const s = syntheseClasse(pvClasse(entree)).join(" ")
    expect(s).toContain("3 élève(s)")
    expect(s).toContain("Français")
  })
})

// --- Groupes (cycle, établissement) ----------------------------------------------------------------------
const ligne = (matiere, note, enseignant = "") => ({ matiere, note, enseignant })
const res = (id, e, moyenne, lignes) => ({ inscriptionId: id, eleve: e, moyenne, moyenneNonClassee: null, lignes })
const C1 = { id: "c1", libelle: "6e A", cycleId: "k1", cycleLibelle: "Premier cycle", niveauLibelle: "6e", sectionLibelle: "Francophone" }
const C2 = { id: "c2", libelle: "2nde C", cycleId: "k2", cycleLibelle: "Second cycle", niveauLibelle: "2nde", sectionLibelle: "Francophone" }
const groupe = [
  { classe: C1, resultats: [res("a", eleve("A", "F"), 14, [ligne("Maths", 15, "Ndi"), ligne("Anglais", 13, "Kum")]), res("b", eleve("B"), 7, [ligne("Maths", 5, "Ndi"), ligne("Anglais", 9, "Kum")])],
    bilans: new Map([["b", { nj: 3, j: 0, retards: 1 }]]), precedentes: new Map([["a", 12], ["b", 9]]), finances: new Map([["a", { en_regle: true }], ["b", { en_regle: false }]]) },
  { classe: C2, resultats: [res("c", eleve("C", "F"), 11, [ligne("Maths", 9, "Owona"), ligne("Anglais", 13, "Kum")]), res("d", eleve("D"), null, [ligne("Maths", null, "Owona"), ligne("Anglais", null, "Kum")])],
    bilans: new Map(), precedentes: new Map([["c", 11]]), finances: new Map([["c", { en_regle: true }]]) },
]

describe("PV par cycle et PV général", () => {
  const pv = pvGroupe(groupe, { seuil_reussite: 10, seuil_difficulte: 8 }, { parEnseignant: true })
  it("indicateurs globaux : réussite, difficulté, progression, présence, pension", () => {
    expect(pv.global).toMatchObject({ effectif: 4, evalues: 3, reussis: 2, tauxReussite: 66.67, enDifficulte: 1, tauxDifficulte: 33.33 })
    expect(pv.global).toMatchObject({ comparables: 3, progression: 1, regression: 1, stables: 1, garcons: 2, filles: 2 })
    expect(pv.global).toMatchObject({ elevesAbsents: 1, tauxAbsenteisme: 25, tauxPresence: 75, financeConnue: 3, aJour: 2, tauxAJour: 66.67 })
  })
  it("par classe, par cycle, par niveau et par section", () => {
    expect(pv.parClasse.map((c) => [c.classe.libelle, c.tauxReussite])).toEqual([["6e A", 50], ["2nde C", 100]])
    expect(pv.parCycle.map((c) => c.libelle)).toEqual(["Premier cycle", "Second cycle"])
    expect(pv.parSection).toHaveLength(1)
    expect(pv.classesFaibles[0].classe.libelle).toBe("6e A")
  })
  it("matières regroupées d'une classe à l'autre, enseignants et suivi", () => {
    const maths = pv.parMatiere.find((m) => m.matiere === "Maths")
    expect(maths).toMatchObject({ n: 3, reussis: 1, tauxReussite: 33.33, manquantes: 1 })
    expect(pv.matieresFaibles[0].matiere).toBe("Maths")
    expect(pv.parEnseignant.find((e) => e.enseignant === "Kum").classes).toEqual(["6e A", "2nde C"])
    expect(pv.aSuivre.matieres.map((m) => m.matiere)).toEqual(["Maths"])
    expect(pvGroupe(groupe, {}).parEnseignant).toBeNull()
  })
  it("répartition, meilleures performances et élèves en difficulté", () => {
    expect(pv.repartition.reduce((s, r) => s + r.n, 0)).toBe(3)
    expect(pv.meilleures.map((m) => m.moyenne)).toEqual([14, 11, 7])
    expect(pv.enDifficulte.map((m) => m.moyenne)).toEqual([7])
  })
  it("comparaison de deux périodes", () => {
    const avant = pvGroupe(groupe.map((g) => ({ ...g, resultats: g.resultats.map((r) => ({ ...r, moyenne: r.moyenne === null ? null : r.moyenne - 2 })) })), {})
    const c = comparer(pv, avant)
    expect(c.global.find((x) => x.cle === "moyenne").ecart).toBe(2)
    expect(c.classes[0]).toMatchObject({ courant: 50, reference: 50, ecart: 0 })
    expect(syntheseGroupe(pv, { comparaison: c, libelleComparaison: "T1" }).join(" ")).toContain("T1")
  })
})

describe("PV individuel", () => {
  const r = { eleve: eleve("Abena", "F"), moyenne: 9.5, moyenneNonClassee: null,
    lignes: [{ matiere: "Maths", note: 6, coefficient: 4, enseignant: "Ndi", details: [5, 7] }, { matiere: "Anglais", note: 15, coefficient: 2, enseignant: "Kum", details: [14, 16] }] }
  const precedente = { moyenne: 12, lignes: [{ matiere: "Maths", note: 10 }, { matiere: "Anglais", note: 14 }] }
  const c = pvIndividuel({ r, entetes: ["S1", "S2"], moyenneClasse: 10.2, moyennesClasse: [8, 12], precedente, bilan: { nj: 2, j: 0, retards: 3 },
                           distinctions: ["Encouragements"], reglages: { baisse_alerte: 2 } })
  it("compare à la classe sans exposer d'autres élèves, et à la période précédente", () => {
    expect(c.eleve).toEqual({ nom: "Abena", prenom: "", matricule: "ABENA", sexe: "F" })
    expect(c.matieres[0]).toMatchObject({ ecartClasse: -2, precedente: 10, variation: -4, tendance: "baisse" })
    expect(c.matieres[1]).toMatchObject({ ecartClasse: 3, variation: 1, tendance: "hausse" })
    expect(JSON.stringify(c)).not.toContain("Bello")
  })
  it("forces, faiblesses, alertes de baisse et recommandations", () => {
    expect(c.fortes).toEqual(["Anglais"])
    expect(c.faibles).toEqual(["Maths"])
    expect(c.alertes).toEqual([{ matiere: "Maths", variation: -4 }])
    expect(c.alerteGenerale).toBe(true)
    expect(c.recommandations.map((x) => x.code)).toEqual(["renforcer", "assiduite", "ponctualite"])
    expect(texteRecommandation(c.recommandations[0])).toContain("Maths")
  })
  it("synthèse lisible pour les parents", () => {
    const s = syntheseIndividuelle(c).join(" ")
    expect(s).toContain(`Moyenne de la période : ${note(9.5)}/20`)       // format de la langue de l'environnement (9,50 ou 9.50)
    expect(s).toContain("Encouragements")
  })
  it("moyennes par matière d'un groupe d'élèves", () => {
    expect(moyennesMatieres([{ lignes: [{ note: 10 }, { note: null }] }, { lignes: [{ note: 14 }, { note: 8 }] }])).toEqual([12, 8])
    expect(moyennesMatieres([])).toEqual([])
  })
})

describe("export CSV", () => {
  it("échappe le séparateur, les guillemets et neutralise les formules", () => {
    expect(celluleCsv("a;b")).toBe('"a;b"')
    expect(celluleCsv('dit "oui"')).toBe('"dit ""oui"""')
    expect(celluleCsv("=SOMME(A1)")).toBe("'=SOMME(A1)")
    expect(celluleCsv(-2.5)).toBe("-2.5")
    expect(texteCsv([{ intitule: "PV", entetes: ["A", "B"], lignes: [[1, null]] }])).toBe("PV\r\n\r\nA;B\r\n1;")
  })
})
