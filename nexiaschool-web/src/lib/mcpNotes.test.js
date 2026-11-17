// Correspondance des élèves par nom dans le serveur MCP (saisie d'un relevé filmé : l'OCR donne des noms, pas des matricules).
import { describe, it, expect } from "vitest"
import { resoudreEleve } from "../../supabase/functions/mcp/index.ts"

const eleves = [
  { inscription_id: "i1", matricule: "M001", nom: "MBARGA", prenom: "Jean" },
  { inscription_id: "i2", matricule: "M002", nom: "NGO BASSONG", prenom: "Carine" },
  { inscription_id: "i3", matricule: "M003", nom: "MBARGA", prenom: "Paul" },
  { inscription_id: "i4", matricule: "M004", nom: "ÉTÉMÉ", prenom: "Aïcha" },
]

describe("correspondance des élèves (MCP)", () => {
  it("retrouve par matricule, insensible à la casse", () => expect(resoudreEleve(eleves, { matricule: "m001" }).eleve?.matricule).toBe("M001"))
  it("retrouve par nom complet, les deux ordres", () => {
    expect(resoudreEleve(eleves, { nom: "Carine Ngo Bassong" }).eleve?.matricule).toBe("M002")
    expect(resoudreEleve(eleves, { nom: "NGO BASSONG Carine" }).correspondance).toBe("exact")
  })
  it("ignore accents et casse", () => expect(resoudreEleve(eleves, { nom: "aicha eteme" }).eleve?.matricule).toBe("M004"))
  it("distingue deux homonymes par le prénom", () => expect(resoudreEleve(eleves, { nom: "Jean Mbarga" }).eleve?.matricule).toBe("M001"))
  it("signale l'ambiguïté d'un nom de famille partagé", () => {
    const r = resoudreEleve(eleves, { nom: "Mbarga" })
    expect(r.correspondance).toBe("ambigu"); expect(r.candidats).toHaveLength(2)
  })
  it("signale un nom introuvable", () => expect(resoudreEleve(eleves, { nom: "Zorro" }).correspondance).toBe("introuvable"))
  it("rattrape un matricule faux grâce au nom", () => expect(resoudreEleve(eleves, { matricule: "M999", nom: "Carine" }).eleve?.matricule).toBe("M002"))
})
