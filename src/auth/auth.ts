// 登入狀態（全站單一來源）。以 Supabase Auth 為後端，對外只暴露反應式狀態
// 與四個動作；元件不直接碰 supabase.auth，方便日後抽換或移除。
import { ref, computed } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase'

const session = ref<Session | null>(null)
const ready = ref(false)   // 是否已完成首次 session 還原（避免畫面閃爍）

// 啟動時還原既有 session，並持續監聽登入/登出/續期。
supabase.auth.getSession().then(({ data }) => {
  session.value = data.session
  ready.value = true
})
supabase.auth.onAuthStateChange((_event, s) => { session.value = s })

export const authReady = computed(() => ready.value)
export const user = computed(() => session.value?.user ?? null)
export const userEmail = computed(() => session.value?.user?.email ?? '')

// 註冊。若專案開啟 email 驗證，回傳的 session 會是 null（需先收信驗證）。
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return { needsEmailConfirm: !data.session }
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}
