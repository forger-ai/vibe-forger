from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

APP_ID = "vibe-forger"
MAX_TEXT_BYTES = 1024 * 1024
MAX_TREE_ENTRIES = 1000

router = APIRouter(prefix="/api", tags=["workspace"])


class WorkspaceInfo(BaseModel):
    selected: bool
    mode: Literal["internal", "external"] | None = None
    root_path: str | None = None
    root_name: str | None = None
    max_text_bytes: int = MAX_TEXT_BYTES
    external_picker_available: bool = False


class ExternalWorkspaceRequest(BaseModel):
    root_path: str
    grant_token: str


class FileNode(BaseModel):
    name: str
    path: str
    type: Literal["file", "folder", "blocked"]
    size: int | None = None
    modified_at: str | None = None
    children: list[FileNode] | None = None
    error: str | None = None


class ReadFileResponse(BaseModel):
    path: str
    content: str
    size: int
    modified_at: str


class WriteFileRequest(BaseModel):
    path: str
    content: str = Field(max_length=MAX_TEXT_BYTES)


class CreateEntryRequest(BaseModel):
    path: str
    type: Literal["file", "folder"]


class RenameEntryRequest(BaseModel):
    path: str
    new_path: str


class DeleteEntryRequest(BaseModel):
    path: str
    recursive: bool = False


class ActionResponse(BaseModel):
    ok: bool = True


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _internal_root() -> Path:
    raw = os.getenv("FORGER_VIBE_INTERNAL_ROOT", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return _backend_root() / "data" / "workspace"


def _state_path() -> Path:
    raw = os.getenv("FORGER_VIBE_STATE_PATH", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return _backend_root() / "data" / "workspace_state.json"


def _forger_app_id() -> str:
    return os.getenv("FORGER_APP_ID", APP_ID)


def _http_error(status_code: int, detail: str) -> None:
    raise HTTPException(status_code=status_code, detail=detail)


def _format_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()


def _load_state() -> dict[str, str] | None:
    path = _state_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if (
        data.get("mode") in {"internal", "external"}
        and isinstance(data.get("root"), str)
    ):
        return {"mode": data["mode"], "root": data["root"]}
    return None


def _save_state(mode: Literal["internal", "external"], root: Path) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"mode": mode, "root": str(root)}, indent=2), "utf-8")


def _active_root() -> tuple[Literal["internal", "external"], Path]:
    state = _load_state()
    if not state:
        _http_error(400, "Open a folder or use the internal workspace first.")
    assert state is not None
    try:
        root = Path(state["root"]).resolve(strict=True)
    except OSError:
        _http_error(400, "The selected workspace folder is no longer available.")
    return state["mode"], root


def _is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _validate_relative_path(raw_path: str) -> PurePosixPath:
    raw = (raw_path or "").strip()
    if raw in {"", "."}:
        return PurePosixPath(".")
    if "\\" in raw:
        _http_error(400, "Use workspace-relative POSIX paths.")
    path = PurePosixPath(raw)
    if path.is_absolute():
        _http_error(400, "Absolute paths are not allowed.")
    if any(part in {"", ".", ".."} for part in path.parts):
        _http_error(400, "Path traversal is not allowed.")
    return path


def _display_relative(root: Path, path: Path) -> str:
    rel = path.relative_to(root).as_posix()
    return "" if rel == "." else rel


def _resolve_existing(root: Path, raw_path: str) -> Path:
    rel = _validate_relative_path(raw_path)
    candidate = root / Path(*rel.parts)
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError:
        _http_error(404, "The requested path does not exist.")
    except OSError:
        _http_error(400, "The requested path cannot be resolved.")
    if not _is_inside(root, resolved):
        _http_error(403, "Symlinks outside the authorized root are blocked.")
    return resolved


def _resolve_new_path(root: Path, raw_path: str) -> Path:
    rel = _validate_relative_path(raw_path)
    if rel == PurePosixPath("."):
        _http_error(400, "Choose a file or folder path inside the workspace.")
    parent_path = (
        PurePosixPath(*rel.parts[:-1]).as_posix() if len(rel.parts) > 1 else ""
    )
    parent = _resolve_existing(root, parent_path)
    if not parent.is_dir():
        _http_error(400, "The parent path is not a folder.")
    return parent / rel.name


def _decode_grant_payload(token: str) -> dict[str, object]:
    secret = os.getenv("FORGER_APP_GRANT_SECRET", "")
    if not secret:
        _http_error(400, "External folder selection is not available in this runtime.")
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError:
        _http_error(403, "The folder grant is invalid.")
    expected = hmac.new(
        secret.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
    if not hmac.compare_digest(expected, actual):
        _http_error(403, "The folder grant is invalid.")
    try:
        raw_payload = base64.urlsafe_b64decode(
            payload_b64 + "=" * (-len(payload_b64) % 4),
        )
        payload = json.loads(raw_payload.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        _http_error(403, "The folder grant is invalid.")
    return payload


def _verify_external_grant(root: Path, token: str) -> None:
    payload = _decode_grant_payload(token)
    if payload.get("appId") != _forger_app_id():
        _http_error(403, "The folder grant was issued for another app.")
    if payload.get("path") != str(root):
        _http_error(403, "The folder grant does not match this folder.")
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        _http_error(403, "The folder grant has expired.")


def _workspace_info() -> WorkspaceInfo:
    state = _load_state()
    if not state:
        return WorkspaceInfo(
            selected=False,
            external_picker_available=bool(os.getenv("FORGER_APP_GRANT_SECRET")),
        )
    root = Path(state["root"])
    return WorkspaceInfo(
        selected=True,
        mode=state["mode"],
        root_path=str(root),
        root_name=root.name or str(root),
        external_picker_available=bool(os.getenv("FORGER_APP_GRANT_SECRET")),
    )


def _node_for_path(root: Path, path: Path, counter: list[int]) -> FileNode:
    if counter[0] >= MAX_TREE_ENTRIES:
        return FileNode(
            name=path.name or root.name,
            path=_display_relative(root, path),
            type="blocked",
            error="The workspace tree is too large to display completely.",
        )
    counter[0] += 1

    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return FileNode(
            name=path.name,
            path=_display_relative(root, path),
            type="blocked",
            error="Cannot resolve this path.",
        )
    if not _is_inside(root, resolved):
        return FileNode(
            name=path.name,
            path=_display_relative(root, path),
            type="blocked",
            error="Symlink points outside the authorized root.",
        )

    stat = resolved.stat()
    if resolved.is_dir():
        children: list[FileNode] = []
        entries = sorted(
            resolved.iterdir(),
            key=lambda entry: (not entry.is_dir(), entry.name.lower()),
        )
        for entry in entries:
            if entry.name in {".DS_Store", "__pycache__"}:
                continue
            children.append(_summary_node_for_path(root, entry, counter))
        return FileNode(
            name=resolved.name or root.name,
            path=_display_relative(root, resolved),
            type="folder",
            modified_at=_format_mtime(resolved),
            children=children,
        )

    return FileNode(
        name=resolved.name,
        path=_display_relative(root, resolved),
        type="file",
        size=stat.st_size,
        modified_at=_format_mtime(resolved),
    )


def _summary_node_for_path(root: Path, path: Path, counter: list[int]) -> FileNode:
    if counter[0] >= MAX_TREE_ENTRIES:
        return FileNode(
            name=path.name,
            path=_display_relative(root, path),
            type="blocked",
            error="The workspace tree is too large to display completely.",
        )
    counter[0] += 1

    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return FileNode(
            name=path.name,
            path=_display_relative(root, path),
            type="blocked",
            error="Cannot resolve this path.",
        )
    if not _is_inside(root, resolved):
        return FileNode(
            name=path.name,
            path=_display_relative(root, path),
            type="blocked",
            error="Symlink points outside the authorized root.",
        )
    stat = resolved.stat()
    if resolved.is_dir():
        return FileNode(
            name=resolved.name or root.name,
            path=_display_relative(root, resolved),
            type="folder",
            modified_at=_format_mtime(resolved),
            children=None,
        )
    return FileNode(
        name=resolved.name,
        path=_display_relative(root, resolved),
        type="file",
        size=stat.st_size,
        modified_at=_format_mtime(resolved),
    )


@router.get("/workspace", response_model=WorkspaceInfo)
def get_workspace() -> WorkspaceInfo:
    return _workspace_info()


@router.post("/workspace/internal", response_model=WorkspaceInfo)
def use_internal_workspace() -> WorkspaceInfo:
    root = _internal_root()
    root.mkdir(parents=True, exist_ok=True)
    _save_state("internal", root.resolve())
    return _workspace_info()


@router.post("/workspace/external", response_model=WorkspaceInfo)
def use_external_workspace(input_data: ExternalWorkspaceRequest) -> WorkspaceInfo:
    try:
        root = Path(input_data.root_path).expanduser().resolve(strict=True)
    except OSError:
        _http_error(400, "The selected folder is not available.")
    if not root.is_dir():
        _http_error(400, "Choose a folder, not a file.")
    _verify_external_grant(root, input_data.grant_token)
    _save_state("external", root)
    return _workspace_info()


@router.get("/fs/tree", response_model=FileNode)
def get_tree(path: str = "") -> FileNode:
    _, root = _active_root()
    target = _resolve_existing(root, path)
    if not target.is_dir():
        _http_error(400, "Only folders can be expanded.")
    return _node_for_path(root, target, [0])


@router.get("/fs/read", response_model=ReadFileResponse)
def read_file(path: str) -> ReadFileResponse:
    _, root = _active_root()
    target = _resolve_existing(root, path)
    if not target.is_file():
        _http_error(400, "Only text files can be opened.")
    size = target.stat().st_size
    if size > MAX_TEXT_BYTES:
        _http_error(413, "This file is too large for Vibe Forger.")
    data = target.read_bytes()
    if b"\x00" in data[:4096]:
        _http_error(415, "This file looks binary and cannot be opened as text.")
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        _http_error(415, "This file is not UTF-8 decodable text.")
    return ReadFileResponse(
        path=_display_relative(root, target),
        content=content,
        size=size,
        modified_at=_format_mtime(target),
    )


@router.put("/fs/write", response_model=ReadFileResponse)
def write_file(input_data: WriteFileRequest) -> ReadFileResponse:
    _, root = _active_root()
    encoded = input_data.content.encode("utf-8")
    if len(encoded) > MAX_TEXT_BYTES:
        _http_error(413, "This file is too large for Vibe Forger.")
    target = _resolve_new_path(root, input_data.path)
    if target.exists():
        target = _resolve_existing(root, input_data.path)
        if not target.is_file():
            _http_error(400, "Only files can be saved.")
    target.write_bytes(encoded)
    return read_file(_display_relative(root, target))


@router.post("/fs/create", response_model=ActionResponse)
def create_entry(input_data: CreateEntryRequest) -> ActionResponse:
    _, root = _active_root()
    target = _resolve_new_path(root, input_data.path)
    if target.exists():
        _http_error(409, "A file or folder already exists at that path.")
    if input_data.type == "folder":
        target.mkdir()
    else:
        target.write_text("", "utf-8")
    return ActionResponse()


@router.post("/fs/rename", response_model=ActionResponse)
def rename_entry(input_data: RenameEntryRequest) -> ActionResponse:
    _, root = _active_root()
    source = _resolve_existing(root, input_data.path)
    target = _resolve_new_path(root, input_data.new_path)
    if target.exists():
        _http_error(409, "A file or folder already exists at the destination path.")
    source.rename(target)
    return ActionResponse()


@router.delete("/fs/delete", response_model=ActionResponse)
def delete_entry(input_data: DeleteEntryRequest) -> ActionResponse:
    _, root = _active_root()
    target = _resolve_existing(root, input_data.path)
    if target == root:
        _http_error(400, "The workspace root cannot be deleted.")
    if target.is_dir() and not target.is_symlink():
        if not input_data.recursive and any(target.iterdir()):
            _http_error(400, "This folder is not empty.")
        shutil.rmtree(target)
    else:
        target.unlink()
    return ActionResponse()
