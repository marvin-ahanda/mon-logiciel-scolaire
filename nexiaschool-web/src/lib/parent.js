// Session d'un parent (sans compte) : jeton remis après le nom et le matricule de l'élève, gardé sur l'appareil.
import { rpc } from "../supabase.js"

const CLE = "nexiaschool.parent"
export function lireSessionParent() {
  try { return JSON.parse(localStorage.getItem(CLE)) || null } catch { return null }
}
export function enregistrerSessionParent(s) {
  try { localStorage.setItem(CLE, JSON.stringify(s)) } catch { /* stockage indisponible */ }
}
export function oublierSessionParent() {
  try { localStorage.removeItem(CLE) } catch { /* stockage indisponible */ }
}
/** Appel d'une fonction de l'espace parent ; une session expirée renvoie une erreur portant `expiree`. */
export async function rpcParent(nom, params = {}) {
  const s = lireSessionParent()
  if (!s) { const e = new Error("Session expirée : reconnectez-vous."); e.expiree = true; throw e }
  try { return await rpc(nom, { p_session: s.jeton, ...params }) }
  catch (e) { if (/Session expirée|Session expired|n'est pas inscrit|not enrolled/.test(e.message)) e.expiree = true; throw e }
}
