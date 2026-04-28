import { useEffect, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Chip,
  CircularProgress,
} from "@mui/material";
import { get } from "./api/client";

type HealthStatus = "loading" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<HealthStatus>("loading");

  useEffect(() => {
    get<{ status: string }>("/api/health")
      .then((data) => setStatus(data.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <Typography variant="h4" fontWeight={700}>
          skeleton
        </Typography>
        <Typography variant="body1" color="text.secondary">
          FastAPI + uv · Vite + React + MUI
        </Typography>

        {status === "loading" && <CircularProgress size={20} />}
        {status === "ok" && (
          <Chip label="API conectada" color="success" variant="outlined" />
        )}
        {status === "error" && (
          <Chip label="API no disponible" color="error" variant="outlined" />
        )}
      </Box>
    </Container>
  );
}
