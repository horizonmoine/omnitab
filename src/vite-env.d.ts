/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Optional CORS proxy for Songsterr (e.g. https://corsproxy.io/?). */
  readonly VITE_SONGSTERR_PROXY?: string;
  /** Base URL for the local Demucs FastAPI backend (default: http://localhost:8000). */
  readonly VITE_DEMUCS_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
