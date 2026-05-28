import React from "react";
import { createRoot } from "react-dom/client";

import { App, type RalphloopReactInitialState } from "./App";

declare global {
  interface Window {
    __RALPHLOOP_STATE__?: RalphloopReactInitialState;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Ralphloop v2: #root container missing from page");
}

function readInitialState(): RalphloopReactInitialState {
  if (typeof window !== "undefined" && window.__RALPHLOOP_STATE__) {
    return window.__RALPHLOOP_STATE__;
  }
  const scriptElement = document.getElementById("ralphloop-state");
  if (!scriptElement) {
    throw new Error("Ralphloop v2: state element #ralphloop-state missing");
  }
  return JSON.parse(scriptElement.textContent ?? "{}") as RalphloopReactInitialState;
}

const initialState = readInitialState();
createRoot(container).render(<App initialState={initialState} />);
