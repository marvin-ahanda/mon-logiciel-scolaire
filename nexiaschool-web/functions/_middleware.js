// Cloudflare Pages Function (unique) :
//  1. relais du serveur MCP et de l'OAuth de NexIA School (Supabase Edge Function « mcp »), servis depuis le domaine du site ;
//  2. référencement : pages publiques pré-rendues servies telles quelles ; espace connecté, pages de connexion et liens à jeton
//     servis par la coquille neutre de l'application (app-shell.html) avec « X-Robots-Tag: noindex, nofollow » ;
//     adresse inconnue : même coquille, statut 404 (l'application affiche sa page « introuvable »).
// cloudflare/_routes.json exclut les fichiers statiques (scripts, images, robots.txt, sitemap.xml…) : ils ne passent pas ici.
import { estPagePublique, normaliser } from "../src/lib/seo-pages.js"

const CIBLES = [
  [/^\/mcp\/?$/, ""],
  [/^\/\.well-known\/oauth-protected-resource(\/.*)?$/, "/.well-known/oauth-protected-resource"],
  [/^\/\.well-known\/oauth-authorization-server(\/.*)?$/, "/.well-known/oauth-authorization-server"],
  [/^\/\.well-known\/openid-configuration$/, "/.well-known/oauth-authorization-server"],
  [/^\/oauth\/register$/, "/oauth/register"],
  [/^\/oauth\/token$/, "/oauth/token"],
]
// en-têtes propres au saut réseau : jamais transmis
const SAUT = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-proto", "x-real-ip"])

// Routes de l'application (src/App.jsx et sous-routeurs) : servies (200) mais jamais indexées. Toute autre adresse : 404.
export const APPLICATION = /^\/(etablissement|inscription|connexion|commencer|bienvenue|acces|parent|verifier|recu|distinction|carte|e|oauth|tarifs|smarteval|enseignant|institution|console|developpeur|mes-bulletins-paie|emploi-du-temps|automatisations|notes|excel|discipline|courrier|finance|eleves|parametres|personnel|abonnement|statistiques|fiches-statistiques|courriers-institutionnels|hors-ligne|app-shell)(\/|$)/

// En-têtes de sécurité (copie de cloudflare/_headers) : posés aussi ici au cas où _headers ne s'appliquerait pas à une réponse de Function.
const SECURITE = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; object-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
}

function avec(reponse, status, enPlus = {}) {
  const entetes = new Headers(reponse.headers)
  for (const [k, v] of Object.entries({ ...SECURITE, ...enPlus })) if (!entetes.has(k) || k in enPlus) entetes.set(k, v)
  return new Response(reponse.body, { status, headers: entetes })
}

async function relais(request, env, url, cible) {
  const origine = (env.MCP_ORIGINE || "").replace(/\/$/, "")
  if (!origine) return new Response("Relais MCP non configuré (MCP_ORIGINE).", { status: 500 })
  const entetes = new Headers()
  for (const [k, v] of request.headers) if (!SAUT.has(k.toLowerCase())) entetes.set(k, v)
  entetes.set("x-forwarded-host", url.host)
  const avecCorps = !["GET", "HEAD"].includes(request.method)
  const reponse = await fetch(origine + cible[1] + url.search, {
    method: request.method, headers: entetes, body: avecCorps ? request.body : undefined, redirect: "manual",
  })
  const sortie = new Headers(reponse.headers)
  sortie.set("Cache-Control", "no-store")
  return new Response(reponse.body, { status: reponse.status, statusText: reponse.statusText, headers: sortie })
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url)
  const cible = CIBLES.find(([motif]) => motif.test(url.pathname))
  if (cible) return relais(request, env, url, cible)

  // Redirections 301 désactivées en attente d'accord écrit (ancienne adresse pages.dev, barre finale des pages publiques) :
  // if (url.hostname === "nexiaschool.pages.dev") { url.hostname = "nexiaschool.com"; return Response.redirect(url.toString(), 301) }
  // if (url.pathname !== "/" && url.pathname.endsWith("/") && estPagePublique(url.pathname)) { url.pathname = normaliser(url.pathname); return Response.redirect(url.toString(), 301) }

  const reponse = await next()
  const html = (reponse.headers.get("content-type") || "").includes("text/html")
  if (!html || reponse.status !== 200 || !["GET", "HEAD"].includes(request.method)) return reponse
  const chemin = url.pathname
  if (estPagePublique(chemin) && normaliser(chemin) === (chemin === "/" ? "/" : chemin)) return avec(reponse, 200)

  // Application ou adresse inconnue : coquille neutre (sans le contenu pré-rendu d'une page publique), jamais indexée
  const coquille = await env.ASSETS.fetch(new URL("/app-shell", url))
  const base = coquille.ok ? coquille : reponse
  return avec(base, APPLICATION.test(chemin) ? 200 : 404, { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-cache" })
}
