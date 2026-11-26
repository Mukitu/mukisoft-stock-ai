/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BDAPPS_API_BASE?: string;
  readonly VITE_QUOTA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
