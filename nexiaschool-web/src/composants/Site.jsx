// Éléments communs du site public : marque NexIA School, en-tête des pages secondaires, fond « lignes » de la section d'accueil.
import { memo } from "react"
import { Link } from "react-router-dom"
import { ChoixLangue, t } from "../i18n.jsx"
import "@fontsource/poppins/300.css"
import "@fontsource/poppins/400.css"
import "@fontsource/poppins/500.css"
import "@fontsource/poppins/600.css"
import "../landing.css"

export function Marque({ clair = false, taille }) {
  return (
    <span className={`lp-marque ${clair ? "lp-marque-clair" : ""}`} style={taille ? { "--marque": `${taille}px` } : undefined}>
      <img src="/logo-nexia-192.png" alt="" width="48" height="48" />
      <span><b>NexIA</b> School</span>
    </span>
  )
}

/** En-tête des pages secondaires (légal, développeurs). */
export function EnteteSimple({ action = "accueil" }) {
  return (
    <header className="lp-entete-simple">
      <div className="lp-conteneur lp-entete-interieur">
        <Link to="/" aria-label={t("NexIA School, accueil")}><Marque /></Link>
        <div className="d-flex align-items-center gap-3 ms-auto">
          <ChoixLangue />
          {action === "connexion" ? <Link className="lp-bouton lp-bouton-petit" to="/etablissement">{t("Se connecter")}</Link>
            : <Link className="lp-bouton lp-bouton-petit lp-bouton-blanc" to="/">{t("Retour à l'accueil")}</Link>}
        </div>
      </div>
    </header>
  )
}

// Générateur pseudo-aléatoire déterministe (le dessin est identique à chaque affichage)
function alea(graine) { let s = graine; return () => ((s = (s * 16807) % 2147483647) / 2147483647) }

/**
 * Fond de la section d'accueil : faisceaux de fines lignes bleues qui descendent des coins supérieurs, convergent
 * vers un point lumineux au centre bas, puis s'ouvrent en vagues vers le bas et les côtés.
 */
export const FondLignes = memo(function FondLignes() {
  const L = 1694, H = 951, cx = 847, cy = 668
  const r = alea(11), f = (n) => n.toFixed(1)
  const traits = []
  for (const s of [-1, 1]) {
    // ailes : des coins supérieurs et des bords, les faisceaux plongent puis convergent vers le point lumineux
    for (let i = 0; i < 150; i++) {
      const k = i / 149
      const x0 = cx + s * (L / 2 + 60 - Math.max(0, k - 0.55) * 900), y0 = k < 0.55 ? -40 + (0.55 - k) * 700 * 0 + k * 40 : -10
      const depart = k < 0.55 ? [cx + s * (L / 2 + 30 + (0.55 - k) * 60), -30 + k * 520] : [x0, y0]
      const c1 = [cx + s * (L / 2 - 40 - k * 180 + r() * 14), depart[1] + 260 + k * 150]
      const c2 = [cx + s * (250 + (1 - k) * 160), cy - 30 + k * 25]
      const fin = [cx + s * (2 + k * 14), cy - 2 + k * 6]
      traits.push({ d: `M${f(depart[0])} ${f(depart[1])}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(fin[0])} ${f(fin[1])}`, g: "a", o: 0.28 + 0.6 * Math.sin(k * Math.PI) ** 0.6, w: 0.75 })
    }
    // sol : les lignes quittent le point lumineux à l'horizontale, puis s'ouvrent vers les bords et le bas
    for (let i = 0; i < 180; i++) {
      const k = i / 179
      const surCote = k < 0.42, q = surCote ? k / 0.42 : (k - 0.42) / 0.58
      const fin = surCote ? [cx + s * (L / 2 + 40), cy + 40 + q * (H - cy)] : [cx + s * ((L / 2 + 40) * (1 - q) + 30 * q), H + 30]
      const c1 = [cx + s * (160 + (1 - k) * 360), cy + 4 + k * 26 + r() * 6]
      const c2 = surCote ? [fin[0] - s * (300 - q * 120), fin[1] - 20 - q * 40] : [fin[0] + s * (90 + q * 40), fin[1] - 170 + q * 60]
      traits.push({ d: `M${f(cx + s * (2 + k * 4))} ${f(cy + 2 + k * 3)}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(fin[0])} ${f(fin[1])}`, g: "b", o: 0.3 + 0.55 * k, w: 0.7 })
    }
  }
  // gerbe centrale : du point lumineux vers le bas, en éventail
  for (let i = 0; i < 90; i++) {
    const k = i / 89, s = i % 2 ? 1 : -1, e = Math.pow(k, 1.15) * 420
    traits.push({ d: `M${f(cx + s * k * 3)} ${f(cy + 4)}C${f(cx + s * (40 + e * 0.35))} ${f(cy + 40)} ${f(cx + s * e * 0.8)} ${f(H - 140)} ${f(cx + s * e)} ${f(H + 30)}`, g: "b", o: 0.25 + 0.5 * k, w: 0.65 })
  }
  return (
    <svg className="lp-lignes" viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lp-trait-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d7e6fb" /><stop offset=".5" stopColor="#a3c6f3" /><stop offset="1" stopColor="#7ea3ea" /></linearGradient>
        <linearGradient id="lp-trait-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b5d0f5" /><stop offset=".6" stopColor="#8aa9ec" /><stop offset="1" stopColor="#6d86de" /></linearGradient>
        <radialGradient id="lp-voile" cx=".5" cy=".36" r=".42"><stop offset="0" stopColor="#fff" stopOpacity=".96" /><stop offset=".6" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        <radialGradient id="lp-eclat" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset=".4" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        <linearGradient id="lp-haut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset=".18" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width={L} height={H} fill="#f6f9ff" />
      <g fill="none" strokeLinecap="round">
        {traits.map((c, k) => <path key={k} d={c.d} stroke={`url(#lp-trait-${c.g})`} strokeWidth={c.w} strokeOpacity={c.o} />)}
      </g>
      <rect width={L} height={H} fill="url(#lp-voile)" />
      <rect width={L} height={H} fill="url(#lp-haut)" />
      <ellipse cx={cx} cy={cy + 4} rx="260" ry="90" fill="url(#lp-eclat)" />
    </svg>
  )
})
