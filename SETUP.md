# 全端設定指南（Supabase）

福袋抽籤已從純 localStorage 升級為「登入 + 雲端資料庫」。前端仍部署在 GitHub Pages，
資料與帳號由免費的 [Supabase](https://supabase.com) 負責。以下是一次性設定步驟。

> 傷害計算器不需登入、也不受影響；只有福袋抽籤需要以下設定。

---

## 一、建立 Supabase 專案（只做一次）

1. 到 <https://supabase.com> 用 GitHub 或 Email 免費註冊。
2. 點 **New project**：
   - **Name**：隨意（例：`nindou`）
   - **Database Password**：設一組並自行保管（之後多半用不到）
   - **Region**：選離你近的（例：`Northeast Asia (Tokyo)`）
3. 等專案建立完成（約 1～2 分鐘）。

## 二、建立資料表與權限

1. 左側選單 → **SQL Editor** → **New query**。
2. 打開本專案的 [`supabase/schema.sql`](supabase/schema.sql)，整段複製貼上。
3. 按 **Run**。看到成功訊息即代表 `members / seasons / winners` 三張表與 RLS 權限都建好了。
   （此腳本可重複執行，日後要重跑也不會弄壞資料。）

## 三、取得連線金鑰

1. 左側 **Settings（齒輪）→ API**。
2. 記下兩個值：
   - **Project URL**（例：`https://abcdefgh.supabase.co`）
   - **Project API keys** 裡的 **`anon` `public`** 那把金鑰
3. 這兩個值設計上就是要放在前端、可公開；真正的安全由資料表的 RLS 保障（每個帳號只能存取自己的資料）。

## 四、把金鑰填進專案

在專案根目錄複製一份 `.env.example` 為 `.env.local`，填入剛剛的值：

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://你的專案.supabase.co
VITE_SUPABASE_ANON_KEY=你的-anon-public-金鑰
```

> `.env.local` 已被 `.gitignore` 排除，不會上傳到 GitHub。

## 五、設定登入網址（避免驗證信連結跳錯地方）

Supabase → **Authentication → URL Configuration**：

- **Site URL** 設為：`https://asd741.github.io/Nindou/`
- **Redirect URLs** 加入：`https://asd741.github.io/Nindou/` 以及本機測試用的 `http://localhost:5173/Nindou/`

（若想省略「收信驗證」步驟，可在 **Authentication → Providers → Email** 關閉 *Confirm email*，
註冊後就能直接登入；正式對外建議保持開啟。）

---

## 六、本機測試

```bash
npm install
npm run dev
```

打開終端機顯示的網址（通常 `http://localhost:5173/Nindou/`）→ 切到「公會戰福袋抽籤」分頁：

1. 用 Email、密碼**註冊**一個帳號。
2. 登入後，**這台電腦原本的 localStorage 公會/中獎資料會自動匯入雲端**（每台瀏覽器只匯一次；原本的本機資料保留不刪，作為備份）。
3. 新增成員、抽獎、標記領取，重整頁面資料仍在，即代表雲端運作正常。

## 七、部署到 GitHub Pages

沿用原本流程：本機建置後把 `docs/` commit 上去。

```bash
npm run build      # 產生 docs/（會把 .env.local 的金鑰內嵌進前端）
git add -A && git commit -m "build: 部署雲端版" && git push
```

> ⚠️ 每次改完程式要重新 `npm run build` 才會更新 `docs/`。金鑰是在**建置當下**注入的，
> 所以務必在有 `.env.local` 的電腦上建置。

---

## 用 UI 檢視 / 手動編輯正式資料

Supabase → **Table Editor**：像試算表一樣瀏覽、篩選、直接改格子、新增或刪除列，
按 Enter 就寫回正式資料庫。使用者帳號在 **Authentication → Users** 管理。

## 常見問題

- **登入後一片空白 / 一直轉圈**：多半是金鑰沒填或填錯，開瀏覽器 Console 會看到 `[Supabase] 尚未設定…` 或連線錯誤。
- **免費專案暫停**：Supabase 免費專案閒置約一週會自動暫停，到 Dashboard 點一下即可恢復，資料不會消失。
- **換一台電腦看不到資料**：資料是綁「帳號」不是「裝置」，用同一個 Email 登入即可看到；
  首次匯入只發生在原本有本機資料的那台瀏覽器。
