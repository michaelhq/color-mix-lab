import { useCallback, useEffect, useMemo, useState } from "react";
import TextureBakeWorkflow from "./workflows/texture/App";
import VertexColorMixWorkflow from "./workflows/vertex/App";
import "./style.css";

type WorkflowId = "texture" | "vertex";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

/** Payload passed from Texture Baking to VertexColor without writing a temporary file. */
interface BakedObjHandoffPayload {
  file: File;
  obj: string;
  name: string;
  vertexCount: number;
  faceCount: number;
}

const APP_VERSION = "0.7.32";
const THEME_STORAGE_KEY = "color-mix-lab-theme-mode";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

const workflowHelp: Record<WorkflowId, string> = {
  texture: "Bake GLB or OBJ texture colours into a baked vertex-colour OBJ. The baked OBJ can be exported or handed off directly to VertexColor 2 ColorMix.",
  vertex: "Prepare an OBJ with vertex colours for ColorMix / Full Spectrum 3MF workflows: physical colours, colour correction, reduced palette, virtual mixes and 3MF export.",
};

const globalHelp = {
  reloadData: "Reloads the currently selected workflow input data from the browser File objects and rebuilds the working state without a full page reload.",
  reloadApp: "Reloads the whole Color Mix Lab page with a cache-busting parameter. Unsaved changes are lost.",
  theme: "Controls the Color Mix Lab user-interface theme. System follows the operating-system light/dark setting.",
};

export default function App() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowId>("texture");
  const [handoffFile, setHandoffFile] = useState<File | null>(null);
  const [handoffNonce, setHandoffNonce] = useState(0);
  const [vertexLoadFocusNonce, setVertexLoadFocusNonce] = useState(0);
  const [reloadDataNonce, setReloadDataNonce] = useState(0);
  const [globalStatus, setGlobalStatus] = useState<string>("Ready.");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  });
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemTheme(media.matches ? "light" : "dark");
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const resolvedTheme = useMemo<ResolvedTheme>(() => (
    themeMode === "system" ? systemTheme : themeMode
  ), [systemTheme, themeMode]);

  // Keep both workflows mounted so their local state survives tab changes; the
  // nonce values signal intentional data reloads and handoffs between them.
  const handleBakedObjHandoff = useCallback((payload: BakedObjHandoffPayload) => {
    setGlobalStatus("Baked OBJ sent to VertexColor 2 ColorMix.");
    setHandoffFile(payload.file);
    setHandoffNonce((value) => value + 1);
    setVertexLoadFocusNonce((value) => value + 1);
    setActiveWorkflow("vertex");
  }, []);

  const handleReloadData = useCallback(() => {
    setGlobalStatus("Reloading current workflow data.");
    setReloadDataNonce((value) => value + 1);
  }, []);

  const handleReloadApp = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("reload", String(Date.now()));
    window.location.href = url.toString();
  }, []);

  return (
    <div className={`cml-shell cml-theme-${resolvedTheme}`}>
      <header className="cml-appbar">
        <div className="cml-brand-inline">
          <strong>Color Mix Lab</strong>
          <span>{APP_VERSION}</span>
        </div>

        <nav className="cml-workflow-switch" aria-label="Color Mix Lab workflow">
          <button
            type="button"
            className={activeWorkflow === "texture" ? "active" : ""}
            onClick={() => setActiveWorkflow("texture")}
            title={workflowHelp.texture}
          >
            <span className="cml-workflow-label">Texture Baking</span>
          </button>
          <button
            type="button"
            className={activeWorkflow === "vertex" ? "active" : ""}
            onClick={() => setActiveWorkflow("vertex")}
            title={workflowHelp.vertex}
          >
            <span className="cml-workflow-label">VertexColor 2 ColorMix</span>
          </button>
        </nav>

        <div className="cml-global-controls" aria-label="Global Color Mix Lab controls">
          <button type="button" className="secondary compact" onClick={handleReloadData} title={globalHelp.reloadData}>
            Reload data
          </button>
          <button type="button" className="secondary compact" onClick={handleReloadApp} title={globalHelp.reloadApp}>
            Reload app
          </button>
          <label title={globalHelp.theme}>
            <span>GUI theme</span>
            <select value={themeMode} onChange={(event) => setThemeMode(event.currentTarget.value as ThemeMode)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>

      <main className="cml-main">
        <div className="cml-workflow-pane cml-texture-pane" style={{ display: activeWorkflow === "texture" ? "block" : "none", height: "100%" }}>
          <TextureBakeWorkflow
            onBakedObjHandoff={handleBakedObjHandoff}
            onStatusChange={setGlobalStatus}
            shellTheme={resolvedTheme}
            reloadDataNonce={reloadDataNonce}
          />
        </div>
        <div className="cml-workflow-pane cml-vertex-pane" style={{ display: activeWorkflow === "vertex" ? "block" : "none", height: "100%" }}>
          <VertexColorMixWorkflow
            incomingObjFile={handoffFile}
            incomingObjNonce={handoffNonce}
            focusLoadTabNonce={vertexLoadFocusNonce}
            onIncomingObjConsumed={() => setHandoffFile(null)}
            onStatusChange={setGlobalStatus}
            shellTheme={resolvedTheme}
            hideTopbarControls
            reloadDataNonce={reloadDataNonce}
          />
        </div>
      </main>

      <footer className="cml-statusbar" role="status" aria-live="polite">
        <span className="cml-statusbar-label">Status</span>
        <span className="cml-statusbar-message">{globalStatus}</span>
      </footer>
    </div>
  );
}
