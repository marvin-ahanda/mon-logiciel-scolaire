import { describe, expect, it } from "vitest"
import { interpreter, lireHeure, resumer } from "./automatisations.js"

describe("interpréteur des automatisations (catalogue guidé)", () => {
  it("exemple du surveillant : vendredi 16 h, absences de la semaine, au directeur", () => {
    const r = interpreter("Chaque vendredi à 16 h, prépare un rapport des absences de la semaine et envoie-le au directeur.", "surveillant")
    expect(r).toMatchObject({ action: "rapport_absences", destinataire: "direction", parametres: { periode: "semaine" }, manquants: [] })
    expect(r.frequence).toEqual({ type: "hebdo", jours: [5], jour_mois: null, heure: "16:00" })
  })
  it("heures écrites de plusieurs façons", () => {
    expect(lireHeure("a 16h30")).toBe("16:30")
    expect(lireHeure("a 7:45")).toBe("07:45")
    expect(lireHeure("a midi")).toBe("12:00")
    expect(lireHeure("at 4 pm")).toBe("16:00")
    expect(lireHeure("sans heure")).toBeNull()
  })
  it("fréquences : quotidien, jours ouvrables, mensuel", () => {
    expect(interpreter("Tous les jours à 18h, rapport des paiements du jour", "comptable").frequence).toMatchObject({ type: "quotidien", heure: "18:00" })
    expect(interpreter("Du lundi au vendredi à 7 h, envoie-moi les absences", "surveillant").frequence.jours).toEqual([1, 2, 3, 4, 5])
    const m = interpreter("Le 5 de chaque mois, la liste des impayés à la direction", "comptable")
    expect(m).toMatchObject({ action: "rapport_impayes", destinataire: "direction", parametres: { periode: "mois" } })
    expect(m.frequence).toMatchObject({ type: "mensuel", jour_mois: 5, heure: "07:00" })
    expect(m.remarques).toContain("heure_defaut")
  })
  it("actions du catalogue et rappel personnel", () => {
    expect(interpreter("Chaque lundi, les notes non saisies", "enseignant").action).toBe("rapport_saisie")
    expect(interpreter("chaque soir à 17h les incidents de discipline", "surveillant").action).toBe("rapport_discipline")
    const r = interpreter("Chaque jeudi à 15h, rappelle-moi de préparer le conseil de classe.", "enseignant")
    expect(r).toMatchObject({ action: "rappel", destinataire: "moi", parametres: { texte: "préparer le conseil de classe" } })
  })
  it("anglais : every Friday at 4 pm, attendance report to the principal", () => {
    expect(interpreter("Every Friday at 4 pm, send the attendance report of the week to the principal", "surveillant"))
      .toMatchObject({ action: "rapport_absences", destinataire: "direction", frequence: { jours: [5], heure: "16:00" } })
  })
  it("signale ce qui manque : action inconnue, action hors du rôle", () => {
    expect(interpreter("Chaque lundi, fais quelque chose", "admin").manquants).toEqual(["action"])
    expect(interpreter("Chaque soir les paiements", "enseignant").manquants).toEqual(["droit"])
  })
  it("résumé lisible de la règle", () => {
    const r = interpreter("Chaque vendredi à 16 h, rapport des absences de la semaine au directeur", "surveillant")
    expect(resumer(r)).toBe("Chaque vendredi à 16:00 : Rapport des absences et retards — les 7 derniers jours, envoyé à la direction (administration).")
  })
})
