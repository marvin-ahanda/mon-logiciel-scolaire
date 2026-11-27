import { describe, expect, it } from "vitest"
import { DUREES_PROPOSEES, alerteFranchie, compteARebours, decalageServeur, dureeTexte, niveauChrono, secondesSaisies, tempsRestant } from "./chrono.js"

describe("chronomètre SmartEval", () => {
  it("propose les durées demandées (15 min à 3 h)", () => {
    expect(DUREES_PROPOSEES.map(dureeTexte)).toEqual(["15 min", "30 min", "45 min", "1 h", "1 h 15 min", "1 h 30 min", "2 h", "2 h 30 min", "3 h"])
  })

  it("affiche le temps restant en HH:MM:SS, sans valeur négative", () => {
    expect(compteARebours(2700 * 1000)).toBe("00:45:00")
    expect(compteARebours(3 * 3600 * 1000 + 61 * 1000)).toBe("03:01:01")
    expect(compteARebours(500)).toBe("00:00:01")
    expect(compteARebours(-5000)).toBe("00:00:00")
  })

  it("passe en alerte sous 10 minutes, en rouge sous 5 minutes", () => {
    expect(niveauChrono(11 * 60 * 1000)).toBe("normal")
    expect(niveauChrono(9 * 60 * 1000)).toBe("attention")
    expect(niveauChrono(4 * 60 * 1000)).toBe("urgent")
    expect(niveauChrono(0)).toBe("fini")
  })

  it("signale une seule fois les seuils de 10, 5 et 1 minute", () => {
    expect(alerteFranchie(600_500, 599_500)).toBe(600_000)
    expect(alerteFranchie(599_500, 598_500)).toBeNull()
    expect(alerteFranchie(300_200, 299_900)).toBe(300_000)
    expect(alerteFranchie(60_400, 59_900)).toBe(60_000)
    expect(alerteFranchie(700_000, 50_000)).toBe(60_000)          // appareil en veille : seul le dernier seuil est annoncé
    expect(alerteFranchie(1000, -10)).toBeNull()
  })

  it("valide la durée saisie (1 minute à 12 heures)", () => {
    expect(secondesSaisies(1, 15)).toBe(4500)
    expect(secondesSaisies(0, 0)).toBeNull()
    expect(secondesSaisies(13, 0)).toBeNull()
    expect(secondesSaisies("", "50")).toBe(3000)
  })

  it("calcule le temps restant avec l'heure du serveur, pas celle de l'appareil", () => {
    // appareil en avance de 10 minutes : le temps restant reste juste
    const recuLe = Date.parse("2026-11-27T10:10:00Z")
    const d = decalageServeur("2026-11-27T10:00:00Z", recuLe)
    expect(d).toBe(-600_000)
    expect(tempsRestant("2026-11-27T10:45:00Z", d, recuLe)).toBe(45 * 60 * 1000)
    expect(tempsRestant("2026-11-27T10:45:00Z", d, recuLe + 60_000)).toBe(44 * 60 * 1000)
    expect(decalageServeur("invalide", recuLe)).toBe(0)
  })
})
