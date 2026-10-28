import React from "react";
import ReactDOM from "react-dom/client";

import { initTheme } from "@shared/ui/theme";

import "./index.css";
import App from "./App";

initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
