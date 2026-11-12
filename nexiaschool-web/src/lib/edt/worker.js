// Web Worker : la génération tourne en arrière-plan, l'interface reste utilisable ; la progression envoyée est réelle
// (cours placés, puis itérations d'optimisation effectuées). Annulation : l'interface met fin au worker.
import { resoudre } from "./moteur.js"

self.onmessage = (ev) => {
  const { config, graine, intensite, variante } = ev.data
  try {
    let dernier = 0
    const res = resoudre(config, {
      graine, intensite,
      progres: (p) => { const now = Date.now(); if (now - dernier > 120 || p.fait === p.total) { dernier = now; self.postMessage({ type: "progres", variante, ...p }) } },
    })
    self.postMessage({ type: "resultat", variante, graine, resultat: res })
  } catch (e) {
    self.postMessage({ type: "erreur", variante, message: String(e?.message || e) })
  }
}
