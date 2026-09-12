#!/bin/bash
# Google Gemini CLI で作業を始める（Mac用・ダブルクリック）。先に Design Desk と同期してから gemini を起動する
cd "$(dirname "$0")"
if ! command -v gemini >/dev/null 2>&1; then
  echo "Gemini CLI が見つかりません。ターミナルで  npm install -g @google/gemini-cli  を実行して入れてから、もう一度開いてください"
  read -r -p "Enter で閉じます"
  exit 1
fi
bash sync.sh
echo
gemini
