// Bulletins PDF : une seule page A4 par élève, quel que soit le nombre de matières ; en-tête officiel sans valeur imposée.
import { describe, expect, it, vi } from "vitest"
vi.stubGlobal("navigator", { languages: ["fr-FR"] })
vi.mock("../supabase.js", () => ({ supabase: {}, rpc: vi.fn(), toutCharger: vi.fn(), verifier: (x) => x }))
const { creerBulletinsPdf } = await import("./bulletinPdf.js")
const { lignesEntete, CHAMPS_ENTETE } = await import("./enteteBulletin.js")

const etablissement = {
  nom: "Collège Saint Michel", devise: "Discipline - Travail - Réussite", specialisation: "Enseignement général & technique · Bilingue",
  adresse: "BP 100", ville: "Yaoundé", telephone: "699 00 00 00", site_web: "https://exemple.cm", nom_chef: "M. ABENA",
  entete_pays: "RÉPUBLIQUE DU CAMEROUN", entete_devise_pays: "Paix - Travail - Patrie", entete_ministere: "MINISTÈRE DES ENSEIGNEMENTS SECONDAIRES",
  entete_delegation: "DÉLÉGATION RÉGIONALE DU CENTRE", entete_pays_en: "REPUBLIC OF CAMEROON", entete_devise_pays_en: "Peace - Work - Fatherland",
  entete_ministere_en: "MINISTRY OF SECONDARY EDUCATION", entete_delegation_en: "REGIONAL DELEGATION FOR THE CENTRE",
}

function eleve(n, matieres) {
  const lignes = Array.from({ length: matieres }, (_, i) => ({ attributionId: `a${i}`, matiere: `Matière numéro ${i + 1} au libellé assez long`,
    enseignant: `M. ENSEIGNANT ${i + 1} Prénom`, details: [12, 13, 14], note: 13, coefficient: 2, points: 26, rang: 3, exAequo: false }))
  return { r: { inscriptionId: `i${n}`, eleve: { nom: "ELEVE", prenom: `Numéro ${n}`, matricule: `M${n}`, sexe: "M", date_naissance: "2011-04-02", lieu_naissance: "Yaoundé" },
    groupes: [{ groupe: 1, lignes, totalCoef: 2 * matieres, totalPoints: 26 * matieres, moyenne: 13 }], totalCoef: 2 * matieres, totalPoints: 26 * matieres,
    moyenne: 13, moyenneNonClassee: null, rang: n, exAequo: false, appreciation: "Assez bien", moyennesTrimestres: [12, 13, 14] },
    conduite: { nj: 2, j: 1, retards: 1, incidents: ["Bavardage"], pointsPonctualite: 0.25, pointsAssiduite: 0.5, pointsAutres: 1, note: 18.25, appreciation: "Très bien" },
    decision: { libelle: "Admis en classe supérieure" }, code: "ABCD-EFGH-JKLM" }
}

const contexte = (eleves) => ({ etablissement, logo: null, filigrane: null, exercice: { libelle: "2026/2027" },
  periode: { type: "annee", code: "annee", libelle: "Bilan annuel" }, classe: { libelle: "3e A", professeur_principal: "NTSAGO Patrice" },
  stats: { effectif: 14, classes: 14, moyenneClasse: 11.2, max: 16, min: 6, tauxReussite: 64 }, entetes: ["T1", "T2", "T3"], eleves })

describe("bulletins PDF", () => {
  it("un bulletin chargé (22 matières) tient sur une seule page A4", async () => {
    const doc = await creerBulletinsPdf(contexte([eleve(1, 22)]), "essai")
    expect(doc.getNumberOfPages()).toBe(1)
  })
  it("une classe : exactement une page par élève (recto seul)", async () => {
    const doc = await creerBulletinsPdf(contexte([eleve(1, 9), eleve(2, 18), eleve(3, 26)]), "essai")
    expect(doc.getNumberOfPages()).toBe(3)
  })
  it("l'en-tête officiel n'impose rien : lignes vides omises, gauche et droite indépendantes", () => {
    const e = lignesEntete({ nom: "École internationale", entete_pays: "RÉPUBLIQUE FRANÇAISE", entete_ministere: "", entete_pays_en: "" })
    expect(e.gauche.map((l) => l.texte)).toEqual(["RÉPUBLIQUE FRANÇAISE"])
    expect(e.droite).toEqual([])
    expect(lignesEntete(etablissement).gauche[1]).toEqual({ texte: "Paix - Travail - Patrie", devise: true })
    expect(CHAMPS_ENTETE).toHaveLength(9)
  })
})
