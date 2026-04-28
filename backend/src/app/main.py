from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.cors import allowed_origins
from app.database import init_db
from app.health import router as health_router
from app.workspace import router as workspace_router

app = FastAPI(
    title="Vibe Forger API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(workspace_router)


@app.on_event("startup")
def on_startup() -> None:
    # Import models so SQLModel metadata includes declared tables.
    from app import models as _models  # noqa: F401

    init_db()
