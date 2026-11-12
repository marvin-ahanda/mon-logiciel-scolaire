// Vérification de faisabilité avant génération (étape 5) : bilan chiffré par classe, par enseignant et par type de salle,
// contraintes bloquantes expliquées et questions à poser à l'utilisateur (avec champ de réponse).
// Les contrôles sont des conditions nécessaires exactes (flots maximaux) : une erreur signalée ici rend la génération
// impossible ; l'absence d'erreur ne garantit pas une solution (le moteur le dira, avec un diagnostic).
// Aucune contrainte obligatoire n'est jamais assouplie automatiquement : seules les réponses de l'utilisateur modifient la configuration.
import { classesDe, coursAPlacer, erreursHoraires, nomEnseignant, NOM_JOUR, reglageClasse, reglageEnseignant, semaine, t } from "./modele.js"
import { preparer } from "./moteur.js"

/** Flot maximal (Dinic) sur un petit graphe : arcs [de, vers, capacité]. */
export function flotMax(n, arcs, source, puits) {
  const tete = new Array(n).fill(-1), suiv = [], vers = [], cap = []
  const ajout = (a, b, c) => { vers.push(b); cap.push(c); suiv.push(tete[a]); tete[a] = vers.length - 1 }
  for (const [a, b, c] of arcs) { ajout(a, b, c); ajout(b, a, 0) }
  let flot = 0
  const niveau = new Int32Array(n), it = new Int32Array(n)
  const bfs = () => {
    niveau.fill(-1); niveau[source] = 0; const file = [source]
    for (let i = 0; i < file.length; i++) for (let k = tete[file[i]]; k >= 0; k = suiv[k]) if (cap[k] > 0 && niveau[vers[k]] < 0) { niveau[vers[k]] = niveau[file[i]] + 1; file.push(vers[k]) }
    return niveau[puits] >= 0
  }
  const dfs = (u, f) => {
    if (u === puits) return f
    for (; it[u] >= 0; it[u] = suiv[it[u]]) {
      const k = it[u], v = vers[k]
      if (cap[k] > 0 && niveau[v] === niveau[u] + 1) { const r = dfs(v, Math.min(f, cap[k])); if (r > 0) { cap[k] -= r; cap[k ^ 1] += r; return r } }
    }
    return 0
  }
  while (bfs()) { for (let i = 0; i < n; i++) it[i] = tete[i]; let f; while ((f = dfs(source, Infinity)) > 0) flot += f }
  return flot
}

/**
 * Nombre maximal de cours d'un groupe (classe ou enseignant) qui trouvent chacun un créneau distinct de leur domaine,
 * avec au plus maxJour cours par jour (calcul exact par flot maximal).
 */
function placementPossible(I, lecons, maxJour) {
  if (!lecons.length) return 0
  const S = I.S, D = I.D
  const nL = lecons.length, src = 0, puits = 1, offL = 2, offS = offL + nL, offJ = offS + S
  const arcs = []
  lecons.forEach((l, i) => {
    arcs.push([src, offL + i, 1])
    for (const s of I.domaine[l]) arcs.push([offL + i, offS + s, 1])
  })
  for (let s = 0; s < S; s++) arcs.push([offS + s, offJ + ((s / I.P) | 0), 1])
  for (let d = 0; d < D; d++) arcs.push([offJ + d, puits, maxJour])
  return flotMax(offJ + D, arcs, src, puits)
}

const jourListe = (js) => js.map((j) => NOM_JOUR[j]).join(", ")

/**
 * Analyse complète. Renvoie { ok, erreurs: [message + questions], avertissements, chiffres: { classes, enseignants, salles, total } }.
 * Chaque message : { k, v, cible?, questions?: [{ id, type: "nombre"|"jours", cible: { enseignant|classe|affectation }, champ, valeur, min, max, libelle }] }
 */
export function analyser(cfg) {
  const erreurs = [], avert = []
  const h = erreursHoraires(cfg.horaires)
  if (h.length) return { ok: false, erreurs: h, avertissements: [], chiffres: null }
  if (!cfg.affectations.length) return { ok: false, erreurs: [t("Aucune affectation : importez d'abord le fichier des enseignants (étape 2).")], avertissements: [], chiffres: null }
  const I = preparer(cfg), sem = semaine(cfg.horaires)
  const lecons = coursAPlacer(cfg)
  const ouverts = sem.ouvert.flat().filter(Boolean).length

  // --- classes
  const chiffresClasses = []
  for (const c of classesDe(cfg)) {
    const ci = I.idxC.get(c.id)
    const ls = lecons.filter((l) => l.cls === c.id).map((l) => l.id)
    const cours = ls.filter((l) => !I.perm[l]).length, perm = ls.length - cours
    const interdits = (cfg.classes?.[c.id]?.interdits || []).length
    const creneaux = new Set(ls.flatMap((l) => I.domaine[l])).size
    const maxJour = I.maxJourC[ci]
    const capJour = sem.jours.reduce((s, _, d) => s + Math.min(maxJour, sem.ouvert[d].filter(Boolean).length), 0)
    const possibles = placementPossible(I, ls, sem.P)   // cours et permanences : un créneau chacun
    const coursPossibles = placementPossible(I, ls.filter((l) => !I.perm[l]), maxJour)
    chiffresClasses.push({ id: c.id, libelle: c.libelle, cours, permanences: perm, creneaux, ouverts, interdits, maxJour, capJour, taux: creneaux ? Math.round((ls.length / creneaux) * 100) : 100 })
    if (ls.length > creneaux) {
      erreurs.push({ ...t("Classe {v0} : {v1} heures à placer (dont {v2} de permanence) pour {v3} créneaux utilisables seulement.", { v0: c.libelle, v1: ls.length, v2: perm, v3: creneaux }),
        cible: { classe: c.id },
        questions: [
          ...(perm ? [{ id: `perm-${c.id}`, type: "nombre", cible: { classe: c.id }, champ: "permanences.heures", valeur: perm, min: 0, max: 40,
            libelle: t("Combien d'heures de permanence garder pour la classe {v0} ?", { v0: c.libelle }) }] : []),
          ...(interdits ? [{ id: `int-${c.id}`, type: "info", libelle: t("La classe {v0} a {v1} créneau(x) interdit(s) : pouvez-vous en libérer à l'étape 3 ?", { v0: c.libelle, v1: interdits }) }] : []),
        ] })
    } else if (cours > capJour) {
      erreurs.push({ ...t("Classe {v0} : {v1} heures de cours pour au plus {v2} heures par jour, soit {v3} heures sur la semaine.", { v0: c.libelle, v1: cours, v2: maxJour, v3: capJour }),
        cible: { classe: c.id },
        questions: [{ id: `cmax-${c.id}`, type: "nombre", cible: { classe: c.id }, champ: "max_jour", valeur: maxJour, min: 1, max: sem.P,
          libelle: t("Quel maximum d'heures de cours par jour accepter pour la classe {v0} ?", { v0: c.libelle }) }] })
    } else if (possibles < ls.length || coursPossibles < cours) {
      erreurs.push({ ...t("Classe {v0} : les créneaux autorisés ne permettent de placer que {v1} heures sur {v2} (disponibilités des enseignants, créneaux interdits, plages de permanence).", { v0: c.libelle, v1: Math.min(possibles, coursPossibles + perm), v2: ls.length }),
        cible: { classe: c.id },
        questions: [{ id: `cmax2-${c.id}`, type: "nombre", cible: { classe: c.id }, champ: "max_jour", valeur: maxJour, min: 1, max: sem.P,
          libelle: t("Quel maximum d'heures de cours par jour accepter pour la classe {v0} ?", { v0: c.libelle }) }] })
    } else if (ls.length / Math.max(1, creneaux) > 0.92) {
      avert.push(t("Classe {v0} : emploi du temps très chargé ({v1} heures pour {v2} créneaux) ; peu de marge pour éviter les heures creuses.", { v0: c.libelle, v1: ls.length, v2: creneaux }))
    }
  }

  // --- enseignants
  const chiffresEns = []
  for (const e of cfg.enseignants) {
    const ei = I.idxE.get(e.cle)
    const ls = lecons.filter((l) => l.ens === e.cle).map((l) => l.id)
    if (!ls.length) continue
    const nom = nomEnseignant(e)
    const maxJour = I.maxJourE[ei], maxSem = reglageEnseignant(cfg, e, "max_semaine")
    const dispo = new Set(); sem.jours.forEach((j, d) => { for (let p = 0; p < sem.P; p++) if (sem.ouvert[d][p] && (!I.strict || I.dispo[ei][d * sem.P + p])) dispo.add(d * sem.P + p) })
    const joursDispo = sem.jours.filter((j, d) => [...dispo].some((s) => ((s / sem.P) | 0) === d))
    const capJour = joursDispo.reduce((s, j) => s + Math.min(maxJour, [...dispo].filter((x) => sem.jours[(x / sem.P) | 0] === j).length), 0)
    const possibles = placementPossible(I, ls, maxJour)
    chiffresEns.push({ cle: e.cle, nom, heures: ls.length, disponibles: dispo.size, jours: joursDispo.length, maxJour, maxSemaine: maxSem, capJour, taux: dispo.size ? Math.round((ls.length / dispo.size) * 100) : 100 })
    const qJours = { id: `jours-${e.cle}`, type: "jours", cible: { enseignant: e.cle }, champ: "jours", valeur: e.jours?.length ? e.jours : sem.jours,
      libelle: t("Quels jours {v0} peut-il ou peut-elle réellement assurer des cours ?", { v0: nom }) }
    if (maxSem && ls.length > maxSem) {
      erreurs.push({ ...t("{v0} : {v1} heures de cours pour un maximum de {v2} heures par semaine.", { v0: nom, v1: ls.length, v2: maxSem }), cible: { enseignant: e.cle },
        questions: [{ id: `msem-${e.cle}`, type: "nombre", cible: { enseignant: e.cle }, champ: "max_semaine", valeur: maxSem, min: 1, max: 60,
          libelle: t("Quel maximum d'heures par semaine accepter pour {v0} ?", { v0: nom }) }] })
    } else if (ls.length > dispo.size) {
      erreurs.push({ ...t("{v0} : {v1} heures de cours pour {v2} créneaux disponibles ({v3}).", { v0: nom, v1: ls.length, v2: dispo.size, v3: jourListe(joursDispo) || "—" }), cible: { enseignant: e.cle }, questions: [qJours] })
    } else if (ls.length > capJour) {
      erreurs.push({ ...t("{v0} : {v1} heures de cours, mais au plus {v2} heures par jour sur {v3} jour(s) disponible(s).", { v0: nom, v1: ls.length, v2: maxJour, v3: joursDispo.length }), cible: { enseignant: e.cle },
        questions: [qJours, { id: `mj-${e.cle}`, type: "nombre", cible: { enseignant: e.cle }, champ: "max_jour", valeur: maxJour, min: 1, max: sem.P,
          libelle: t("Quel maximum d'heures par jour accepter pour {v0} ?", { v0: nom }) }] })
    } else if (possibles < ls.length) {
      erreurs.push({ ...t("{v0} : ses disponibilités ne coïncident pas assez avec les créneaux de ses classes : {v1} heures plaçables sur {v2}.", { v0: nom, v1: possibles, v2: ls.length }), cible: { enseignant: e.cle }, questions: [qJours] })
    } else if (ls.length / Math.max(1, dispo.size) > 0.9) {
      avert.push(t("{v0} : {v1} heures pour {v2} créneaux disponibles : marge très faible.", { v0: nom, v1: ls.length, v2: dispo.size }))
    }
  }
  // affectations sans aucun créneau commun (enseignant indisponible quand la classe est libre)
  for (const a of cfg.affectations) {
    const l = lecons.find((x) => x.a === a.id)
    if (!l || I.domaine[l.id].length || I.lt[l.id] === -2) continue
    const e = cfg.enseignants.find((x) => x.cle === a.enseignant)
    erreurs.push({ ...t("{v0} en {v1} ({v2}) : aucun créneau commun entre les disponibilités de l'enseignant et les créneaux autorisés de la classe.", { v0: a.discipline, v1: a.classe, v2: nomEnseignant(e) }),
      cible: { affectation: a.id }, questions: e ? [{ id: `jours-${e.cle}-${a.id}`, type: "jours", cible: { enseignant: e.cle }, champ: "jours", valeur: e.jours?.length ? e.jours : sem.jours,
        libelle: t("Quels jours {v0} peut-il ou peut-elle réellement assurer des cours ?", { v0: nomEnseignant(e) }) }] : [] })
  }

  // --- salles spécialisées
  const chiffresSalles = []
  const besoins = new Map()
  for (const l of lecons) if (l.salle) besoins.set(l.salle, (besoins.get(l.salle) || 0) + 1)
  for (const [type, n] of besoins) {
    const nb = cfg.salles.filter((s) => s.type === type).length
    chiffresSalles.push({ type, heures: n, salles: nb, capacite: nb * ouverts })
    if (!nb) erreurs.push({ ...t("Aucune salle de type « {v0} » n'est déclarée, alors que {v1} heures l'exigent.", { v0: type, v1: n }), cible: { salle: type },
      questions: [{ id: `salle-${type}`, type: "info", libelle: t("Ajoutez au moins une salle de type « {v0} » à l'étape 3 (Salles spécialisées), ou retirez cette exigence.", { v0: type }) }] })
    else if (n > nb * ouverts) erreurs.push({ ...t("Salles « {v0} » : {v1} heures à placer pour {v2} salle(s) et {v3} créneaux par semaine.", { v0: type, v1: n, v2: nb, v3: ouverts }), cible: { salle: type },
      questions: [{ id: `salle2-${type}`, type: "info", libelle: t("Ajoutez des salles de type « {v0} » à l'étape 3, ou réduisez les heures qui l'exigent.", { v0: type }) }] })
    else if (n / (nb * ouverts) > 0.85) avert.push(t("Salles « {v0} » très demandées : {v1} heures pour {v2} créneaux.", { v0: type, v1: n, v2: nb * ouverts }))
  }
  // permanences
  for (const c of classesDe(cfg)) {
    const n = Number(cfg.classes?.[c.id]?.permanences?.heures) || 0
    if (!n) continue
    const l = lecons.find((x) => x.cls === c.id && x.type === "perm")
    if (I.domaine[l.id].length < n) erreurs.push({ ...t("Classe {v0} : {v1} heures de permanence demandées pour {v2} créneaux autorisés (jours et plage choisis).", { v0: c.libelle, v1: n, v2: I.domaine[l.id].length }),
      cible: { classe: c.id }, questions: [{ id: `perm2-${c.id}`, type: "nombre", cible: { classe: c.id }, champ: "permanences.heures", valeur: n, min: 0, max: 40,
        libelle: t("Combien d'heures de permanence garder pour la classe {v0} ?", { v0: c.libelle }) }] })
  }
  const total = lecons.length
  return {
    ok: !erreurs.length, erreurs, avertissements: avert,
    chiffres: { classes: chiffresClasses, enseignants: chiffresEns, salles: chiffresSalles,
      total: { heures: total, cours: lecons.filter((l) => l.type === "cours").length, permanences: lecons.filter((l) => l.type === "perm").length,
        classes: chiffresClasses.length, enseignants: chiffresEns.length, creneaux: ouverts, jours: sem.jours.length, periodes: sem.P } },
  }
}

/** Applique la réponse de l'utilisateur à une question (copie de la configuration). */
export function appliquerReponse(cfg, q, valeur) {
  const x = structuredClone(cfg)
  if (q.cible.enseignant) {
    const e = x.enseignants.find((y) => y.cle === q.cible.enseignant); if (!e) return x
    e[q.champ] = q.type === "jours" ? [...valeur].sort() : Number(valeur)
  } else if (q.cible.classe) {
    const c = (x.classes[q.cible.classe] ||= {})
    if (q.champ === "permanences.heures") c.permanences = { ...(c.permanences || {}), heures: Number(valeur) }
    else c[q.champ] = Number(valeur)
  } else if (q.cible.affectation) {
    const a = x.affectations.find((y) => y.id === q.cible.affectation); if (a) a[q.champ] = Number(valeur)
  }
  return x
}

/** Explications des cours non placés par le moteur (diagnostic) : messages et questions regroupés par classe et enseignant. */
export function expliquerEchec(cfg, nonPlaces) {
  const parGroupe = new Map()
  const ens = new Map(cfg.enseignants.map((e) => [e.cle, e]))
  for (const n of nonPlaces) {
    const k = `${n.cours.cls}|${n.cours.ens || ""}|${n.cours.disc}`
    const g = parGroupe.get(k) || { cours: n.cours, nb: 0, raisons: {} }
    g.nb++; for (const [r, v] of Object.entries(n.raisons)) g.raisons[r] = (g.raisons[r] || 0) + v
    parGroupe.set(k, g)
  }
  const RAISONS = {
    classe_occupee: t("la classe a déjà cours sur les créneaux possibles"),
    enseignant_occupe: t("l'enseignant est déjà pris dans une autre classe"),
    salle_occupee: t("les salles spécialisées sont déjà toutes occupées"),
    classe_max_jour: t("la classe atteint son maximum d'heures par jour"),
    enseignant_max_jour: t("l'enseignant atteint son maximum d'heures par jour"),
    aucun_creneau: t("aucun créneau autorisé"),
    salle_absente: t("aucune salle du type exigé"),
  }
  const libelleClasse = (id) => cfg.affectations.find((a) => a.classe_id === id)?.classe || cfg.classes?.[id]?.libelle || ""
  return [...parGroupe.values()].map((g) => {
    const e = ens.get(g.cours.ens)
    const raisons = Object.entries(g.raisons).filter(([r]) => RAISONS[r]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => RAISONS[r])
    const questions = []
    if (e) questions.push({ id: `jours-${e.cle}`, type: "jours", cible: { enseignant: e.cle }, champ: "jours", valeur: e.jours?.length ? e.jours : cfg.horaires.jours,
      libelle: t("Quels jours {v0} peut-il ou peut-elle réellement assurer des cours ?", { v0: nomEnseignant(e) }) })
    if (e && g.raisons.enseignant_max_jour) questions.push({ id: `mj-${e.cle}`, type: "nombre", cible: { enseignant: e.cle }, champ: "max_jour", valeur: reglageEnseignant(cfg, e, "max_jour"), min: 1, max: 16,
      libelle: t("Quel maximum d'heures par jour accepter pour {v0} ?", { v0: nomEnseignant(e) }) })
    if (g.raisons.classe_max_jour) questions.push({ id: `cmax-${g.cours.cls}`, type: "nombre", cible: { classe: g.cours.cls }, champ: "max_jour", valeur: reglageClasse(cfg, g.cours.cls, "max_jour"), min: 1, max: 16,
      libelle: t("Quel maximum d'heures de cours par jour accepter pour la classe {v0} ?", { v0: libelleClasse(g.cours.cls) }) })
    return {
      ...t("{v0} heure(s) de {v1} en {v2}{v3} n'ont pas pu être placées.", { v0: g.nb, v1: g.cours.disc, v2: libelleClasse(g.cours.cls), v3: e ? ` (${nomEnseignant(e)})` : "" }),
      raisons, questions,
    }
  })
}
