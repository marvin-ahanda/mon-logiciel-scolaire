// Courrier des parents : objets, routage, lettre administrative (présentation en usage au Cameroun), messages de remerciement.
import { locale, t } from "../i18n.jsx"

export const OBJETS = [
  ["reclamation", "Réclamation"],
  ["audience", "Demande d'audience"],
  ["suggestion", "Suggestion"],
  ["moratoire", "Demande de moratoire (frais d'écolage)"],
  ["absence", "Demande d'autorisation d'absence"],
]
export const libelleObjet = (o) => t(OBJETS.find((x) => x[0] === o)?.[1] || o)
export const QUALITES = [["pere", "Père"], ["mere", "Mère"], ["tuteur", "Tuteur"], ["tutrice", "Tutrice"]]
const QUALITE_ELEVE = { pere: "Père de l'élève", mere: "Mère de l'élève", tuteur: "Tuteur de l'élève", tutrice: "Tutrice de l'élève" }
export const qualiteEleve = (q) => t(QUALITE_ELEVE[q] || "Parent de l'élève")
/** Service qui reçoit le courrier (affiché au parent) */
export const SERVICES = { reclamation: "l'administration", audience: "le chef d'établissement", suggestion: "l'administration",
  moratoire: "l'administration et le service financier", absence: "le surveillant général" }

export const dateLongue = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }) : "")
const fcfa = (n) => `${new Intl.NumberFormat(locale()).format(n)} FCFA`

/**
 * Contenu d'une lettre administrative : c = courrier { parent_nom, parent_qualite, parent_telephone, ville, objet, precision_objet,
 * details, message, eleve, classe, matricule, envoye_le?, reference? } ; etab = { nom, ville }.
 */
export function lettre(c, etab) {
  const sg = c.objet === "absence"
  const titre = sg ? t("Madame, Monsieur le Surveillant Général") : t("Madame, Monsieur le Chef d'établissement")
  const qui = { v0: c.eleve, v1: c.classe }
  const introductions = {
    reclamation: t("J'ai l'honneur de porter à votre connaissance une réclamation concernant mon enfant {v0}, élève en classe de {v1}.", qui),
    audience: t("J'ai l'honneur de solliciter de votre haute bienveillance une audience au sujet de mon enfant {v0}, élève en classe de {v1}.", qui),
    suggestion: t("En ma qualité de parent de {v0}, élève en classe de {v1}, j'ai l'honneur de vous soumettre la suggestion suivante.", qui),
    moratoire: t("J'ai l'honneur de solliciter de votre haute bienveillance un moratoire pour le paiement des frais d'écolage de mon enfant {v0}, élève en classe de {v1}, jusqu'au {v2}.",
      { ...qui, v2: dateLongue(c.details?.jusqu_au) }) + (c.details?.montant ? " " + t("Le montant concerné s'élève à {v0}.", { v0: fcfa(c.details.montant) }) : ""),
    absence: c.details?.au && c.details.au !== c.details.du
      ? t("J'ai l'honneur de solliciter une autorisation d'absence pour mon enfant {v0}, élève en classe de {v1}, du {v2} au {v3} inclus.", { ...qui, v2: dateLongue(c.details?.du), v3: dateLongue(c.details?.au) })
      : t("J'ai l'honneur de solliciter une autorisation d'absence pour mon enfant {v0}, élève en classe de {v1}, le {v2}.", { ...qui, v2: dateLongue(c.details?.du) }),
  }
  const formules = {
    suggestion: t("Je vous prie d'agréer, {v0}, l'expression de mes salutations distinguées.", { v0: titre }),
    reclamation: t("Comptant sur votre diligence habituelle, je vous prie d'agréer, {v0}, l'expression de ma haute considération.", { v0: titre }),
  }
  const objets = {
    reclamation: t("Réclamation") + (c.precision_objet ? ` — ${c.precision_objet}` : ""),
    audience: t("Demande d'audience") + (c.precision_objet ? ` — ${c.precision_objet}` : ""),
    suggestion: t("Suggestion") + (c.precision_objet ? ` — ${c.precision_objet}` : ""),
    moratoire: t("Demande de moratoire pour le paiement des frais d'écolage"),
    absence: t("Demande d'autorisation d'absence") + (c.precision_objet ? ` — ${c.precision_objet}` : ""),
  }
  return {
    expediteur: [c.parent_nom, qualiteEleve(c.parent_qualite) + ` ${c.eleve}`, t("Classe : {v0} — Matricule : {v1}", { v0: c.classe, v1: c.matricule }),
      c.parent_telephone && t("Tél. : {v0}", { v0: c.parent_telephone })].filter(Boolean),
    lieuDate: t("{v0}, le {v1}", { v0: c.ville || etab?.ville || "", v1: dateLongue(c.envoye_le || new Date()) }),
    destinataire: [t("À"), sg ? t("Madame, Monsieur le Surveillant Général") : t("Madame, Monsieur le Chef d'établissement"),
      t("du {v0}", { v0: etab?.nom || "" }), c.objet === "moratoire" ? t("(Service financier)") : etab?.ville ? `— ${etab.ville} —` : ""].filter(Boolean),
    objet: objets[c.objet],
    reference: c.reference || "",
    appel: `${titre},`,
    introduction: introductions[c.objet],
    corps: String(c.message || "").split(/\n{2,}|\r\n\r\n/).map((x) => x.trim()).filter(Boolean),
    formule: formules[c.objet] || t("Dans l'attente d'une suite favorable, je vous prie d'agréer, {v0}, l'expression de ma haute considération.", { v0: titre }),
    signature: [c.parent_nom, `(${qualiteEleve(c.parent_qualite)})`],
  }
}

/** Message de remerciement affiché au parent après l'envoi, selon l'objet. */
export function remerciement(c, etab, reference) {
  const v = { v0: c.parent_nom, v1: c.eleve, v2: etab?.nom || "" }
  const m = {
    reclamation: t("Merci, {v0}. Votre réclamation concernant {v1} a bien été transmise à l'administration du {v2}. Elle sera examinée avec attention ; la réponse vous parviendra dans cet espace.", v),
    audience: t("Merci, {v0}. Votre demande d'audience au sujet de {v1} a bien été transmise au chef d'établissement du {v2}. Vous serez informé(e) ici de la suite donnée.", v),
    suggestion: t("Merci, {v0}, pour votre suggestion. Elle a bien été transmise à l'administration du {v2} : vos idées contribuent à améliorer la vie de l'établissement.", v),
    moratoire: t("Merci, {v0}. Votre demande de moratoire pour les frais d'écolage de {v1} a bien été transmise à l'administration et au service financier du {v2}. La décision vous sera communiquée dans cet espace.", v),
    absence: t("Merci, {v0}. Votre demande d'autorisation d'absence pour {v1} a bien été transmise au surveillant général du {v2}. Sa réponse vous parviendra dans cet espace.", v),
  }
  return `${m[c.objet]} ${t("Référence de votre courrier : {v0}.", { v0: reference })}`
}
