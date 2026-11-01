import React from "react";
import ReactDOM from "react-dom/client";

import { initTheme } from "@shared/ui/theme";

import App from "./App";
import "./index.css";

initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
