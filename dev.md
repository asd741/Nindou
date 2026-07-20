# 開發與部署指南（dev.md）

忍豆風雲4工具箱：**Vue 3 + Vite** 前端，部署在 **GitHub Pages**；
福袋抽籤／公會貢獻度的資料與帳號由免費的 [Supabase](https://supabase.com) 負責。

- 線上網址：<https://asd741.github.io/Nindou/>
- 套件管理：**pnpm**（本專案的鎖定檔為 `pnpm-lock.yaml`）
- 傷害計算器純前端、不需登入；只有「福袋抽籤」與「公會貢獻度」會用到 Supabase。

---

## 一、開發（本機）

```bash
pnpm i          # 安裝相依套件（第一次，或 package.json 有變動時）
pnpm dev        # 啟動開發伺服器（熱更新）
```

打開終端機顯示的網址（通常 <http://localhost:5173/Nindou/>）即可開發，存檔即時生效。

其他指令：

```bash
pnpm build         # 型別檢查 + 打包，輸出到 docs/（＝正式產物）
pnpm preview       # 本機預覽 build 後的成品
pnpm type-check    # 只跑 TypeScript 型別檢查，不打包
```

> 需要用到 Supabase 的功能（登入／雲端資料）在本機也要能連線，請先完成 **四、環境變數**
> 與 **五、Supabase 一次性設定**。純調傷害計算 UI 則不用。

---

## 二、部署到 GitHub Pages

本專案採「**把 build 產物 `docs/` 直接 commit 進 master**」的方式發佈。
GitHub Pages 讀 `docs/` 當網站根目錄，所以**推上 master 就等於發佈**。

### 一鍵發佈（平時用這個）

```bash
pnpm run deploy
```

它會依序：`pnpm build`（重建 `docs/`）→ `git add -A` → commit → `git push`。
推送後約 1–2 分鐘，<https://asd741.github.io/Nindou/> 就會更新。

> ⚠️ 要打「`pnpm run deploy`」，不能只打「`pnpm deploy`」——因為 `deploy` 是 pnpm 的
> 內建指令，少了 `run` 會被 pnpm 攔截、不會執行本專案的腳本。

### 手動發佈（等同上面）

```bash
pnpm build
git add -A
git commit -m "deploy: 你的說明"
git push
```

> ⚠️ **金鑰是在 `pnpm build` 當下才注入前端的**，所以務必在有 `.env.local` 的電腦上 build，
> 否則線上版會連不到 Supabase。每次改完程式都要重新 build，`docs/` 才會更新。

### GitHub Pages 設定（只做一次，已設好可略過）

GitHub 專案 → **Settings → Pages**：

- **Source**：`Deploy from a branch`
- **Branch**：`master` ／ 資料夾選 **`/docs`** → **Save**

（對應 `vite.config.ts` 的 `base: '/Nindou/'` 與 `build.outDir: 'docs'`；
若日後把倉庫改名，`base` 也要一起改成 `/新倉庫名/`。）

---

## 三、專案結構速覽

```
src/
  App.vue                     分頁外殼（傷害計算／福袋抽籤／公會貢獻度）
  supabase.ts                 Supabase client（讀 .env 的 URL / anon key）
  components/
    DamageCalc.vue            傷害計算器（純前端，規則即程式）
    LuckyDraw.vue             公會戰福袋抽籤
    LoginForm.vue             Email 登入／註冊
    ContribDashboard.vue      公會貢獻度 Dashboard（動態試算表）
  contrib/
    store.ts                  貢獻度的資料層（所有 Supabase 存取集中於此）
    excel.ts                  Excel 匯入／匯出（動態載入 SheetJS）
supabase/schema.sql           資料庫結構 + RLS（貼到 Supabase SQL Editor 執行）
docs/                         build 產物 = 正式網站（由 pnpm build 生成，勿手改）
```

---

## 四、環境變數（`.env.local`）

在專案根目錄複製範本並填入自己的值：

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://你的專案.supabase.co
VITE_SUPABASE_ANON_KEY=你的-anon-public-金鑰
```

- 這兩個值設計上就是公開放在前端的，安全性由資料庫的 **RLS**（每個帳號只能存取自己的資料）保障。
- `.env.local` 已被 `.gitignore`（`*.local`）排除，不會上傳到 GitHub。
- 取得方式見下一節第 3 步。

---

## 五、Supabase 一次性設定

### 1. 建立專案

到 <https://supabase.com> 免費註冊 → **New project**：Name 隨意、設一組 Database Password、
Region 選近的（例：`Northeast Asia (Tokyo)`）。等 1～2 分鐘建好。

### 2. 建立資料表與權限

左側 **SQL Editor → New query** → 打開本專案的 [`supabase/schema.sql`](supabase/schema.sql)
整段複製貼上 → **Run**。這會建立：

- 福袋抽籤：`members` / `seasons` / `winners`
- 公會貢獻度：`contrib_members` / `contrib_columns` / `contrib_cells`

以及全部的索引與 RLS。**此腳本可重複執行**（idempotent），日後改了結構重跑也不會弄壞既有資料。

> 📌 `schema.sql` 是資料庫結構的**唯一真實來源**。之後若要加欄位／改表，先改這份檔案再重跑，
> 別只在 Dashboard 手改，以免檔案與線上 DB 走鐘。

### 3. 取得連線金鑰

左側 **Settings（齒輪）→ API**，記下兩個值，填進 `.env.local`（見上一節）：

- **Project URL**（例：`https://abcdefgh.supabase.co`）→ `VITE_SUPABASE_URL`
- **Project API keys** 的 **`anon` `public`** 金鑰 → `VITE_SUPABASE_ANON_KEY`

### 4. 設定登入網址

**Authentication → URL Configuration**：

- **Site URL**：`https://asd741.github.io/Nindou/`
- **Redirect URLs** 加入：`https://asd741.github.io/Nindou/` 與本機用的 `http://localhost:5173/Nindou/`

（想省略收信驗證，可在 **Authentication → Providers → Email** 關閉 *Confirm email*；正式對外建議保持開啟。）

---

## 六、後端維護

### ⭐ 每週：避免免費專案被暫停

Supabase 免費專案**閒置約 7 天沒有任何請求就會自動暫停**（Paused），暫停期間 App 會連不上，
但**資料不會遺失**。維護方式二選一：

- **手動**：每週登入 <https://supabase.com/dashboard> 看一眼專案。若顯示 **Paused**，
  點 **Restore / Resume project**，等一兩分鐘恢復即可。
- **自動保活（推薦，設一次就免管）**：用免費排程服務（如
  [cron-job.org](https://cron-job.org)、UptimeRobot）**每 3～5 天**打一次任一 REST 端點，
  讓專案一直有活動、永不暫停。範例（GET）：

  ```
  https://你的專案.supabase.co/rest/v1/members?select=id&limit=1
  Header:  apikey: 你的-anon-public-金鑰
  ```

  回應 200 或空陣列都算「有活動」，就能重置暫停倒數。

### 用 UI 檢視／手動編修正式資料

- **Table Editor**：像試算表一樣瀏覽、篩選、直接改格子、增刪列，Enter 就寫回正式 DB。
- **Authentication → Users**：管理使用者帳號。

### 改動資料庫結構

一律改 `supabase/schema.sql` → 到 SQL Editor 重跑。因為腳本是 `create table if not exists`
＋ `drop policy … create policy`，重跑只會補齊缺的物件、不會刪資料；但**新增欄位**要另外寫
`alter table … add column …`（`if not exists` 不會幫既有表補欄位）。

---

## 七、常見問題

- **登入後一片空白／一直轉圈**：多半是金鑰沒填或填錯。開瀏覽器 Console 會看到
  `[Supabase] 尚未設定…` 或連線錯誤 → 檢查 `.env.local`，改完要重新 `pnpm build` 才會生效到線上。
- **線上版連不到、但本機正常**：build 那台沒有 `.env.local`，金鑰沒被注入 → 在有金鑰的電腦重跑 `pnpm run deploy`。
- **免費專案被暫停**：見「六、後端維護」，到 Dashboard 點 Restore 即可，資料仍在。
- **換一台電腦看不到資料**：資料綁「帳號」不綁「裝置」，用同一個 Email 登入就看得到。
- **`pnpm deploy` 沒反應／報奇怪的錯**：要用 `pnpm run deploy`（`deploy` 是 pnpm 內建指令，見「二」）。
