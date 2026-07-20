#!/usr/bin/env bash
# 一鍵發佈到 GitHub Pages：重新建置 → 提交 docs → 推送。
#
# 本專案的 GitHub Pages 設定為「從 master 分支的 /docs 資料夾」出站，
# 所以推上 master 就等於發佈，約 1–2 分鐘後生效：https://asd741.github.io/Nindou/
#
# 用法：pnpm run deploy   （注意要加 run；deploy 是 pnpm 內建指令）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ (1/3) 建置中（含型別檢查）…"
pnpm build

echo "▶ (2/3) 提交變更…"
git add -A
if git diff --cached --quiet; then
  echo "✔ 沒有任何變更，網站已是最新，無需發佈。"
  exit 0
fi
git commit -m "deploy: 發佈到 GitHub Pages（$(date '+%Y-%m-%d %H:%M')）"

echo "▶ (3/3) 推送到 origin/master…"
git push

echo "✅ 完成！約 1–2 分鐘後生效：https://asd741.github.io/Nindou/"
