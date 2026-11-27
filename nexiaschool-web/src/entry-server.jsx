// Pré-rendu des pages publiques au build (scripts/prerender.mjs) : la même application React que dans le navigateur,
// rendue pour une adresse donnée, visiteur anonyme, en français. prerenderToNodeStream attend les pages chargées à la demande.
import { StrictMode } from "react"
import { prerenderToNodeStream } from "react-dom/static"
import { StaticRouter } from "react-router-dom"
import App from "./App.jsx"
import { LangueProvider } from "./i18n.jsx"

export async function rendre(adresse) {
  const { prelude } = await prerenderToNodeStream(
    <StrictMode><LangueProvider><App Routeur={StaticRouter} adresse={adresse} /></LangueProvider></StrictMode>)
  const morceaux = []
  for await (const m of prelude) morceaux.push(typeof m === "string" ? Buffer.from(m) : m)
  return Buffer.concat(morceaux).toString("utf8")
}
