#!/bin/bash
# Design Desk「ローカルClaude連携パネル（ベータ）」の橋渡しをダブルクリックで起動する（Mac用）
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。https://nodejs.org から LTS 版を入れてから、もう一度開いてください"
  read -r -p "Enter で閉じます"
  exit 1
fi
node panel-bridge.mjs
