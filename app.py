from flask import Flask, jsonify, render_template, request, flash, redirect, url_for, send_file, session
from werkzeug.utils import secure_filename
from pathlib import Path
from generate_plaque.function_pcr import (
    read_excel_file,
    generate_plaque_in_template,
    prepare_plates_data,
    prepare_plates_data_grouped,
    generate_plaque_from_layout,
)
import os, re, json, unicodedata, pickle
import pandas as pd
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
ALLOWED_EXT = {".xls", ".xlsx"}

# Dossiers et registre de templates
APP_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = APP_DIR / "template_pcr"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR = APP_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)
REG_PATH = TEMPLATE_DIR / "templates.json"

# --- Utilitaires ---
def load_registry() -> dict:
    if REG_PATH.exists():
        with REG_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    return {}

def save_registry(d: dict) -> None:
    tmp = REG_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
    tmp.replace(REG_PATH)

def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_").lower()
    return value or "template"

def unique_path(dirpath: Path, base: str, ext: str) -> Path:
    p = dirpath / f"{base}{ext}"
    i = 1
    while p.exists():
        p = dirpath / f"{base}_{i}{ext}"
        i += 1
    return p

def valid_excel_cell(addr: str) -> bool:
    s = (addr or "").upper().strip()
    m = re.fullmatch(r"([A-Z]{1,3})([1-9]\d{0,6})", s)
    if not m:
        return False
    col, row = m.groups()
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n <= 16384 and int(row) <= 1048576

# --- Routes ---
@app.get("/healthz")
def healthz():
    return jsonify(status="ok"), 200

@app.get("/")
def index():
    return render_template("index.html", templates=load_registry())

@app.post("/upload_template")
def upload_template():
    file = request.files.get("template_file")
    name = (request.form.get("name") or "").strip()
    position = (request.form.get("position") or "").strip().upper()

    if not name:
        flash("Nom du template manquant.")
        return redirect(url_for("index"))
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))
    if file is None or file.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    key = slugify(name)
    out_path = unique_path(TEMPLATE_DIR, key, ext)
    try:
        file.save(out_path)
    except Exception as e:
        flash(f"Échec de l'enregistrement du template : {e}")
        return redirect(url_for("index"))

    reg = load_registry()
    reg[key] = {"filename": out_path.name, "position": position}
    save_registry(reg)

    flash(f"Template « {name} » enregistré (position {position}).")
    return redirect(url_for("index"))


@app.post("/upload")
def upload():
    """Ancienne route : génère directement sans passer par l'interface interactive."""
    f = request.files.get("excel_file")
    choice = request.form.get("group_primers") == "on"
    if f is None or f.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    template_key = (request.form.get("template_key") or "").strip()
    if not template_key:
        flash("Aucun template sélectionné.")
        return redirect(url_for("index"))

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        flash("Template inconnu.")
        return redirect(url_for("index"))

    template_path = TEMPLATE_DIR / info["filename"]
    position = (request.form.get("position") or info.get("position") or "H5").strip().upper()
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))

    try:
        df = read_excel_file(f)
    except Exception as e:
        flash(f"Erreur de lecture de l'Excel : {e}")
        return redirect(url_for("index"))

    try:
        xlsx_buf = generate_plaque_in_template(df, str(template_path), position=position, choice=choice)
    except Exception as e:
        flash(f"Erreur de génération du template : {e}")
        return redirect(url_for("index"))

    info["position"] = position
    reg[template_key] = info
    save_registry(reg)

    base = Path(secure_filename(f.filename or "plaque")).stem
    download_name = f"{base}_plaque_PCR.xlsx"
    return send_file(
        xlsx_buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# Nouvelle route : interface interactive d'arrangement des plaques
# ---------------------------------------------------------------------------

@app.post("/arrange")
def arrange():
    """
    Lit le fichier Excel, calcule le placement initial des échantillons,
    et affiche l'interface de visualisation / drag & drop.
    """
    f = request.files.get("excel_file")
    if f is None or f.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    template_key = (request.form.get("template_key") or "").strip()
    if not template_key:
        flash("Aucun template sélectionné.")
        return redirect(url_for("index"))

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        flash("Template inconnu.")
        return redirect(url_for("index"))

    position = (request.form.get("position") or info.get("position") or "H5").strip().upper()
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))

    sort_similarity = request.form.get("sort_similarity") == "on"
    group_dilutions = request.form.get("group_primers") == "on"

    try:
        df = read_excel_file(f)
    except Exception as e:
        flash(f"Erreur de lecture de l'Excel : {e}")
        return redirect(url_for("index"))

    try:
        layout = prepare_plates_data(
            df,
            sort_by_similarity=sort_similarity,
            group_dilutions=group_dilutions,
        )
    except Exception as e:
        flash(f"Erreur de préparation des plaques : {e}")
        return redirect(url_for("index"))

    # Mémoriser les métadonnées en session pour l'export
    session_id = session.get("_id") or os.urandom(16).hex()
    session["_id"] = session_id
    session["template_key"] = template_key
    session["position"] = position
    session["original_filename"] = secure_filename(f.filename or "plaque")
    session["sort_similarity"] = sort_similarity
    session["group_dilutions"] = group_dilutions

    # Sauvegarder le DataFrame pour /regroup
    pkl_path = TMP_DIR / f"{session_id}.pkl"
    with pkl_path.open("wb") as fh:
        pickle.dump(df, fh)

    # Liste des demandes uniques pour le panneau de groupement
    demandes = sorted(df["Demande"].dropna().unique().tolist()) if "Demande" in df.columns else []

    # Fichier LV optionnel : demande → nom client
    demande_clients: dict = {}
    lv_file = request.files.get("lv_file")
    if lv_file and lv_file.filename:
        try:
            df_lv = pd.read_excel(lv_file)
            if "Demande" in df_lv.columns and "Nom Demandeur" in df_lv.columns:
                demande_clients = {
                    str(row["Demande"]).strip(): str(row["Nom Demandeur"]).strip()
                    for _, row in df_lv.iterrows()
                    if pd.notna(row["Demande"]) and pd.notna(row["Nom Demandeur"])
                }
        except Exception:
            pass  # Fichier LV invalide : on ignore silencieusement

    return render_template(
        "arrange.html",
        layout=layout,
        layout_json=json.dumps(layout),
        template_key=template_key,
        position=position,
        templates=reg,
        demandes=demandes,
        demande_clients=demande_clients,
    )


@app.post("/regroup")
def regroup():
    """
    Reçoit les groupes de demandes et recalcule le layout groupé.
    Body JSON: {
      "groups": {"Groupe A": ["260203-00052", ...], ...},
      "sort_by_similarity": bool,
      "group_dilutions": bool
    }
    Retourne: layout JSON (même structure que /arrange)
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Données manquantes."), 400

    groups = data.get("groups", {})
    if not groups:
        return jsonify(error="Aucun groupe fourni."), 400

    session_id = session.get("_id", "")
    pkl_path = TMP_DIR / f"{session_id}.pkl"
    if not pkl_path.exists():
        return jsonify(error="Session expirée, veuillez recharger le fichier."), 400

    with pkl_path.open("rb") as fh:
        df = pickle.load(fh)

    sort_similarity = data.get("sort_by_similarity", session.get("sort_similarity", True))
    group_dilutions = data.get("group_dilutions", session.get("group_dilutions", False))

    try:
        layout = prepare_plates_data_grouped(df, groups, sort_similarity, group_dilutions)
    except Exception as e:
        return jsonify(error=f"Erreur de génération des groupes : {e}"), 500

    return jsonify(layout)


@app.post("/export")
def export():
    """
    Reçoit le layout JSON (potentiellement modifié par l'utilisateur via drag & drop)
    et génère le fichier Excel final.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Données manquantes."), 400

    layout = data.get("layout")
    template_key = data.get("template_key") or session.get("template_key", "")
    position = data.get("position") or session.get("position", "H5")
    original_filename = data.get("filename") or session.get("original_filename", "plaque")

    if not layout:
        return jsonify(error="Layout manquant."), 400

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        return jsonify(error="Template inconnu."), 400

    template_path = TEMPLATE_DIR / info["filename"]
    position = position.strip().upper()
    if not valid_excel_cell(position):
        return jsonify(error="Position invalide."), 400

    try:
        xlsx_buf = generate_plaque_from_layout(layout, str(template_path), position)
    except Exception as e:
        return jsonify(error=f"Erreur de génération : {e}"), 500

    # Nettoyer le fichier temporaire
    session_id = session.get("_id", "")
    if session_id:
        pkl_path = TMP_DIR / f"{session_id}.pkl"
        try:
            pkl_path.unlink(missing_ok=True)
        except Exception:
            pass

    # Mettre à jour la position mémorisée
    info["position"] = position
    reg[template_key] = info
    save_registry(reg)

    base = Path(secure_filename(original_filename)).stem
    download_name = f"{base}_plaque_PCR.xlsx"
    return send_file(
        xlsx_buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name,
        max_age=0,
    )
