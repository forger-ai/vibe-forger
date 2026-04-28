import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0E8F7E",
    },
    secondary: {
      main: "#E0564A",
    },
    warning: {
      main: "#D49316",
    },
    background: {
      default: "#FAF8F4",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#17212B",
      secondary: "#5C6670",
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
});

export default theme;
