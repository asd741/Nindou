<script setup lang="ts">
import { ref, computed } from 'vue'
import { signIn, signUp } from '../auth/auth'
import { isSupabaseConfigured } from '../supabase'

type Mode = 'login' | 'register'
const mode = ref<Mode>('login')
const email = ref('')
const password = ref('')
const busy = ref(false)
const errorMsg = ref('')
const okMsg = ref('')

const title = computed(() => (mode.value === 'login' ? '登入' : '註冊'))

function switchMode(m: Mode) {
  mode.value = m
  errorMsg.value = ''
  okMsg.value = ''
}

// 把 Supabase 常見英文錯誤轉成看得懂的中文提示。
function humanize(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return '帳號或密碼錯誤。'
  if (m.includes('already registered')) return '這個信箱已經註冊過了，請直接登入。'
  if (m.includes('password should be at least')) return '密碼長度至少需 6 碼。'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return '信箱格式不正確。'
  if (m.includes('email not confirmed')) return '此信箱尚未完成驗證，請先收信點擊驗證連結。'
  return msg
}

async function submit() {
  errorMsg.value = ''
  okMsg.value = ''
  const e = email.value.trim()
  const p = password.value
  if (!e || !p) { errorMsg.value = '請輸入信箱與密碼。'; return }
  busy.value = true
  try {
    if (mode.value === 'login') {
      await signIn(e, p)
      // 成功後由上層偵測登入狀態切換畫面，這裡不需再處理。
    } else {
      const { needsEmailConfirm } = await signUp(e, p)
      if (needsEmailConfirm) {
        okMsg.value = '註冊成功！請到信箱收驗證信，點擊連結後再回來登入。'
        mode.value = 'login'
      }
      // 若專案未開啟 email 驗證，會直接登入，上層自動切換畫面。
    }
  } catch (err) {
    errorMsg.value = humanize(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">🎁</div>
      <h2 class="auth-title">公會戰福袋抽籤</h2>
      <p class="auth-sub">登入後即可雲端保存你的公會成員與中獎紀錄，換裝置也不遺失。</p>

      <div v-if="!isSupabaseConfigured" class="auth-warn">
        尚未設定資料庫連線（VITE_SUPABASE_URL / ANON_KEY）。請參考專案的 SETUP.md。
      </div>

      <div class="auth-tabs">
        <button class="auth-tab" :class="{ on: mode === 'login' }" @click="switchMode('login')">登入</button>
        <button class="auth-tab" :class="{ on: mode === 'register' }" @click="switchMode('register')">註冊</button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-lbl">信箱</label>
        <input v-model="email" class="auth-inp" type="email" autocomplete="email"
          placeholder="you@example.com" :disabled="busy" />

        <label class="auth-lbl">密碼</label>
        <input v-model="password" class="auth-inp" type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="至少 6 碼" :disabled="busy" />

        <button class="auth-submit" type="submit" :disabled="busy || !isSupabaseConfigured">
          {{ busy ? '處理中⋯' : title }}
        </button>
      </form>

      <p v-if="errorMsg" class="auth-msg err">{{ errorMsg }}</p>
      <p v-if="okMsg" class="auth-msg ok">{{ okMsg }}</p>

      <p class="auth-foot">
        <template v-if="mode === 'login'">還沒有帳號？<a @click="switchMode('register')">註冊一個</a></template>
        <template v-else>已經有帳號了？<a @click="switchMode('login')">前往登入</a></template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  display: flex; align-items: center; justify-content: center;
  padding: 48px 18px; min-height: 420px;
}
.auth-card {
  width: 100%; max-width: 380px;
  background: linear-gradient(135deg, #14121e, #17151f);
  border: 1px solid var(--border2); border-radius: var(--radius-lg);
  padding: 30px 26px 24px; text-align: center;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.auth-logo { font-size: 2.4rem; }
.auth-title { font-size: 1.35rem; font-weight: 800; color: var(--text); margin: 8px 0 6px; }
.auth-sub { font-size: 0.8rem; color: var(--text3); line-height: 1.5; margin-bottom: 18px; }

.auth-warn {
  font-size: 0.76rem; color: var(--red); background: rgba(230,70,70,0.08);
  border: 1px solid rgba(230,70,70,0.3); border-radius: var(--radius);
  padding: 8px 10px; margin-bottom: 16px; line-height: 1.4;
}

.auth-tabs {
  display: flex; gap: 2px; background: rgba(0,0,0,0.3); border: 1px solid var(--border);
  border-radius: 10px; padding: 3px; margin-bottom: 18px;
}
.auth-tab {
  flex: 1; padding: 8px 0; border: none; border-radius: 7px; background: transparent;
  color: var(--text3); font-size: 0.9rem; font-weight: 700; font-family: inherit; cursor: pointer;
  transition: all 0.16s;
}
.auth-tab.on { background: var(--surface); color: var(--gold); box-shadow: 0 1px 6px rgba(0,0,0,0.4); }

.auth-form { display: flex; flex-direction: column; text-align: left; }
.auth-lbl { font-size: 0.74rem; font-weight: 700; color: var(--text3); letter-spacing: 0.08em; margin-bottom: 5px; }
.auth-inp {
  background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 0.92rem; padding: 10px 12px; outline: none;
  font-family: inherit; margin-bottom: 14px; transition: border-color 0.15s;
}
.auth-inp:focus { border-color: var(--gold); }
.auth-inp:disabled { opacity: 0.6; }
.auth-submit {
  margin-top: 4px; padding: 11px 0; border-radius: var(--radius); border: 2px solid var(--gold);
  background: linear-gradient(135deg, rgba(244,192,48,0.16), rgba(176,123,69,0.07));
  color: var(--gold); font-size: 1rem; font-weight: 800; letter-spacing: 0.08em;
  font-family: inherit; cursor: pointer; transition: all 0.18s;
}
.auth-submit:hover:not(:disabled) { background: linear-gradient(135deg, rgba(244,192,48,0.26), rgba(176,123,69,0.14)); }
.auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.auth-msg { font-size: 0.82rem; margin-top: 14px; line-height: 1.4; }
.auth-msg.err { color: var(--red); }
.auth-msg.ok { color: var(--green); }

.auth-foot { font-size: 0.8rem; color: var(--text3); margin-top: 18px; }
.auth-foot a { color: var(--gold); cursor: pointer; font-weight: 600; }
.auth-foot a:hover { text-decoration: underline; }
</style>
