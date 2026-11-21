import { describe, expect, it } from "vitest"
import { droitEffectif, FONCTIONS, fonctionDuChemin, offreEffective, offreInclut, OFFRE_REQUISE, LIBELLES_FONCTIONS } from "./offres.js"

describe("offres", () => {
  it("chaque offre ouvre ses fonctions et celles des offres inférieures", () => {
    expect(offreInclut("decouverte", "finances")).toBe(false)
    expect(offreInclut("decouverte", "appel")).toBe(true)          // fonction de base
    expect(offreInclut("expiree", "appel")).toBe(false)
    for (const f of FONCTIONS) expect(offreInclut("premium", f)).toBe(true)   // Premium : toutes les fonctionnalités
  })
  it("une offre échue ou inconnue retombe sur Découverte", () => {
    expect(offreEffective({ offre: "pro", offre_expire_le: "2026-01-01T00:00:00Z" }, Date.parse("2026-02-01"))).toBe("decouverte")
    expect(offreEffective({ offre: "pro", offre_expire_le: "2026-03-01T00:00:00Z" }, Date.parse("2026-02-01"))).toBe("premium")
    expect(offreEffective({ offre: "premium" }, Date.now(), "expiree")).toBe("expiree")         // le serveur fait foi
    expect(offreEffective({ offre: "premium", offre_expire_le: null })).toBe("premium")
    expect(offreEffective({})).toBe("decouverte")
    expect(offreEffective(null)).toBe("decouverte")
  })
  it("rubriques réservées d'après l'adresse", () => {
    expect(fonctionDuChemin("/finance/paiements")).toBe("finances")
    expect(fonctionDuChemin("/discipline/appel")).toBe("appel")
    expect(fonctionDuChemin("/notes/saisie")).toBe("notes")
    expect(fonctionDuChemin("/notes/resultats")).toBe(null)
    expect(fonctionDuChemin("/discipline/suivi")).toBe("discipline")
    expect(fonctionDuChemin("/smarteval/nouvelle")).toBe("smarteval")
    expect(fonctionDuChemin("/financement")).toBe(null)
    expect(fonctionDuChemin("/")).toBe(null)
  })
  it("droits effectifs : le réglage de la plateforme l'emporte sur l'offre", () => {
    expect(droitEffectif({ smarteval: true }, "decouverte", "smarteval")).toBe(true)
    expect(droitEffectif({ notes: false }, "premium", "notes")).toBe(false)
    expect(droitEffectif(null, "decouverte", "notes")).toBe(true)          // hors ligne, jamais lu : l'offre décide
    expect(droitEffectif({}, "decouverte", "ia")).toBe(false)
    expect(FONCTIONS.every((f) => OFFRE_REQUISE[f])).toBe(true)
  })
  it("chaque fonction a un libellé", () => {
    for (const f of Object.keys(OFFRE_REQUISE)) expect(LIBELLES_FONCTIONS[f]).toBeTruthy()
  })
})
