// Paiements SasPay (établissements et enseignants indépendants) : appels à la fonction serveur « paiement ».
// Le montant est toujours calculé en base (configuration commerciale) ; le navigateur n'envoie que le produit et la quantité.
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { supabase } from "../supabase.js"
import { locale, t } from "../i18n.jsx"

export const fcfa = (n) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Number(n || 0)).replace(/[  ]/g, " ")} FCFA`
export const STATUTS = { en_attente: ["En attente", "warning"], paye: ["Payé", "success"], echoue: ["Échoué", "danger"], annule: ["Annulé", "secondary"] }

export { montantEtablissement } from "./offres.js"

export async function appelerPaiement(action, corps) {
  const { data, error } = await supabase.functions.invoke(`paiement/${action}`, { body: corps })
  if (error) {
    let message = error.message
    try { message = (await error.context?.json())?.erreur || message } catch { /* réponse illisible */ }
    throw new Error(message)
  }
  return data
}

/** Adresse de retour après SasPay (page courante de l'application). */
export function adresseRetour(chemin) {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${chemin}`
}

/** Prépare le paiement d'un produit et redirige vers SasPay. Renvoie { gratuit } si rien n'est à payer. */
export async function payer(produit, chemin, extra = {}) {
  const r = await appelerPaiement("creer", { produit, ...extra, retour: adresseRetour(chemin) })
  if (r?.gratuit) return r
  window.location.assign(r.url)
  return r
}

/**
 * Retour de SasPay (?paiement=…) : revérifie côté serveur, puis signale le résultat. Revérifie aussi, à l'ouverture,
 * les paiements restés en attente (page fermée trop tôt).
 */
export function useRetourPaiement(enAttente, apres) {
  const [params, setParams] = useSearchParams()
  const [msg, setMsg] = useState({})
  const retour = params.get("paiement")
  useEffect(() => {
    if (!retour) return
    setMsg({ info: t("Vérification du paiement auprès de SasPay…") })
    appelerPaiement("verifier", { paiement_id: retour }).then((r) => {
      const etat = (r.paiements || []).find((x) => x.id === retour)?.statut
      if (etat === "paye") setMsg({ ok: t("Paiement reçu : votre abonnement est à jour. Un reçu vous a été envoyé par e-mail.") })
      else if (etat === "annule") setMsg({ erreur: t("Paiement annulé : aucun montant n'a été débité.") })
      else if (etat === "echoue") setMsg({ erreur: t("Le paiement a échoué. Vous pouvez réessayer.") })
      else setMsg({ info: t("Paiement en cours de confirmation. Cette page se met à jour dès que SasPay le confirme.") })
      apres()
    }).catch((e) => setMsg({ erreur: e.message })).finally(() => setParams({}, { replace: true }))
  }, [retour]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (retour || !enAttente) return
    appelerPaiement("verifier", {}).then((r) => { if (r.paiements?.some((p) => p.statut === "paye")) apres() }).catch(() => {})
  }, [enAttente]) // eslint-disable-line react-hooks/exhaustive-deps
  return [msg, setMsg]
}
