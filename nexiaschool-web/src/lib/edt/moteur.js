// Moteur de génération des emplois du temps (programmation par contraintes, exécuté dans un Web Worker).
//
// 1. Placement : recherche itérative avec réparation des conflits (« iterative forward search », méthode éprouvée en
//    planification scolaire) : chaque cours non placé reçoit le créneau qui crée le moins de conflits ; les cours en
//    conflit sont retirés puis replacés. Les contraintes obligatoires ne sont jamais violées : un cours n'est posé que
//    sur un créneau compatible, après retrait des cours qui l'en empêchent.
// 2. Optimisation : recuit simulé sur les contraintes souples pondérées (priorités Élevée / Moyenne / Faible), par
//    déplacements et échanges de cours qui respectent toujours toutes les contraintes obligatoires.
// Déterministe : même configuration + même graine = même emploi du temps.
//
// Contraintes obligatoires (vérifiées aussi par le serveur avant tout enregistrement) :
//  - une classe, un enseignant, une salle : un seul cours à la fois ;
//  - aucun cours pendant une pause, une interruption, un jour non travaillé, un créneau interdit à la classe ;
//  - disponibilités des enseignants (si elles sont strictes) ; plages des permanences ;
//  - volume horaire exact de chaque affectation, nombre exact d'heures de permanence ;
//  - maximum d'heures de cours par jour (classe, enseignant) ; maximum d'heures consécutives d'un enseignant ;
//  - maximum d'heures consécutives d'une même matière dans une classe ; salles spécialisées en nombre suffisant.
import {
  aleatoire, classesDe, coursAPlacer, disponible, permanencePossible, POIDS, reglageClasse, reglageEnseignant, semaine, t,
} from "./modele.js"

// --- Préparation -------------------------------------------------------------------------------------------------
export function preparer(cfg) {
  const sem = semaine(cfg.horaires)
  const { jours, P, S } = sem, D = jours.length
  const classes = classesDe(cfg), C = classes.length
  const idxC = new Map(classes.map((c, i) => [c.id, i]))
  const ens = cfg.enseignants, E = ens.length
  const idxE = new Map(ens.map((e, i) => [e.cle, i]))
  const cours = coursAPlacer(cfg), L = cours.length
  const types = [...new Set(cfg.salles.map((s) => s.type).filter(Boolean))]
  const idxT = new Map(types.map((x, i) => [x, i]))
  const cap = types.map((x) => cfg.salles.filter((s) => s.type === x).length)
  const disciplines = [...new Set(cours.map((l) => l.disc))]
  const idxDisc = new Map(disciplines.map((x, i) => [x, i]))
  const affs = [...new Set(cours.filter((l) => l.a).map((l) => l.a))]
  const idxA = new Map(affs.map((x, i) => [x, i]))
  const strict = cfg.generales.enseignant.disponibilites !== "preferences"

  const lc = new Int32Array(L), le = new Int32Array(L), lt = new Int32Array(L), ld = new Int32Array(L), la = new Int32Array(L), perm = new Uint8Array(L)
  const domaine = []
  // disponibilités (souhaits) de chaque enseignant, pour la pénalité souple
  const dispo = ens.map((e) => { const x = new Uint8Array(S); for (let d = 0; d < D; d++) for (let p = 0; p < P; p++) x[d * P + p] = disponible(cfg, e, jours[d], p) ? 1 : 0; return x })
  for (const l of cours) {
    const c = idxC.get(l.cls), e = l.ens ? idxE.get(l.ens) ?? -1 : -1
    lc[l.id] = c; le[l.id] = e; lt[l.id] = l.salle ? idxT.get(l.salle) ?? -2 : -1; ld[l.id] = idxDisc.get(l.disc); la[l.id] = l.a ? idxA.get(l.a) : -1
    perm[l.id] = l.type === "perm" ? 1 : 0
    const interdits = new Set(cfg.classes?.[l.cls]?.interdits || [])
    const dom = []
    if (lt[l.id] !== -2) {
      for (let d = 0; d < D; d++) for (let p = 0; p < P; p++) {
        if (!sem.ouvert[d][p] || interdits.has(`${jours[d]}-${p}`)) continue
        if (perm[l.id] && !permanencePossible(cfg, l.cls, jours[d], p)) continue
        if (e >= 0 && strict && !dispo[e][d * P + p]) continue
        dom.push(d * P + p)
      }
    }
    domaine.push(dom)
  }
  const maxJourC = classes.map((c) => reglageClasse(cfg, c.id, "max_jour") || P)
  const maxConsC = classes.map((c) => reglageClasse(cfg, c.id, "max_consecutives") || P)
  const maxJourE = ens.map((e) => reglageEnseignant(cfg, e, "max_jour") || P)
  const maxConsE = ens.map((e) => reglageEnseignant(cfg, e, "max_consecutives") || P)
  const matin = classes.map((c) => new Set((cfg.classes?.[c.id]?.matin || []).map((x) => idxDisc.get(x)).filter((x) => x !== undefined)))
  const prefere = ens.map((e) => { const s = new Set(e.jours_preferes || []); return jours.map((j) => !s.size || s.has(j)) })
  const contigu = new Uint8Array(S), matinS = new Uint8Array(S), extremite = new Uint8Array(S), ouvertS = new Uint8Array(S)
  for (let d = 0; d < D; d++) for (let p = 0; p < P; p++) {
    const s = d * P + p
    contigu[s] = sem.contigu[d][p] ? 1 : 0; matinS[s] = sem.matin[d][p] ? 1 : 0; ouvertS[s] = sem.ouvert[d][p] ? 1 : 0
    extremite[s] = sem.debutDemi[d][p] || sem.finDemi[d][p] ? 1 : 0
  }
  // charge totale de chaque classe (pour l'équilibre) et volume de chaque affectation (pour la répartition)
  const chargeC = new Float64Array(C), volA = new Int32Array(affs.length)
  for (let l = 0; l < L; l++) { chargeC[lc[l]]++; if (la[l] >= 0) volA[la[l]]++ }
  const pr = cfg.generales.priorites || {}
  const w = (k) => POIDS[pr[k] || "moyenne"] ?? 10
  const poids = {
    trous_classes: w("trous_classes"), repetitions: w("repetitions"), repartition: w("repartition"), disponibilites: strict ? 0 : w("disponibilites"),
    trous_enseignants: w("trous_enseignants"), fragmentation: w("fragmentation"), equilibre: w("equilibre"), matin: w("matin"),
    preferences: w("preferences"), permanences: w("permanences"),
  }
  return {
    cfg, sem, jours, P, S, D, C, E, L, classes, ens, cours, types, cap, disciplines, affs, idxC, idxE, idxA,
    lc, le, lt, ld, la, perm, domaine, dispo, maxJourC, maxConsC, maxJourE, maxConsE, matin, prefere,
    contigu, matinS, extremite, ouvertS, chargeC, volA, poids, strict,
  }
}

// --- État de la recherche ----------------------------------------------------------------------------------------
function etatVide(I) {
  const { L, C, E, S, D, types } = I
  return {
    pos: new Int32Array(L).fill(-1),
    occC: new Int32Array(C * S).fill(-1), occE: new Int32Array(Math.max(1, E) * S).fill(-1),
    salle: new Int32Array(Math.max(1, types.length) * S), jourC: new Int32Array(C * D), jourE: new Int32Array(Math.max(1, E) * D),
  }
}

function poser(I, X, l, s) {
  const c = I.lc[l], e = I.le[l], t = I.lt[l], d = (s / I.P) | 0
  X.pos[l] = s; X.occC[c * I.S + s] = l
  if (e >= 0) { X.occE[e * I.S + s] = l; X.jourE[e * I.D + d]++ }
  if (t >= 0) X.salle[t * I.S + s]++
  if (!I.perm[l]) X.jourC[c * I.D + d]++
}
function retirer(I, X, l) {
  const s = X.pos[l]; if (s < 0) return
  const c = I.lc[l], e = I.le[l], t = I.lt[l], d = (s / I.P) | 0
  X.pos[l] = -1; X.occC[c * I.S + s] = -1
  if (e >= 0) { X.occE[e * I.S + s] = -1; X.jourE[e * I.D + d]-- }
  if (t >= 0) X.salle[t * I.S + s]--
  if (!I.perm[l]) X.jourC[c * I.D + d]--
}

/**
 * Cours à retirer pour pouvoir poser l sur s sans violer aucune contrainte obligatoire (tableau vide : place libre).
 * hasard() départage les choix (cours retiré pour respecter un maximum journalier).
 */
function conflits(I, X, l, s, hasard) {
  const { P, S, D } = I
  const c = I.lc[l], e = I.le[l], t = I.lt[l], d = (s / P) | 0, p = s % P, debut = d * P
  const res = []
  const dans = (x) => res.includes(x)
  const occC = X.occC[c * S + s]; if (occC >= 0) res.push(occC)
  if (e >= 0) { const o = X.occE[e * S + s]; if (o >= 0 && !dans(o)) res.push(o) }
  if (t >= 0 && X.salle[t * S + s] >= I.cap[t]) {
    // salle spécialisée complète : retirer un cours du même type de salle sur ce créneau
    let n = 0; for (let cc = 0; cc < I.C; cc++) { const x = X.occC[cc * S + s]; if (x >= 0 && I.lt[x] === t && dans(x)) n++ }
    if (X.salle[t * S + s] - n >= I.cap[t]) {
      const cand = []; for (let cc = 0; cc < I.C; cc++) { const x = X.occC[cc * S + s]; if (x >= 0 && I.lt[x] === t && !dans(x)) cand.push(x) }
      if (cand.length) res.push(cand[(hasard() * cand.length) | 0])
    }
  }
  // maximum d'heures de cours par jour (classe)
  if (!I.perm[l]) {
    let n = X.jourC[c * D + d]
    for (const x of res) if (I.lc[x] === c && !I.perm[x] && ((X.pos[x] / P) | 0) === d) n--
    if (n >= I.maxJourC[c]) {
      const cand = []; for (let q = 0; q < P; q++) { const x = X.occC[c * S + debut + q]; if (x >= 0 && !I.perm[x] && !dans(x)) cand.push(x) }
      if (cand.length) res.push(cand[(hasard() * cand.length) | 0])
    }
  }
  if (e >= 0) {
    // maximum d'heures par jour (enseignant)
    let n = X.jourE[e * D + d]
    for (const x of res) if (I.le[x] === e && ((X.pos[x] / P) | 0) === d) n--
    if (n >= I.maxJourE[e]) {
      const cand = []; for (let q = 0; q < P; q++) { const x = X.occE[e * S + debut + q]; if (x >= 0 && !dans(x)) cand.push(x) }
      if (cand.length) res.push(cand[(hasard() * cand.length) | 0])
    }
    // heures consécutives de l'enseignant
    enchainement(I, (q) => { const x = X.occE[e * S + debut + q]; return x >= 0 && !dans(x) ? x : -1 }, d, p, I.maxConsE[e], res)
  }
  // heures consécutives d'une même matière dans la classe
  if (!I.perm[l]) {
    const disc = I.ld[l]
    enchainement(I, (q) => { const x = X.occC[c * S + debut + q]; return x >= 0 && !dans(x) && !I.perm[x] && I.ld[x] === disc ? x : -1 }, d, p, I.maxConsC[c], res)
  }
  return res
}
/** Suite de cours enchaînés autour de la période p : si elle dépasse le maximum, ajoute à res le ou les voisins à retirer. */
function enchainement(I, occupant, d, p, max, res) {
  const base = d * I.P
  let g = 0, gv = -1; for (let q = p - 1; q >= 0 && I.contigu[base + q]; q--) { const x = occupant(q); if (x < 0) break; if (gv < 0) gv = x; g++ }
  let r = 0, rv = -1; for (let q = p + 1; q < I.P && I.contigu[base + q - 1]; q++) { const x = occupant(q); if (x < 0) break; if (rv < 0) rv = x; r++ }
  if (g + r + 1 <= max) return
  if (g + 1 <= max) res.push(rv)
  else if (r + 1 <= max) res.push(gv)
  else { if (gv >= 0) res.push(gv); if (rv >= 0) res.push(rv) }
}

// --- Coût des contraintes souples ---------------------------------------------------------------------------------
/** Coût d'une journée d'une classe (heures creuses, répétitions, équilibre, matin, permanences). */
function coutClasseJour(I, X, c, d) {
  const { P, S, poids } = I, base = c * S + d * P
  let premier = -1, dernier = -1, charge = 0, tard = 0, permMal = 0, rep = 0
  const vus = new Map()
  for (let p = 0; p < P; p++) {
    const x = X.occC[base + p]
    if (x < 0) continue
    charge++; if (premier < 0) premier = p; dernier = p
    const s = d * P + p
    if (I.perm[x]) { if (!I.extremite[s]) permMal++; continue }
    if (!I.matinS[s] && I.matin[c].has(I.ld[x])) tard++
    const k = I.ld[x], prec = p > 0 && I.contigu[s - 1] ? X.occC[base + p - 1] : -1
    const suite = prec >= 0 && !I.perm[prec] && I.ld[prec] === k
    const v = vus.get(k)
    if (!v) vus.set(k, { blocs: 1, heures: 1 })
    else { v.heures++; if (!suite) v.blocs++ }
  }
  for (const v of vus.values()) rep += (v.blocs - 1) * 2 + Math.max(0, v.heures - 2)
  let trous = 0
  if (premier >= 0) for (let p = premier + 1; p < dernier; p++) if (X.occC[base + p] < 0 && I.ouvertS[d * P + p]) trous++
  const moy = I.chargeC[c] / I.D, ecart = charge - moy
  return poids.trous_classes * trous + poids.repetitions * rep + poids.equilibre * Math.round(ecart * ecart) + poids.matin * tard + poids.permanences * permMal
}
/** Coût d'une journée d'un enseignant (heures creuses, jour travaillé, jours préférés, disponibilités souhaitées). */
function coutEnsJour(I, X, e, d) {
  const { P, S, poids } = I, base = e * S + d * P
  let premier = -1, dernier = -1, n = 0, hors = 0
  for (let p = 0; p < P; p++) {
    if (X.occE[base + p] < 0) continue
    n++; if (premier < 0) premier = p; dernier = p
    if (!I.dispo[e][d * P + p]) hors++
  }
  if (!n) return 0
  let trous = 0
  for (let p = premier + 1; p < dernier; p++) if (X.occE[base + p] < 0 && I.ouvertS[d * P + p]) trous++
  return poids.trous_enseignants * trous + poids.fragmentation * 3 + (I.prefere[e][d] ? 0 : poids.preferences * n) + poids.disponibilites * hors * 5
}
/** Répartition d'une affectation : nombre de jours distincts attendu (au plus un bloc par jour). */
function coutAffectation(I, X, a, membres) {
  const jours = new Set(); for (const l of membres[a]) if (X.pos[l] >= 0) jours.add((X.pos[l] / I.P) | 0)
  const vol = I.volA[a], attendu = Math.min(I.D, Math.ceil(vol / 2), vol)
  return I.poids.repartition * Math.max(0, attendu - jours.size)
}
function coutTotal(I, X, membres) {
  let s = 0
  for (let c = 0; c < I.C; c++) for (let d = 0; d < I.D; d++) s += coutClasseJour(I, X, c, d)
  for (let e = 0; e < I.E; e++) for (let d = 0; d < I.D; d++) s += coutEnsJour(I, X, e, d)
  for (let a = 0; a < I.affs.length; a++) s += coutAffectation(I, X, a, membres)
  return s
}

// --- Résolution ----------------------------------------------------------------------------------------------------
/**
 * Génère un emploi du temps.
 * options : { graine, intensite (0,25 à 4 : durée de l'optimisation), progres(info), arret() -> booléen }
 * Renvoie { complet, grille, nonPlaces: [{ cours, raisons }], cout, criteres, iterations, duree }
 */
export function resoudre(cfg, options = {}) {
  const debutT = Date.now()
  const I = preparer(cfg)
  const hasard = aleatoire(options.graine ?? 1)
  const progres = options.progres || (() => {})
  const arret = options.arret || (() => false)
  const X = etatVide(I)
  const membres = I.affs.map(() => [])
  for (let l = 0; l < I.L; l++) if (I.la[l] >= 0) membres[I.la[l]].push(l)

  // 1. Placement (recherche itérative avec réparation)
  const impossibles = [], aPlacer = []
  for (let l = 0; l < I.L; l++) (I.domaine[l].length ? aPlacer : impossibles).push(l)
  // les plus contraints d'abord : peu de créneaux possibles, enseignant chargé
  const chargeE = new Int32Array(Math.max(1, I.E)); for (let l = 0; l < I.L; l++) if (I.le[l] >= 0) chargeE[I.le[l]]++
  const difficulte = (l) => I.domaine[l].length * 100 - (I.le[l] >= 0 ? chargeE[I.le[l]] : 0) - (I.lt[l] >= 0 ? 20 : 0)
  aPlacer.sort((a, b) => difficulte(a) - difficulte(b) || a - b)
  const retraits = new Int32Array(I.L), tabou = new Map()
  // file équitable : les cours retirés repartent en fin de file (un cours impossible ne monopolise pas la recherche) ;
  // le plus contraint est choisi parmi les premiers de la file
  const file = aPlacer.slice()
  let tete = 0
  const enAttente = { get length() { return file.length - tete } }
  const maxIter = Math.max(2000, Math.round(I.L * 80 * (options.intensite || 1)))
  let iter = 0, meilleurs = -1, meilleurePos = null
  while (file.length - tete && iter < maxIter && !arret()) {
    iter++
    let k = tete, kv = Infinity
    for (let i = tete; i < Math.min(file.length, tete + 8); i++) {
      const v = I.domaine[file[i]].length
      if (v < kv) { kv = v; k = i }
    }
    const l = file[k]; file[k] = file[tete]; tete++
    if (tete > 4096 && tete * 2 > file.length) { file.splice(0, tete); tete = 0 }
    let choix = -1, choixConf = null, choixV = Infinity, egaux = 0
    for (const s of I.domaine[l]) {
      const conf = conflits(I, X, l, s, hasard)
      if (conf.length && tabou.get(l * I.S + s) > iter) continue
      let v = 0; for (const x of conf) v += 1000 + retraits[x] * 50
      v += placementSouple(I, X, l, s)
      if (v < choixV) { choixV = v; choix = s; choixConf = conf; egaux = 1 }
      else if (v === choixV && hasard() * ++egaux < 1) { choix = s; choixConf = conf }
    }
    if (choix < 0) { file.push(l); continue }
    for (const x of choixConf) { tabou.set(x * I.S + X.pos[x], iter + 10 + ((hasard() * 10) | 0)); retirer(I, X, x); retraits[x]++; file.push(x) }
    poser(I, X, l, choix)
    const places = I.L - impossibles.length - enAttente.length
    if (places > meilleurs) { meilleurs = places; meilleurePos = X.pos.slice() }
    if (iter % 200 === 0) progres({ phase: "placement", fait: places, total: I.L - impossibles.length, iterations: iter })
  }
  if (meilleurePos && enAttente.length) {
    // reprise de la meilleure affectation partielle rencontrée
    for (let l = 0; l < I.L; l++) retirer(I, X, l)
    for (let l = 0; l < I.L; l++) if (meilleurePos[l] >= 0) poser(I, X, l, meilleurePos[l])
  }
  const nonPlaces = []
  for (let l = 0; l < I.L; l++) if (X.pos[l] < 0) nonPlaces.push(l)
  progres({ phase: "placement", fait: I.L - nonPlaces.length, total: I.L, iterations: iter })

  // 2. Optimisation des contraintes souples (seulement si tout est placé)
  let cout = coutTotal(I, X, membres), iterOpt = 0
  if (!nonPlaces.length && I.L > 1 && !arret()) {
    const N = Math.round(Math.min(3000000, Math.max(50000, I.L * 1000)) * (options.intensite || 1))
    let meilleur = cout, meilleurePos2 = X.pos.slice()
    const T0 = 20, T1 = 0.05
    for (let i = 0; i < N; i++) {
      if ((i & 4095) === 0) {
        if (arret()) break
        if (i % Math.max(1, Math.floor(N / 100)) < 4096) progres({ phase: "optimisation", fait: i, total: N, cout: meilleur })
      }
      const T = T0 * Math.pow(T1 / T0, i / N)
      const l = (hasard() * I.L) | 0, s1 = X.pos[l]
      const dom = I.domaine[l]; const s2 = dom[(hasard() * dom.length) | 0]
      if (s2 === s1) continue
      const c = I.lc[l], autre = X.occC[c * I.S + s2]
      const touche = zones(I, X, [l, autre], [s1, s2])
      const avant = coutZones(I, X, touche, membres)
      if (autre < 0) {
        retirer(I, X, l)
        if (conflits(I, X, l, s2, hasard).length) { poser(I, X, l, s1); continue }
        poser(I, X, l, s2)
      } else {
        if (!I.domaine[autre].includes(s1)) continue
        retirer(I, X, l); retirer(I, X, autre)
        if (conflits(I, X, l, s2, hasard).length) { poser(I, X, l, s1); poser(I, X, autre, s2); continue }
        poser(I, X, l, s2)
        if (conflits(I, X, autre, s1, hasard).length) { retirer(I, X, l); poser(I, X, l, s1); poser(I, X, autre, s2); continue }
        poser(I, X, autre, s1)
      }
      const delta = coutZones(I, X, touche, membres) - avant
      if (delta <= 0 || hasard() < Math.exp(-delta / T)) {
        cout += delta; iterOpt++
        if (cout < meilleur) { meilleur = cout; meilleurePos2 = X.pos.slice() }
      } else {
        // annulation du mouvement
        if (autre < 0) { retirer(I, X, l); poser(I, X, l, s1) }
        else { retirer(I, X, l); retirer(I, X, autre); poser(I, X, l, s1); poser(I, X, autre, s2) }
      }
    }
    for (let l = 0; l < I.L; l++) retirer(I, X, l)
    for (let l = 0; l < I.L; l++) poser(I, X, l, meilleurePos2[l])
    cout = coutTotal(I, X, membres)
    progres({ phase: "optimisation", fait: N, total: N, cout })
  }
  const grille = versGrille(I, X)
  return {
    complet: !nonPlaces.length, grille, cout, criteres: criteres(cfg, grille),
    nonPlaces: diagnostiquer(I, X, nonPlaces, hasard),
    iterations: iter + iterOpt, duree: Date.now() - debutT,
  }
}

/** Préférence légère pendant le placement : éviter de répéter la matière dans la journée et de surcharger un jour. */
function placementSouple(I, X, l, s) {
  const c = I.lc[l], d = (s / I.P) | 0, base = c * I.S + d * I.P
  let v = X.jourC[c * I.D + d]
  if (!I.perm[l]) for (let p = 0; p < I.P; p++) { const x = X.occC[base + p]; if (x >= 0 && I.ld[x] === I.ld[l]) v += 6 }
  return v
}
/** Parties du coût touchées par le déplacement de cours (journées de classes et d'enseignants, affectations). */
function zones(I, X, ls, ss) {
  const cj = new Set(), ej = new Set(), af = new Set()
  for (const l of ls) {
    if (l < 0) continue
    for (const s of ss) { const d = (s / I.P) | 0; cj.add(I.lc[l] * I.D + d); if (I.le[l] >= 0) ej.add(I.le[l] * I.D + d) }
    if (I.la[l] >= 0) af.add(I.la[l])
  }
  return { cj, ej, af }
}
function coutZones(I, X, z, membres) {
  let s = 0
  for (const k of z.cj) s += coutClasseJour(I, X, (k / I.D) | 0, k % I.D)
  for (const k of z.ej) s += coutEnsJour(I, X, (k / I.D) | 0, k % I.D)
  for (const a of z.af) s += coutAffectation(I, X, a, membres)
  return s
}

/** Grille de résultat, avec attribution des salles spécialisées (salles d'un même type interchangeables). */
function versGrille(I, X) {
  const { cfg, jours, P } = I
  const sallesParType = I.types.map((x) => cfg.salles.filter((s) => s.type === x).sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true })))
  const prises = new Map()
  const res = []
  const ordre = [...Array(I.L).keys()].filter((l) => X.pos[l] >= 0).sort((a, b) => X.pos[a] - X.pos[b] || I.lc[a] - I.lc[b])
  for (const l of ordre) {
    const s = X.pos[l], d = (s / P) | 0, p = s % P, cours = I.cours[l]
    let salle = null
    if (I.lt[l] >= 0) {
      const k = `${I.lt[l]}:${s}`, n = prises.get(k) || 0
      salle = sallesParType[I.lt[l]][n]?.id ?? null; prises.set(k, n + 1)
    }
    res.push({ c: cours.cls, j: jours[d], p, a: cours.a, s: salle })
  }
  return res
}

/** Raisons pour lesquelles des cours n'ont pas pu être placés, et pistes (sans jamais assouplir une contrainte obligatoire). */
function diagnostiquer(I, X, nonPlaces, hasard) {
  return nonPlaces.map((l) => {
    const cours = I.cours[l], compte = {}
    const ajoute = (k) => { compte[k] = (compte[k] || 0) + 1 }
    if (I.lt[l] === -2) ajoute("salle_absente")
    if (!I.domaine[l].length && I.lt[l] !== -2) ajoute("aucun_creneau")
    for (const s of I.domaine[l]) {
      const c = I.lc[l], e = I.le[l], d = (s / I.P) | 0
      if (X.occC[c * I.S + s] >= 0) ajoute("classe_occupee")
      if (e >= 0 && X.occE[e * I.S + s] >= 0) ajoute("enseignant_occupe")
      if (I.lt[l] >= 0 && X.salle[I.lt[l] * I.S + s] >= I.cap[I.lt[l]]) ajoute("salle_occupee")
      if (!I.perm[l] && X.jourC[c * I.D + d] >= I.maxJourC[c]) ajoute("classe_max_jour")
      if (e >= 0 && X.jourE[e * I.D + d] >= I.maxJourE[e]) ajoute("enseignant_max_jour")
      if (!conflits(I, X, l, s, hasard).length) ajoute("libre")
    }
    return { cours, creneaux: I.domaine[l].length, raisons: compte }
  })
}

// --- Vérification (contraintes obligatoires) et évaluation (contraintes souples) d'une grille ----------------------
/**
 * Contrôle complet d'une grille : liste des violations des contraintes obligatoires (vide si l'emploi du temps est valide).
 * Mêmes règles que la vérification du serveur avant enregistrement.
 */
export function verifierGrille(cfg, grille) {
  const v = []
  const sem = semaine(cfg.horaires), P = sem.P
  const affs = new Map(cfg.affectations.map((a) => [a.id, a]))
  const ens = new Map(cfg.enseignants.map((e) => [e.cle, e]))
  const salles = new Map(cfg.salles.map((s) => [s.id, s]))
  const strict = cfg.generales.enseignant.disponibilites !== "preferences"
  const parClasse = new Map(), parEns = new Map(), parSalle = new Map(), volumes = new Map(), perms = new Map()
  for (const g of grille) {
    const d = sem.jours.indexOf(g.j)
    if (d < 0 || !(g.p >= 0 && g.p < P) || !sem.ouvert[d][g.p]) { v.push(t("Cours placé sur un créneau fermé ({v0}).", { v0: `${g.j}-${g.p}` })); continue }
    if ((cfg.classes?.[g.c]?.interdits || []).includes(`${g.j}-${g.p}`)) v.push(t("Cours placé sur un créneau interdit à la classe."))
    const k = `${g.c}|${g.j}|${g.p}`
    if (parClasse.has(k)) v.push(t("Deux cours en même temps dans une classe."))
    parClasse.set(k, g)
    if (g.a === null || g.a === undefined) {
      perms.set(g.c, (perms.get(g.c) || 0) + 1)
      if (!permanencePossible(cfg, g.c, g.j, g.p)) v.push(t("Permanence placée hors de sa plage autorisée."))
      continue
    }
    const a = affs.get(g.a)
    if (!a) { v.push(t("Cours sans affectation connue.")); continue }
    if (a.classe_id !== g.c) v.push(t("Cours placé dans une autre classe que celle de son affectation."))
    volumes.set(a.id, (volumes.get(a.id) || 0) + 1)
    const e = ens.get(a.enseignant)
    const ke = `${a.enseignant}|${g.j}|${g.p}`
    if (parEns.has(ke)) v.push(t("Un enseignant a deux cours en même temps."))
    parEns.set(ke, g)
    if (strict && e && !disponible(cfg, e, g.j, g.p)) v.push(t("Cours placé hors des disponibilités d'un enseignant."))
    const type = cfg.classes?.[a.classe_id]?.salles?.[a.discipline] || ""
    if (type) {
      const s = salles.get(g.s)
      if (!s || s.type !== type) v.push(t("Cours sans la salle spécialisée exigée."))
    }
    if (g.s) {
      const ks = `${g.s}|${g.j}|${g.p}`
      if (parSalle.has(ks)) v.push(t("Une salle est occupée par deux cours en même temps."))
      parSalle.set(ks, g)
    }
  }
  for (const a of cfg.affectations) if ((volumes.get(a.id) || 0) !== Number(a.volume)) v.push(t("Volume horaire non respecté pour une affectation."))
  for (const c of classesDe(cfg)) if ((perms.get(c.id) || 0) !== (Number(cfg.classes?.[c.id]?.permanences?.heures) || 0)) v.push(t("Nombre d'heures de permanence non respecté."))
  // maximums par jour et heures consécutives
  for (const c of classesDe(cfg)) {
    const max = reglageClasse(cfg, c.id, "max_jour") || P, maxCons = reglageClasse(cfg, c.id, "max_consecutives") || P
    sem.jours.forEach((j, d) => {
      const jour = [...Array(P).keys()].map((p) => parClasse.get(`${c.id}|${j}|${p}`))
      if (jour.filter((g) => g && g.a).length > max) v.push(t("Trop d'heures de cours dans la journée pour une classe."))
      let n = 0
      for (let p = 0; p < P; p++) {
        const g = jour[p], prec = p > 0 && sem.contigu[d][p - 1] ? jour[p - 1] : null
        const disc = g?.a ? affs.get(g.a)?.discipline : null
        n = disc && prec?.a && affs.get(prec.a)?.discipline === disc ? n + 1 : disc ? 1 : 0
        if (n > maxCons) { v.push(t("Trop d'heures consécutives d'une même matière dans une classe.")); break }
      }
    })
  }
  for (const e of cfg.enseignants) {
    const max = reglageEnseignant(cfg, e, "max_jour") || P, maxCons = reglageEnseignant(cfg, e, "max_consecutives") || P
    sem.jours.forEach((j, d) => {
      let total = 0, n = 0
      for (let p = 0; p < P; p++) {
        const occ = parEns.has(`${e.cle}|${j}|${p}`)
        if (occ) total++
        n = occ ? (p > 0 && sem.contigu[d][p - 1] && parEns.has(`${e.cle}|${j}|${p - 1}`) ? n + 1 : 1) : 0
        if (n > maxCons) { v.push(t("Trop d'heures consécutives pour un enseignant.")); n = -1e9 }
      }
      if (total > max) v.push(t("Trop d'heures dans la journée pour un enseignant."))
    })
  }
  return [...new Map(v.map((x) => [x.k + JSON.stringify(x.v || {}), x])).values()]
}

/** Mesures de qualité d'une grille (contraintes souples), pour le bilan et la comparaison des variantes. */
export function criteres(cfg, grille) {
  const sem = semaine(cfg.horaires), P = sem.P
  const affs = new Map(cfg.affectations.map((a) => [a.id, a]))
  const parClasse = new Map(), parEns = new Map()
  for (const g of grille) {
    parClasse.set(`${g.c}|${g.j}|${g.p}`, g)
    if (g.a && affs.get(g.a)) parEns.set(`${affs.get(g.a).enseignant}|${g.j}|${g.p}`, g)
  }
  const trous = (occ) => { let n = 0; sem.jours.forEach((j, d) => { const o = [...Array(P).keys()].filter((p) => occ(j, p)); if (o.length) for (let p = o[0] + 1; p < o[o.length - 1]; p++) if (!occ(j, p) && sem.ouvert[d][p]) n++ }); return n }
  let trousClasses = 0, repetitions = 0, joursEns = 0, trousEns = 0, tard = 0
  for (const c of classesDe(cfg)) {
    trousClasses += trous((j, p) => parClasse.has(`${c.id}|${j}|${p}`))
    const matin = new Set(cfg.classes?.[c.id]?.matin || [])
    sem.jours.forEach((j, d) => {
      const vus = new Map()
      for (let p = 0; p < P; p++) {
        const g = parClasse.get(`${c.id}|${j}|${p}`); if (!g?.a) continue
        const disc = affs.get(g.a)?.discipline
        if (matin.has(disc) && !sem.matin[d][p]) tard++
        const prec = p > 0 && sem.contigu[d][p - 1] ? parClasse.get(`${c.id}|${j}|${p - 1}`) : null
        const suite = prec?.a && affs.get(prec.a)?.discipline === disc
        vus.set(disc, (vus.get(disc) || 0) + (suite ? 0 : 1))
      }
      for (const n of vus.values()) repetitions += n - 1
    })
  }
  for (const e of cfg.enseignants) {
    const occ = (j, p) => parEns.has(`${e.cle}|${j}|${p}`)
    trousEns += trous(occ)
    joursEns += sem.jours.filter((j) => [...Array(P).keys()].some((p) => occ(j, p))).length
  }
  return { trousClasses, trousEnseignants: trousEns, repetitions, joursEnseignants: joursEns, matiereApresMidi: tard, cours: grille.length }
}
