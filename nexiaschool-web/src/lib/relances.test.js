import { describe, expect, it } from "vitest"
import { problemesPaliers, remplir, statutAffiche, trierPaliers } from "./relances.js"

describe("relances", () => {
  it("statut affiché : accusé > lu > envoyé, les autres statuts inchangés", () => {
    expect(statutAffiche({ statut: "envoye" })).toBe("envoye")
    expect(statutAffiche({ statut: "envoye", lu_le: "2026-11-20" })).toBe("lu")
    expect(statutAffiche({ statut: "envoye", lu_le: "x", accuse_le: "y" })).toBe("accuse")
    expect(statutAffiche({ statut: "programme", lu_le: "x" })).toBe("programme")
  })
  it("remplit les variables, garde visibles les inconnues", () => {
    expect(remplir("{eleve} doit {montant} FCFA ({x})", { eleve: "NOAH Jean", montant: "60 000" })).toBe("NOAH Jean doit 60 000 FCFA ({x})")
    expect(remplir("J-{jours}", { jours: 0 })).toBe("J-0")
  })
  it("contrôle des paliers : doublons, bornes, textes", () => {
    const ok = { jours: 5, titre: "Contrôle", objet: "Objet", texte: "Un texte suffisant" }
    expect(problemesPaliers([ok])).toEqual([])
    expect(problemesPaliers([ok, { ...ok }])).toEqual(["doublon"])
    expect(problemesPaliers([{ ...ok, jours: 61 }])).toEqual(["jours"])
    expect(problemesPaliers([{ ...ok, jours: "" }])).toContain("jours")
    expect(problemesPaliers([{ ...ok, texte: "court" }])).toEqual(["texte"])
    expect(problemesPaliers(Array.from({ length: 11 }, (_, k) => ({ ...ok, jours: k })))).toContain("trop")
  })
  it("tri du plus lointain au jour J", () => {
    expect(trierPaliers([{ jours: 0 }, { jours: 10 }, { jours: 3 }]).map((x) => x.jours)).toEqual([10, 3, 0])
  })
})
