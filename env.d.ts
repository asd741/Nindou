/// <reference types="vite/client" />

// Supabase 連線設定（建置時由 .env.local 注入，皆為可公開的前端金鑰）
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
