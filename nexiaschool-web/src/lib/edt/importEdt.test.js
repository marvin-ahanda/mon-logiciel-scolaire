import { describe, expect, it } from "vitest"
import { configParDefaut } from "./modele.js"
import { ENTETES_MODELE, lignesModele, lireCreneaux, lireJours, lireLignes, lireVolume, validerImport } from "./importEdt.js"

const horaires = configParDefaut().horaires
const ctx = {
  classes: [{ id: "c1", libelle: "6e A" }, { id: "c2", libelle: "6e B" }],
  matieres: [{ id: "m1", code: "MATH", libelle: "Mathématiques" }, { id: "m2", code: "FR", libelle: "Français" }],
  personnels: [{ id: "p1", nom: "MBARGA", prenom: "Paul", matricule: "ENS001" }],
  horaires,
}
const valider = (data) => validerImport(lireLignes(data).lignes, ctx)
const msgs = (l) => l.erreurs.map((e) => e.k)

describe("lecture des cellules", () => {
  it("jours : noms, abréviations, plages, « Tous »", () => {
    expect(lireJours("Lundi, mardi ; Jeudi", [1, 2, 3, 4, 5])).toEqual([1, 2, 4])
    expect(lireJours("lun - mer", [1, 2, 3, 4, 5])).toEqual([1, 2, 3])
    expect(lireJours("Lundi à Vendredi", [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
    expect(lireJours("Tous les jours", [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
    expect(lireJours("Monday and Friday", [1, 2, 3, 4, 5])).toEqual([1, 5])
    expect(() => lireJours("Lundi, Funday", [1, 2, 3, 4, 5])).toThrow()
  })
  it("créneaux : heures, matin / après-midi, périodes", () => {
    expect(lireCreneaux("08:00-12:00; 14h-16h", horaires)).toEqual([{ debut: "08:00", fin: "12:00" }, { debut: "14:00", fin: "16:00" }])
    expect(lireCreneaux("matin", horaires)).toEqual([{ debut: "07:30", fin: "12:20" }])
    expect(lireCreneaux("après-midi", horaires)).toEqual([{ debut: "13:00", fin: "14:50" }])
    expect(lireCreneaux("P1-P3", horaires)).toEqual([{ debut: "07:30", fin: "10:15" }])
    expect(() => lireCreneaux("12h-8h", horaires)).toThrow()
    expect(() => lireCreneaux("P2-P12", horaires)).toThrow()
    expect(() => lireCreneaux("le soir tard", horaires)).toThrow()
  })
  it("volume : entier de 1 à 40", () => {
    expect(lireVolume("3")).toBe(3); expect(lireVolume("3 h")).toBe(3); expect(lireVolume(4)).toBe(4)
    for (const v of ["", "0", "2,5", "41", "trois", "-2"]) expect(() => lireVolume(v)).toThrow()
  })
})

describe("import des affectations", () => {
  it("modèle : un fichier conforme est accepté, lignes regroupées par enseignant", () => {
    const r = valider([ENTETES_MODELE, ...lignesModele(ctx.classes)])
    expect(r.ok).toBe(true)
    expect(r.enseignants.length).toBe(3)
    const paul = r.enseignants.find((e) => e.nom === "MBARGA")
    expect(paul.personnel_id).toBe("p1")
    expect(paul.jours).toEqual([1, 2, 4, 5])                 // ligne 2 sans jours : reprend ceux de la ligne 1
    expect(r.affectations.filter((a) => a.enseignant === paul.cle).length).toBe(2)
    expect(r.affectations[0].matiere_id).toBe("m1")
    expect(r.recap).toMatchObject({ lignes: 4, enseignants: 3, classes: 2, heures: 17 })
  })
  it("en-têtes dans un autre ordre, ligne de titre au-dessus", () => {
    const r = valider([["Affectations 2026-2027"], ["Classe", "Discipline", "Volume horaire", "Jours disponibles", "Nom", "Prénom(s)"],
      ["6e A", "Français", 5, "Tous", "NGO", "Marie"]])
    expect(r.ok).toBe(true)
    expect(r.enseignants[0].jours).toEqual([1, 2, 3, 4, 5])
  })
  it("colonnes obligatoires manquantes", () => {
    expect(lireLignes([["Nom", "Classe"], ["X", "6e A"]]).manquantes).toEqual(["discipline", "volume", "jours"])
  })
  it("rapport ligne par ligne ; rien n'est accepté tant qu'il reste une erreur", () => {
    const r = valider([ENTETES_MODELE,
      ["", "Paul", "", "Mathématiques", "6e A", 5, "Lundi", ""],                    // 2 : nom manquant
      ["ATANGANA", "Luc", "", "Mathématiques", "6e Z", 5, "Lundi", ""],             // 3 : classe inconnue
      ["ATANGANA", "Luc", "", "Français", "6e A", "2,5", "Lundi", ""],              // 4 : volume non entier
      ["BELLA", "Ada", "", "SVT", "6e A", 2, "Lundi, Samedi", ""],                  // 5 : samedi non travaillé
      ["BELLA", "Ada", "", "SVT", "6e B", 2, "Mardi", ""],                          // 6 : jours différents
      ["OWONA", "Eric", "", "PCT", "6e A", 2, "", ""],                              // 7 : jours manquants
      ["MVOGO", "Ines", "", "ECM", "6e A", 1, "Lundi", "le soir"],                  // 8 : créneau illisible
      ["MVOGO", "Ines", "", "ECM", "6e A", 1, "Lundi", ""],                         // 9 : doublon
      ["NANA", "Zoé", "X1", "EPS", "6e A", 2, "Lundi", ""],
      ["NANA", "Bob", "X1", "EPS", "6e B", 2, "Lundi", ""],                         // 11 : matricule pour un autre nom
    ])
    expect(r.ok).toBe(false)
    expect(r.affectations).toEqual([])
    const ligne = (n) => r.lignes.find((l) => l.numero === n)
    expect(msgs(ligne(2))).toContain("nom de l'enseignant manquant")
    expect(msgs(ligne(3))[0]).toMatch(/^classe « \{v0\} » inconnue/)
    expect(msgs(ligne(4))[0]).toMatch(/nombre entier/)
    expect(msgs(ligne(5))[0]).toMatch(/non travaillé/)
    expect(msgs(ligne(6))[0]).toMatch(/jours disponibles différents/)
    expect(msgs(ligne(7))[0]).toMatch(/jours disponibles manquants/)
    expect(msgs(ligne(8))[0]).toMatch(/créneau « \{v0\} » non reconnu/)
    expect(msgs(ligne(9))[0]).toMatch(/même enseignant, même classe et même discipline/)
    expect(msgs(ligne(11))[0]).toMatch(/matricule « \{v0\} » déjà utilisé/)
    expect(r.nbErreurs).toBeGreaterThanOrEqual(9)
  })
  it("avertissements signalés (discipline hors matières, enseignant hors personnel, matière partagée)", () => {
    const r = valider([ENTETES_MODELE, ["ABENA", "Rose", "", "Chinois", "6e A", 2, "Lundi", ""], ["FOUDA", "Jo", "", "Chinois", "6e A", 1, "Mardi", ""]])
    expect(r.ok).toBe(true)
    expect(r.nbAvertissements).toBe(5)   // 2 disciplines inconnues, 2 enseignants hors personnel, 1 matière partagée
    expect(r.lignes[1].avertissements.map((a) => a.k).join()).toMatch(/aussi confiée/)
  })
  it("homonymes : le matricule est exigé pour départager", () => {
    const r = valider([ENTETES_MODELE, ["NDI", "Ali", "A1", "EPS", "6e A", 2, "Lundi", ""], ["NDI", "Ali", "A2", "EPS", "6e B", 2, "Lundi", ""],
      ["NDI", "Ali", "", "ECM", "6e B", 1, "Lundi", ""]])
    expect(msgs(r.lignes[2])[0]).toMatch(/précisez le matricule/)
  })
  it("fichier vide", () => {
    const r = valider([ENTETES_MODELE])
    expect(r.ok).toBe(false); expect(r.global.length).toBe(1)
  })
})
