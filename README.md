# vite-fastapi-sqlite-skeleton

Plantilla base para nuevas apps Forger del stack `vite-fastapi-sqlite`.

Este repo **sí depende del common del stack** y debe usarse con submódulos.
El objetivo es que cualquier app nueva herede el mismo runtime y utilidades compartidas
(`Dockerfile`, `database.py`, `health.py`, `cors.py`, `client.ts`) desde `commons/`.

## Dependencia del stack common

- Submódulo requerido: `commons/`
- Remote esperado: `git@github.com:forger-ai/vite-fastapi-sqlite-commons.git`
- Este skeleton está preparado para que Docker monte archivos de `commons` sobre:
  - `backend/src/app/database.py`
  - `backend/src/app/health.py`
  - `backend/src/app/cors.py`
  - `frontend/src/api/client.ts`

Esto evita drift entre apps y centraliza cambios transversales del stack.

## Estructura

```text
vite-fastapi-sqlite-skeleton/
├── .gitmodules
├── commons/                         # submodule: stack shared code
├── docker-compose.yml               # usa dockerfiles/helpers desde commons
├── backend/
│   ├── pyproject.toml
│   ├── data/
│   └── src/app/
│       ├── main.py
│       ├── database.py              # fallback local, override por commons en Docker
│       ├── health.py                # fallback local, override por commons en Docker
│       ├── cors.py                  # fallback local, override por commons en Docker
│       └── models.py
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── theme.ts
│       └── api/client.ts            # fallback local, override por commons en Docker
└── scripts/
    └── package_app.sh
```

## Clonado correcto

Siempre clonar con submódulos:

```bash
git clone --recurse-submodules git@github.com:forger-ai/vite-fastapi-sqlite-skeleton.git
```

Si ya clonaste sin submódulos:

```bash
git submodule update --init --recursive
```

## Desarrollo recomendado (Docker + commons)

```bash
docker compose up --build
```

Servicios:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- Health: `GET http://localhost:8000/api/health`

## Desarrollo local sin Docker (fallback)

Puedes correr localmente sin compose usando las versiones fallback del repo:

```bash
cd backend
uv sync
uv run fastapi dev src/app/main.py
```

```bash
cd frontend
npm install
npm run dev
```

Esto sirve para iterar rápido, pero el camino canónico del stack es Docker con mounts a `commons`.

## Actualizar el common del stack

```bash
git submodule update --remote commons
git add commons
git commit -m "chore: bump commons"
```

## Convención para nuevas apps derivadas

Cuando crees una app desde este skeleton:

1. Mantén `commons/` como submódulo.
2. Conserva el patrón de mounts de `docker-compose.yml`.
3. Evita copiar y forkear archivos compartidos si no es estrictamente necesario.
4. Si agregas utilidades reutilizables para múltiples apps, súbelas a `vite-fastapi-sqlite-commons`.
5. Mantén `manifest.json` con una entrada de `changelog` por cada versión publicada.
6. Verifica que el ZIP distribuible no incluya `.git` en ningún nivel.
