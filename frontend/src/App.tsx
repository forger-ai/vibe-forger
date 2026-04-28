import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFolderUploadIcon from "@mui/icons-material/DriveFolderUpload";
import EditIcon from "@mui/icons-material/Edit";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import { ApiError, get, post, request } from "./api/client";

declare global {
  interface Window {
    forgerApp?: {
      selectExternalFolder: () => Promise<
        | { canceled: true }
        | { canceled: false; path: string; grantToken: string; expiresAt: string }
      >;
    };
  }
}

type WorkspaceInfo = {
  selected: boolean;
  mode: "internal" | "external" | null;
  root_path: string | null;
  root_name: string | null;
  max_text_bytes: number;
  external_picker_available: boolean;
};

type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder" | "blocked";
  size?: number | null;
  modified_at?: string | null;
  children?: FileNode[] | null;
  error?: string | null;
};

type ReadFileResponse = {
  path: string;
  content: string;
  size: number;
  modified_at: string;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const dirname = (path: string) => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

const joinPath = (parent: string, name: string) =>
  [parent, name].filter(Boolean).join("/");

const languageForPath = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return "plaintext";
  }
};

const formatBytes = (value?: number | null) => {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "No pudimos completar la accion.";

function FileTree({
  node,
  activePath,
  onOpen,
  depth = 0,
}: {
  node: FileNode;
  activePath: string | null;
  onOpen: (node: FileNode) => void;
  depth?: number;
}) {
  if (node.path === "") {
    return (
      <>
        {(node.children ?? []).map((child) => (
          <FileTree
            key={`${child.type}:${child.path}`}
            node={child}
            activePath={activePath}
            onOpen={onOpen}
            depth={0}
          />
        ))}
      </>
    );
  }

  const disabled = node.type === "blocked";

  return (
    <>
      <ListItemButton
        dense
        disabled={disabled}
        selected={node.path === activePath}
        onClick={() => onOpen(node)}
        sx={{
          pl: 1.25 + depth * 1.8,
          pr: 1,
          minHeight: 34,
          borderRadius: 1,
          mx: 0.75,
          my: 0.2,
        }}
      >
        <ListItemIcon sx={{ minWidth: 30, color: disabled ? "text.disabled" : "inherit" }}>
          {node.type === "folder" ? <FolderIcon fontSize="small" /> : <InsertDriveFileIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText
          primary={node.name}
          secondary={node.type === "blocked" ? node.error : undefined}
          primaryTypographyProps={{ noWrap: true, fontSize: 13 }}
          secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
        />
      </ListItemButton>
      {node.type === "folder" &&
        (node.children ?? []).map((child) => (
          <FileTree
            key={`${child.type}:${child.path}`}
            node={child}
            activePath={activePath}
            onOpen={onOpen}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"file" | "folder" | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fileMeta, setFileMeta] = useState<ReadFileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);

  const dirty = content !== savedContent;
  const activeFolder = useMemo(() => {
    const selected = activePath ?? "";
    if (!selected) return "";
    const find = (node: FileNode): FileNode | null => {
      if (node.path === selected) return node;
      for (const child of node.children ?? []) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    };
    const active = tree ? find(tree) : null;
    return active?.type === "folder" ? active.path : dirname(selected);
  }, [activePath, tree]);

  const refreshTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      setTree(await get<FileNode>("/api/fs/tree"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const next = await get<WorkspaceInfo>("/api/workspace");
      setWorkspace(next);
      if (next.selected) {
        await refreshTree();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [refreshTree]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    setSaveState((current) => {
      if (!activePath) return "idle";
      if (dirty) return current === "saving" ? "saving" : "dirty";
      return current === "dirty" ? "saved" : current;
    });
  }, [activePath, dirty]);

  const openInternalWorkspace = async () => {
    setLoading(true);
    try {
      setWorkspace(await post<WorkspaceInfo>("/api/workspace/internal", {}));
      setActivePath(null);
      setActiveType(null);
      setContent("");
      setSavedContent("");
      setFileMeta(null);
      await refreshTree();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openExternalWorkspace = async () => {
    if (!window.forgerApp?.selectExternalFolder) {
      setError("La seleccion de carpeta externa requiere abrir la app desde Forger Desktop.");
      return;
    }
    setLoading(true);
    try {
      const selection = await window.forgerApp.selectExternalFolder();
      if (selection.canceled) return;
      setWorkspace(await post<WorkspaceInfo>("/api/workspace/external", {
        root_path: selection.path,
        grant_token: selection.grantToken,
      }));
      setActivePath(null);
      setActiveType(null);
      setContent("");
      setSavedContent("");
      setFileMeta(null);
      await refreshTree();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (node: FileNode) => {
    if (node.type === "folder") {
      setActivePath(node.path);
      setActiveType("folder");
      setContent("");
      setSavedContent("");
      setFileMeta(null);
      setSaveState("idle");
      return;
    }
    if (node.type !== "file") return;
    setLoading(true);
    try {
      const file = await get<ReadFileResponse>(`/api/fs/read?path=${encodeURIComponent(node.path)}`);
      setActivePath(file.path);
      setActiveType("file");
      setContent(file.content);
      setSavedContent(file.content);
      setFileMeta(file);
      setSaveState("saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const saveFile = useCallback(async () => {
    if (!activePath || saveState === "saving") return;
    setSaveState("saving");
    try {
      const file = await request<ReadFileResponse>("/api/fs/write", {
        method: "PUT",
        body: { path: activePath, content },
      });
      setSavedContent(file.content);
      setFileMeta(file);
      setSaveState("saved");
      await refreshTree();
    } catch (err) {
      setSaveState("error");
      setError(errorMessage(err));
    }
  }, [activePath, content, refreshTree, saveState]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [saveFile]);

  const createEntry = async (type: "file" | "folder") => {
    const label = type === "file" ? "Nombre del archivo" : "Nombre de la carpeta";
    const name = window.prompt(label);
    if (!name?.trim()) return;
    const path = joinPath(activeFolder, name.trim());
    try {
      await post("/api/fs/create", { path, type });
      await refreshTree();
      if (type === "file") {
        await openFile({ name: name.trim(), path, type: "file" });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const renameActive = async () => {
    if (!activePath) return;
    const currentName = activePath.split("/").pop() ?? activePath;
    const name = window.prompt("Nuevo nombre", currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    const newPath = joinPath(dirname(activePath), name.trim());
    try {
      await post("/api/fs/rename", { path: activePath, new_path: newPath });
      setActivePath(newPath);
      if (fileMeta) {
        setFileMeta({ ...fileMeta, path: newPath });
      }
      await refreshTree();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await request("/api/fs/delete", {
        method: "DELETE",
        body: { path: pendingDelete.path, recursive: pendingDelete.type === "folder" },
      });
      if (activePath === pendingDelete.path || activePath?.startsWith(`${pendingDelete.path}/`)) {
        setActivePath(null);
        setActiveType(null);
        setContent("");
        setSavedContent("");
        setFileMeta(null);
        setSaveState("idle");
      }
      setPendingDelete(null);
      await refreshTree();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveLabel =
    saveState === "saving" ? "Guardando" :
    saveState === "dirty" ? "Sin guardar" :
    saveState === "error" ? "Error" :
    activePath ? "Guardado" : "Sin archivo";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", color: "text.primary" }}>
      <Box
        component="header"
        sx={{
          height: 58,
          px: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800} noWrap>
            Vibe Forger
          </Typography>
          {workspace?.selected && (
            <Chip
              size="small"
              color={workspace.mode === "external" ? "primary" : "secondary"}
              label={workspace.root_name ?? "workspace"}
              sx={{ maxWidth: 240 }}
            />
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip
            size="small"
            variant={dirty ? "filled" : "outlined"}
            color={saveState === "error" ? "error" : dirty ? "warning" : "success"}
            label={saveLabel}
          />
          <Tooltip title="Guardar">
            <span>
              <IconButton disabled={!activePath || !dirty || saveState === "saving"} onClick={() => void saveFile()}>
                <SaveIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr)", height: "calc(100vh - 58px)" }}>
        <Box sx={{ borderRight: "1px solid", borderColor: "divider", bgcolor: "#101820", color: "#E9F3EF", minWidth: 0 }}>
          <Box sx={{ p: 1.25, display: "flex", alignItems: "center", gap: 0.75 }}>
            <Tooltip title="Abrir carpeta">
              <IconButton size="small" onClick={() => void openExternalWorkspace()} sx={{ color: "inherit" }}>
                <DriveFolderUploadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Usar workspace interno">
              <IconButton size="small" onClick={() => void openInternalWorkspace()} sx={{ color: "inherit" }}>
                <FolderIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Nuevo archivo">
              <span>
                <IconButton size="small" disabled={!workspace?.selected} onClick={() => void createEntry("file")} sx={{ color: "inherit" }}>
                  <NoteAddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Nueva carpeta">
              <span>
                <IconButton size="small" disabled={!workspace?.selected} onClick={() => void createEntry("folder")} sx={{ color: "inherit" }}>
                  <CreateNewFolderIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Renombrar">
              <span>
                <IconButton size="small" disabled={!activePath} onClick={() => void renameActive()} sx={{ color: "inherit" }}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Eliminar">
              <span>
                <IconButton
                  size="small"
                  disabled={!activePath}
                  onClick={() => activePath && setPendingDelete({
                    name: activePath.split("/").pop() ?? activePath,
                    path: activePath,
                    type: activeType ?? "file",
                  })}
                  sx={{ color: "inherit" }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Recargar">
              <span>
                <IconButton size="small" disabled={!workspace?.selected || treeLoading} onClick={() => void refreshTree()} sx={{ color: "inherit" }}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />
          {treeLoading && <Box sx={{ p: 2 }}><CircularProgress size={18} color="inherit" /></Box>}
          <List dense disablePadding sx={{ py: 1, overflow: "auto", height: "calc(100% - 50px)" }}>
            {tree && <FileTree node={tree} activePath={activePath} onOpen={openFile} />}
          </List>
        </Box>

        <Box sx={{ position: "relative", minWidth: 0 }}>
          {loading && (
            <Box sx={{ position: "absolute", inset: 0, zIndex: 2, display: "grid", placeItems: "center", bgcolor: "rgba(250, 248, 244, 0.78)" }}>
              <CircularProgress />
            </Box>
          )}

          {!workspace?.selected ? (
            <Box sx={{ height: "100%", display: "grid", placeItems: "center", px: 3 }}>
              <Box sx={{ maxWidth: 560, textAlign: "center" }}>
                <Typography variant="h3" fontWeight={900} sx={{ mb: 1 }}>
                  Abre un root para empezar
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                  Vibe Forger trabaja solo dentro de una carpeta autorizada.
                </Typography>
                <Box sx={{ display: "flex", gap: 1.5, justifyContent: "center", flexWrap: "wrap" }}>
                  <Button variant="contained" startIcon={<DriveFolderUploadIcon />} onClick={() => void openExternalWorkspace()}>
                    Abrir carpeta
                  </Button>
                  <Button variant="outlined" startIcon={<FolderIcon />} onClick={() => void openInternalWorkspace()}>
                    Usar workspace interno
                  </Button>
                </Box>
              </Box>
            </Box>
          ) : activePath && fileMeta ? (
            <Box sx={{ height: "100%", display: "grid", gridTemplateRows: "42px minmax(0, 1fr)" }}>
              <Box sx={{ px: 1.5, display: "flex", alignItems: "center", gap: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <InsertDriveFileIcon fontSize="small" color="primary" />
                <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0 }}>
                  {activePath}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {formatBytes(fileMeta.size)}
                </Typography>
              </Box>
              <Editor
                height="100%"
                language={languageForPath(activePath)}
                value={content}
                onChange={(value) => setContent(value ?? "")}
                theme="vs"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontLigatures: true,
                  wordWrap: "on",
                  smoothScrolling: true,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                }}
              />
            </Box>
          ) : (
            <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
              <Box sx={{ textAlign: "center" }}>
                <AddIcon color="primary" sx={{ fontSize: 42, mb: 1 }} />
                <Typography variant="h5" fontWeight={800}>
                  Selecciona o crea un archivo
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Confirmar eliminacion</DialogTitle>
        <DialogContent>
          <Typography>
            {pendingDelete?.path}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(error)} autoHideDuration={5200} onClose={() => setError(null)}>
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
