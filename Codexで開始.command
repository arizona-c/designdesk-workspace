#!/bin/bash
# OpenAI Codex CLI で作業を始める（Mac用・ダブルクリック）。先に Design Desk と同期してから codex を起動する
cd "$(dirname "$0")"
if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI が見つかりません。ターミナルで  npm install -g @openai/codex  を実行して入れてから、もう一度開いてください"
  read -r -p "Enter で閉じます"
  exit 1
fi
bash sync.sh
echo
echo "Codex を起動します。初回は「このフォルダを信頼しますか」と聞かれるので許可してください（Design Desk のツール設定を読むために必要です）"
codex
