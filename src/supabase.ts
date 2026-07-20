// Supabase 用戶端（單一實例，全站共用）。
// URL 與 anon key 於建置時由 .env.local 注入；兩者皆為可公開的前端金鑰，
// 真正的存取控制在資料庫端的 Row Level Security（見 supabase/schema.sql）。
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 缺設定時給出明確錯誤，避免 UI 只是無聲失敗。
export const isSupabaseConfigured = Boolean(url && anonKey)
if (!isSupabaseConfigured) {
  console.error('[Supabase] 尚未設定 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請參考 .env.example 與 SETUP.md。')
}

// 未設定時給合法的預留位置，避免 createClient 因空字串直接拋錯而讓整個 App
// （含不需登入的傷害計算頁）無法載入；此時 isSupabaseConfigured 為 false，
// 登入畫面會顯示提示、停用送出。
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,      // 把登入狀態存進 localStorage，重整後維持登入
      autoRefreshToken: true,    // 自動續期，避免 token 過期被登出
    },
  },
)
