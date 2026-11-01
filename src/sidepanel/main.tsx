import React from "react";
import { createRoot } from "react-dom/client";
import { Reader } from "./Reader";
import "../ui/styles.css";
import "katex/dist/katex.min.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Reader />
  </React.StrictMode>,
);
