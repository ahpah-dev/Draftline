import React from "react";
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LazyMotion features={domAnimation} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <App />
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
