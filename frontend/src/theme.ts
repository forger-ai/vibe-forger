import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#44A3FF",
    },
    secondary: {
      main: "#7CDBB5",
    },
    warning: {
      main: "#F0B84A",
    },
    background: {
      default: "#0B0F14",
      paper: "#111821",
    },
    text: {
      primary: "#E7EDF4",
      secondary: "#9BA8B5",
    },
    divider: "rgba(231,237,244,0.12)",
    success: {
      main: "#79D39C",
    },
    error: {
      main: "#FF6B6B",
    },
  },
  typography: {
    fontFamily: [
      "Inter",
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "Roboto",
      "sans-serif",
    ].join(","),
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
        },
      },
    },
  },
});

export default theme;
