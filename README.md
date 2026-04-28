# Vibe Forger

Vibe Forger is a simple local IDE for Forger. It opens an internal private workspace or a folder selected explicitly through Forger Desktop, then lets the user explore, create, rename, delete, open, edit, and save text files inside that authorized root.

## Stack

- Backend: FastAPI, Python 3.12, uv
- Frontend: Vite, React, TypeScript, MUI, Monaco
- Shared stack code: `commons/` submodule

## Development

```bash
docker compose up --build
```

Local URLs:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5182`
- Health: `http://localhost:8000/health`

## Verification

```bash
docker compose run --rm backend uv run --extra dev python scripts/verify.py
docker compose run --rm --no-deps frontend npm run build
```

## Security Model

The backend only operates inside the active authorized root:

- internal app workspace selected from the empty state;
- external folder selected explicitly through Forger Desktop with a short-lived signed grant.

Filesystem operations reject absolute paths, path traversal, symlinks outside the root, files over 1 MiB, binary files, and non-UTF-8 files.
