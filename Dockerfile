FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_MODULE="app:app" \
    GUNICORN_WORKERS=2 \
    GUNICORN_BIND="0.0.0.0:1165" \
    GUNICORN_TIMEOUT=60

# root: paquets runtime (curl pour healthcheck)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# deps Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ⚠️ copier le code puis corriger droits
# (option A: directement avec --chown)
COPY --chown=10001:10001 . /app
# (option B si ton Docker ne supporte pas --chown, commente la ligne ci-dessus et décommente les 2 suivantes)
# COPY . /app
# RUN chown -R 10001:10001 /app

# garantir lecture/exécution répertoires pour tous (au cas où certains fichiers sont 600)
RUN chmod -R a+rX /app

# créer l'utilisateur non-root et l’utiliser
RUN useradd -m -u 10001 appuser
USER appuser

EXPOSE 1165

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:1165/healthz || exit 1

CMD ["sh","-c","gunicorn --workers ${GUNICORN_WORKERS} --bind ${GUNICORN_BIND} --timeout ${GUNICORN_TIMEOUT} ${APP_MODULE}"]
