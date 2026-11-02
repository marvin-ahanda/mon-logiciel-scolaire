"""Import et export Excel."""

from collections import Counter
from datetime import timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_date

from comptes.roles import est_administration, est_enseignant, peut_encaisser, role_requis
from finances.models import Paiement, Rubrique
from finances.services import paiements_periode, situation_classe
from notes.models import Note
from notes.services import (attributions_saisissables, inscriptions_classe, periode_depuis_code, periodes_exercice,
                            peut_saisir, resultats_periode)
from notes.views import _peut_consulter_classe
from scolarite.models import Attribution, Classe, Eleve, Exercice, Inscription, Sequence

from .excel import ErreurFichier, classeur, en_date, en_note, lire, normaliser, reponse_xlsx, texte

SEXES = {"m": "M", "masculin": "M", "garcon": "M", "f": "F", "feminin": "F", "fille": "F"}
STATUTS = {"a": "A", "ancien": "A", "ancieneleve": "A", "n": "N", "nouveau": "N", "nouveleleve": "N", "": "N"}
COLONNES_ELEVES = {
    "matricule": ["Matricule"], "nom": ["Nom"], "prenom": ["Prénom", "Prenom"], "sexe": ["Sexe"],
    "date_naissance": ["Date de naissance", "Né le", "Ne le"], "lieu_naissance": ["Lieu de naissance"],
    "nom_pere": ["Nom du père", "Père", "Pere"], "nom_mere": ["Nom de la mère", "Mère", "Mere"],
    "telephone_parent": ["Téléphone du parent", "Téléphone", "Telephone"], "classe": ["Classe"],
    "statut": ["Statut", "Statut dans l'établissement"],
}
ENTETES_ELEVES = ["Matricule", "Nom", "Prénom", "Sexe", "Date de naissance", "Lieu de naissance", "Nom du père",
                  "Nom de la mère", "Téléphone du parent", "Classe", "Statut"]
SESSION_ELEVES, SESSION_NOTES = "import_eleves", "import_notes"


def _exercice(request):
    ex = Exercice.actif_courant()
    if not ex:
        messages.error(request, "Aucun exercice actif.")
    return ex


@login_required
def accueil(request):
    if not (est_administration(request.user) or est_enseignant(request.user) or peut_encaisser(request.user)):
        messages.error(request, "Vous n'avez pas les droits nécessaires pour cette page.")
        return redirect("accueil")
    ex = Exercice.actif_courant()
    return render(request, "echanges/accueil.html", {
        "classes": Classe.objects.all(), "rubriques": Rubrique.objects.all(), "modes": Paiement.MODES,
        "attributions": attributions_saisissables(request.user, ex).order_by("classe__libelle", "matiere__libelle") if ex else [],
        "sequences": ex.sequences.all() if ex else [], "periodes": periodes_exercice(ex) if ex else [],
        "peut_encaisser": peut_encaisser(request.user),
        "aujourd_hui": timezone.localdate(), "il_y_a_7_jours": timezone.localdate() - timedelta(days=6),
    })


# --- Exports ----------------------------------------------------------------------------------------

@role_requis(est_administration)
def export_eleves(request):
    ex = Exercice.actif_courant()
    qs = Inscription.objects.filter(exercice=ex).select_related("eleve", "classe").order_by("classe__libelle", "eleve__nom", "eleve__prenom")
    if request.GET.get("classe"):
        qs = qs.filter(classe_id=request.GET["classe"])
    lignes = [[i.eleve.matricule, i.eleve.nom, i.eleve.prenom, i.eleve.sexe, i.eleve.date_naissance, i.eleve.lieu_naissance,
               i.eleve.nom_pere, i.eleve.nom_mere, i.eleve.telephone_parent, i.classe.libelle, i.get_statut_display()] for i in qs]
    return reponse_xlsx(classeur([("Élèves", ENTETES_ELEVES, lignes)]), "eleves")


@login_required
def export_resultats(request):
    ex = Exercice.actif_courant()
    classe = get_object_or_404(Classe, pk=request.GET.get("classe"))
    periode = periode_depuis_code(ex, request.GET.get("periode", "")) if ex else None
    if periode is None:
        raise Http404("Période inconnue.")
    if not _peut_consulter_classe(request.user, classe, ex):
        raise PermissionDenied
    resultats, stats, attributions, _ = resultats_periode(classe, ex, periode)
    resultats = sorted(resultats, key=lambda r: (r.rang is None, r.rang or 0, str(r.eleve)))
    entetes = ["Rang", "Matricule", "Élève"] + [f"{a.matiere.code} (coef. {a.coefficient})" for a in attributions] + \
              ["Total coef.", "Total points", "Moyenne", "Appréciation", "Distinctions"]
    lignes = [[(f"{r.rang} ex" if r.ex_aequo else r.rang) if r.rang else "NC", r.eleve.matricule, str(r.eleve)]
              + [l.note for l in r.lignes]
              + [r.total_coefficients, r.total_points, r.moyenne, r.appreciation, ", ".join(r.distinctions)] for r in resultats]
    lignes += [[], ["", "", "Moyenne de la classe", *[""] * len(attributions), "", "", stats.moyenne_classe],
               ["", "", "Taux de réussite (%)", *[""] * len(attributions), "", "", stats.taux_reussite]]
    return reponse_xlsx(classeur([(f"{classe.libelle} {periode.libelle}", entetes, lignes)]), f"resultats-{classe.libelle}-{periode.code}")


@role_requis(peut_encaisser)
def export_situation(request):
    ex = Exercice.actif_courant()
    classe = get_object_or_404(Classe, pk=request.GET.get("classe"))
    rubrique = get_object_or_404(Rubrique, pk=request.GET["rubrique"]) if request.GET.get("rubrique") else None
    filtre = request.GET.get("filtre", "tous")
    lignes, totaux = situation_classe(classe, ex, rubrique, filtre)
    donnees = [[l["ins"].eleve.matricule, str(l["ins"].eleve), l["ins"].eleve.telephone_parent, l["du"], l["verse"], l["reste"]] for l in lignes]
    donnees.append(["", "TOTAL", "", totaux["du"], totaux["verse"], totaux["reste"]])
    titre = f"{classe.libelle} {rubrique or 'toutes rubriques'}"
    return reponse_xlsx(classeur([(titre, ["Matricule", "Élève", "Téléphone parent", "Dû (F)", "Versé (F)", "Reste (F)"], donnees)]),
                        f"situation-{classe.libelle}-{filtre}")


@role_requis(peut_encaisser)
def export_journal(request):
    ex = Exercice.actif_courant()
    aujourd_hui = timezone.localdate()
    debut = parse_date(request.GET.get("debut") or "") or aujourd_hui - timedelta(days=6)
    fin = parse_date(request.GET.get("fin") or "") or aujourd_hui
    qs, total, par_mode = paiements_periode(ex, debut, fin, request.GET.get("mode", ""))
    lignes = [[p.date, p.numero_recu, str(p.inscription.eleve), p.inscription.classe.libelle, str(p.rubrique), p.get_mode_display(),
               p.reference, p.saisi_par.username if p.saisi_par else "", p.montant, "ANNULÉ : " + p.motif_annulation if p.annule else ""]
              for p in qs]
    resume = [[lib, n, t] for lib, n, t in par_mode] + [["Total encaissé", "", total]]
    return reponse_xlsx(classeur([
        ("Encaissements", ["Date", "Reçu", "Élève", "Classe", "Rubrique", "Mode", "Référence", "Caissier", "Montant (F)", "Annulation"], lignes),
        ("Totaux par mode", ["Mode", "Nombre", "Montant (F)"], resume),
    ]), f"journal-{debut:%Y%m%d}-{fin:%Y%m%d}")


# --- Import des élèves ------------------------------------------------------------------------------

@role_requis(est_administration)
def modele_eleves(request):
    classes = ", ".join(Classe.objects.values_list("libelle", flat=True)) or "(aucune classe créée)"
    exemple = [["2025-0001", "NGONO", "Marie", "F", "14/02/2013", "Yaoundé", "NGONO Paul", "ABENA Rose", "+237 600 000 000",
                Classe.objects.values_list("libelle", flat=True).first() or "6e A", "Nouveau"]]
    notes = ["Une ligne par élève. Colonnes obligatoires : Matricule, Nom, Sexe (M ou F), Classe.",
             f"Classe : exactement l'une des classes existantes : {classes}.",
             "Date de naissance : jj/mm/aaaa (ou cellule au format date). Statut : « Ancien » ou « Nouveau » (Nouveau par défaut).",
             "Si le matricule existe déjà, la fiche de l'élève est mise à jour ; sinon l'élève est créé.",
             "Supprimez la ligne d'exemple avant l'import. Un aperçu est affiché avant tout enregistrement."]
    return reponse_xlsx(classeur([("Élèves", ENTETES_ELEVES, exemple, notes)]), "modele-import-eleves")


def _analyser_eleves(lignes, exercice):
    classes = {c.libelle.strip().lower(): c for c in Classe.objects.all()}
    existants = {e.matricule: e for e in Eleve.objects.filter(matricule__in=[texte(v.get("matricule"), 30) for _, v in lignes])}
    inscriptions = {i.eleve_id: i for i in Inscription.objects.filter(exercice=exercice, eleve__in=existants.values())}
    vus, apercu, erreurs = Counter(), [], 0
    effectifs = Counter(Inscription.objects.filter(exercice=exercice).values_list("classe_id", flat=True))
    for n, v in lignes:
        pb, d = [], {}
        d["matricule"] = texte(v.get("matricule"), 30)
        d["nom"] = texte(v.get("nom"), 100)
        d["prenom"] = texte(v.get("prenom"), 100)
        for cle in ("lieu_naissance", "telephone_parent"):
            d[cle] = texte(v.get(cle), 100 if cle == "lieu_naissance" else 50)
        for cle in ("nom_pere", "nom_mere"):
            d[cle] = texte(v.get(cle), 150)
        if not d["matricule"]:
            pb.append("matricule manquant")
        elif vus[d["matricule"]]:
            pb.append("matricule en double dans le fichier")
        vus[d["matricule"]] += 1
        if not d["nom"]:
            pb.append("nom manquant")
        d["sexe"] = SEXES.get(normaliser(v.get("sexe")))
        if not d["sexe"]:
            pb.append("sexe attendu : M ou F")
        statut = STATUTS.get(normaliser(v.get("statut")))
        if statut is None:
            pb.append("statut attendu : Ancien ou Nouveau")
        d["statut"] = statut or "N"
        try:
            dn = en_date(v.get("date_naissance"))
            d["date_naissance"] = dn.isoformat() if dn else None
        except ValueError as e:
            pb.append(str(e))
        classe = classes.get(texte(v.get("classe")).lower())
        if not classe:
            pb.append(f"classe « {texte(v.get('classe'))} » inconnue")
        d["classe_id"] = classe.id if classe else None
        eleve = existants.get(d["matricule"])
        ins = inscriptions.get(eleve.id) if eleve else None
        if classe and ins and ins.classe_id != classe.id and ins.notes.exists():
            pb.append("l'élève a déjà des notes dans une autre classe : changement de classe impossible")
        if classe and not (ins and ins.classe_id == classe.id):
            effectifs[classe.id] += 1
            if ins:
                effectifs[ins.classe_id] -= 1
            if classe.effectif_max and effectifs[classe.id] > classe.effectif_max:
                pb.append(f"effectif maximal de la {classe.libelle} dépassé ({classe.effectif_max})")
        erreurs += bool(pb)
        dn_aff = d.get("date_naissance")
        apercu.append({"ligne": n, "donnees": d, "action": "Mise à jour" if eleve else "Création",
                       "classe": classe.libelle if classe else "", "erreurs": pb,
                       "date_affichee": "/".join(reversed(dn_aff.split("-"))) if dn_aff else ""})
    return apercu, erreurs


@role_requis(est_administration)
def import_eleves(request):
    exercice = _exercice(request)
    if not exercice:
        return redirect("accueil")
    if request.method == "POST" and request.POST.get("action") == "confirmer":
        apercu = request.session.get(SESSION_ELEVES)
        if not apercu or any(l["erreurs"] for l in apercu):
            messages.error(request, "Aucun import valide à confirmer : recommencez l'envoi du fichier.")
            return redirect("import_eleves")
        crees = maj = 0
        with transaction.atomic():
            for l in apercu:
                d = dict(l["donnees"])
                classe_id, statut = d.pop("classe_id"), d.pop("statut")
                eleve, cree = Eleve.objects.update_or_create(matricule=d.pop("matricule"), defaults=d)
                Inscription.objects.update_or_create(eleve=eleve, exercice=exercice, defaults={"classe_id": classe_id, "statut": statut})
                crees += cree
                maj += not cree
        del request.session[SESSION_ELEVES]
        messages.success(request, f"Import terminé : {crees} élève(s) créé(s), {maj} mis à jour.")
        return redirect("eleves")
    ctx = {}
    if request.method == "POST" and request.FILES.get("fichier"):
        try:
            lignes, presentes = lire(request.FILES["fichier"], COLONNES_ELEVES)
            manquantes = [c for c in ("matricule", "nom", "sexe", "classe") if c not in presentes]
            if manquantes:
                raise ErreurFichier("Colonnes obligatoires absentes : " + ", ".join(manquantes) + ". Utilisez le modèle fourni.")
            if not lignes:
                raise ErreurFichier("Aucune ligne d'élève dans le fichier.")
            apercu, erreurs = _analyser_eleves(lignes, exercice)
            request.session[SESSION_ELEVES] = apercu
            ctx.update(apercu=apercu, erreurs=erreurs, nom_fichier=request.FILES["fichier"].name)
        except ErreurFichier as e:
            messages.error(request, str(e))
    return render(request, "echanges/import_eleves.html", ctx)


# --- Import des notes -------------------------------------------------------------------------------

def _attribution_sequence(request, exercice):
    a = get_object_or_404(Attribution, pk=request.GET.get("attribution"), exercice=exercice)
    s = get_object_or_404(Sequence, pk=request.GET.get("sequence"), exercice=exercice)
    if not peut_saisir(request.user, a):
        raise PermissionDenied("Vous n'enseignez pas cette matière dans cette classe.")
    return a, s


@login_required
def modele_notes(request):
    ex = Exercice.actif_courant()
    a, s = _attribution_sequence(request, ex)
    notes = {n.inscription_id: n.valeur for n in Note.objects.filter(attribution=a, sequence=s)}
    lignes = [[i.eleve.matricule, str(i.eleve), notes.get(i.id)] for i in inscriptions_classe(a.classe, ex)]
    aide = [f"Classe {a.classe} — {a.matiere} (coef. {a.coefficient}) — {s.libelle}.",
            "Saisissez la note sur 20 dans la colonne « Note » (virgule ou point acceptés).",
            "Une case vide laisse la note inchangée (l'import ne supprime jamais de note).",
            "Ne modifiez pas la colonne Matricule : c'est elle qui identifie l'élève."]
    return reponse_xlsx(classeur([("Notes", ["Matricule", "Élève", "Note"], lignes, aide)]),
                        f"notes-{a.classe.libelle}-{a.matiere.code}-seq{s.numero}")


@login_required
def import_notes(request):
    ex = _exercice(request)
    if not ex:
        return redirect("accueil")
    a, s = _attribution_sequence(request, ex)
    cle_session = f"{SESSION_NOTES}_{a.pk}_{s.pk}"
    retour = f"{reverse('import_notes')}?attribution={a.pk}&sequence={s.pk}"
    if s.verrouillee and request.method == "POST":
        messages.error(request, "Opération refusée. La séquence spécifiée est fermée.")
        return redirect(retour)
    inscriptions = {i.eleve.matricule: i for i in inscriptions_classe(a.classe, ex)}
    if request.method == "POST" and request.POST.get("action") == "confirmer":
        apercu = request.session.get(cle_session)
        if not apercu or any(l["erreurs"] for l in apercu):
            messages.error(request, "Aucun import valide à confirmer : recommencez l'envoi du fichier.")
            return redirect(retour)
        n = 0
        with transaction.atomic():
            for l in apercu:
                if l["nouvelle"] is None or l["nouvelle"] == l["actuelle"]:
                    continue
                ins = inscriptions[l["matricule"]]
                Note.objects.update_or_create(inscription=ins, attribution=a, sequence=s,
                                              defaults={"valeur": l["nouvelle"], "saisie_par": request.user})
                n += 1
        del request.session[cle_session]
        messages.success(request, f"Import terminé : {n} note(s) enregistrée(s).")
        return redirect(f"{reverse('saisie')}?attribution={a.pk}&sequence={s.pk}")
    ctx = {"attribution": a, "sequence": s}
    if request.method == "POST" and request.FILES.get("fichier"):
        try:
            lignes, presentes = lire(request.FILES["fichier"], {"matricule": ["Matricule"], "note": ["Note", "Note /20", "Note sur 20"]})
            if not {"matricule", "note"} <= presentes:
                raise ErreurFichier("Colonnes « Matricule » et « Note » obligatoires. Utilisez le modèle fourni.")
            actuelles = {n.inscription_id: n.valeur for n in Note.objects.filter(attribution=a, sequence=s)}
            vus, apercu = Counter(), []
            for num, v in lignes:
                m, pb, nouvelle = texte(v.get("matricule"), 30), [], None
                ins = inscriptions.get(m)
                if not ins:
                    pb.append("matricule inconnu dans cette classe")
                elif vus[m]:
                    pb.append("matricule en double dans le fichier")
                vus[m] += 1
                try:
                    nouvelle = en_note(v.get("note"))
                except ValueError as e:
                    pb.append(str(e))
                actuelle = actuelles.get(ins.id) if ins else None
                apercu.append({"ligne": num, "matricule": m, "eleve": str(ins.eleve) if ins else "",
                               "actuelle": str(actuelle) if actuelle is not None else None,
                               "nouvelle": str(nouvelle) if nouvelle is not None else None, "erreurs": pb})
            request.session[cle_session] = apercu
            ctx.update(apercu=apercu, erreurs=sum(bool(l["erreurs"]) for l in apercu),
                       changements=sum(1 for l in apercu if l["nouvelle"] is not None and l["nouvelle"] != l["actuelle"] and not l["erreurs"]))
        except ErreurFichier as e:
            messages.error(request, str(e))
    return render(request, "echanges/import_notes.html", ctx)
