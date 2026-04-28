from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def _client(tmp_path: Path, monkeypatch) -> TestClient:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("FORGER_VIBE_STATE_PATH", str(tmp_path / "state.json"))
    monkeypatch.setenv("FORGER_VIBE_INTERNAL_ROOT", str(tmp_path / "internal"))
    monkeypatch.setenv("FORGER_APP_GRANT_SECRET", "test-secret")
    monkeypatch.setenv("FORGER_APP_ID", "vibe-forger")
    return TestClient(app)


def _grant(path: Path, secret: str = "test-secret", app_id: str = "vibe-forger") -> str:
    grant_payload = {
        "appId": app_id,
        "path": str(path.resolve()),
        "exp": int(time.time()) + 60,
    }
    payload = base64.urlsafe_b64encode(
        json.dumps(
            grant_payload,
            separators=(",", ":"),
        ).encode("utf-8"),
    ).rstrip(b"=").decode("ascii")
    signature = base64.urlsafe_b64encode(
        hmac.new(
            secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).digest(),
    ).rstrip(b"=").decode("ascii")
    return f"{payload}.{signature}"


def test_internal_workspace_crud(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)

    response = client.post("/api/workspace/internal")
    assert response.status_code == 200
    assert response.json()["mode"] == "internal"

    create_folder = client.post(
        "/api/fs/create",
        json={"path": "notes", "type": "folder"},
    )
    assert create_folder.status_code == 200
    create_file = client.post(
        "/api/fs/create",
        json={"path": "notes/today.md", "type": "file"},
    )
    assert create_file.status_code == 200

    write_response = client.put(
        "/api/fs/write",
        json={"path": "notes/today.md", "content": "# Today\n\nBuild a tiny IDE.\n"},
    )
    assert write_response.status_code == 200
    assert write_response.json()["content"].startswith("# Today")

    read_response = client.get("/api/fs/read", params={"path": "notes/today.md"})
    assert read_response.status_code == 200
    assert "tiny IDE" in read_response.json()["content"]

    assert client.post(
        "/api/fs/rename",
        json={"path": "notes/today.md", "new_path": "notes/plan.md"},
    ).status_code == 200
    assert client.request(
        "DELETE",
        "/api/fs/delete",
        json={"path": "notes", "recursive": True},
    ).status_code == 200


def test_rejects_path_escape_and_absolute_paths(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)
    client.post("/api/workspace/internal")

    traversal = client.get("/api/fs/read", params={"path": "../secret.txt"})
    assert traversal.status_code == 400
    assert "Path traversal" in traversal.json()["detail"]

    absolute = client.get("/api/fs/read", params={"path": str(tmp_path / "secret.txt")})
    assert absolute.status_code == 400
    assert "Absolute paths" in absolute.json()["detail"]


def test_tree_loads_one_folder_at_a_time(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)
    client.post("/api/workspace/internal")
    root = tmp_path / "internal"
    (root / "src" / "app").mkdir(parents=True)
    (root / "src" / "app" / "main.py").write_text("print('hello')\n", "utf-8")
    (root / "README.md").write_text("# Demo\n", "utf-8")

    root_tree = client.get("/api/fs/tree")
    assert root_tree.status_code == 200
    root_payload = root_tree.json()
    src = next(item for item in root_payload["children"] if item["name"] == "src")
    assert src["type"] == "folder"
    assert src["children"] is None
    assert all(item["name"] != "app" for item in root_payload["children"])

    src_tree = client.get("/api/fs/tree", params={"path": "src"})
    assert src_tree.status_code == 200
    src_payload = src_tree.json()
    assert src_payload["path"] == "src"
    assert [item["name"] for item in src_payload["children"]] == ["app"]
    assert src_payload["children"][0]["children"] is None


def test_rejects_binary_and_large_files(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)
    client.post("/api/workspace/internal")
    root = tmp_path / "internal"
    (root / "binary.dat").write_bytes(b"abc\x00def")
    (root / "large.txt").write_bytes(b"a" * (1024 * 1024 + 1))

    binary = client.get("/api/fs/read", params={"path": "binary.dat"})
    assert binary.status_code == 415
    assert "binary" in binary.json()["detail"]

    large = client.get("/api/fs/read", params={"path": "large.txt"})
    assert large.status_code == 413
    assert "too large" in large.json()["detail"]


def test_rejects_symlink_outside_root(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)
    client.post("/api/workspace/internal")
    root = tmp_path / "internal"
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", "utf-8")
    try:
        os.symlink(outside, root / "outside-link.txt")
    except OSError:
        return

    response = client.get("/api/fs/read", params={"path": "outside-link.txt"})
    assert response.status_code == 403
    assert "Symlinks outside" in response.json()["detail"]


def test_external_workspace_requires_matching_grant(
    tmp_path: Path,
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    client = _client(tmp_path, monkeypatch)
    external = tmp_path / "external"
    external.mkdir()

    denied = client.post(
        "/api/workspace/external",
        json={
            "root_path": str(external),
            "grant_token": _grant(external, secret="wrong"),
        },
    )
    assert denied.status_code == 403

    accepted = client.post(
        "/api/workspace/external",
        json={"root_path": str(external), "grant_token": _grant(external)},
    )
    assert accepted.status_code == 200
    assert accepted.json()["mode"] == "external"
