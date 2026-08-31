#!/bin/bash
# Design Desk 同期スクリプト。Claude 起動時に自動実行される（.claude/settings.json の SessionStart フック）。手動実行もOK
# やること:
#   1. workspace自体の自動更新（git pull。Figmaプラグインの新版もこれで手元に届く）
#   2. Design Desk から最新ルールを取得して .claude/designdesk-rules.md を更新
#   3. チケット操作ツール（MCP）の接続設定 .mcp.json を生成
# 実行中に git pull で自分自身が書き換わると誤動作するため、全体を関数にして末尾のブロックでまとめて実行する
cd "$(dirname "$0")"

self_update() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local before after
  before=$(git rev-parse HEAD 2>/dev/null)
  # 誤って消されたプラグインファイルの自己修復（pullはローカル削除を復元しないため）。
  # figma-plugin/ はユーザーが編集しない配布物なので、常にリポジトリの内容に戻して安全
  git checkout -q -- figma-plugin 2>/dev/null || true
  if git pull --ff-only -q 2>/dev/null; then
    after=$(git rev-parse HEAD 2>/dev/null)
    if [ "$before" != "$after" ]; then
      echo "⬆️ workspaceを更新しました。Figmaプラグインの更新が含まれる場合、プラグインは次回起動から最新になります"
    fi
  else
    echo "⚠ workspaceの自動更新に失敗（オフライン/ローカル変更あり?）。今の版のまま続行します"
  fi
}

sync_designdesk() {
  set -a; [ -f .env ] && . ./.env; set +a
  if [ -z "$DESIGNDESK_TOKEN" ] || [ -z "$DESIGNDESK_URL" ] || [ -z "$DESIGNDESK_PROJECT" ]; then
    echo "⚠ .env が未設定のため Design Desk 同期をスキップしました（セットアップ手順を参照）"
    return 0
  fi
  mkdir -p .claude
  local hdrs=".claude/.sync-headers.tmp"
  if curl -fsS -m 10 -D "$hdrs" -H "Authorization: Bearer $DESIGNDESK_TOKEN" \
    "$DESIGNDESK_URL/api/sync/claude-md?project=$DESIGNDESK_PROJECT" \
    -o .claude/designdesk-rules.md.tmp; then
    mv .claude/designdesk-rules.md.tmp .claude/designdesk-rules.md
    echo "✅ Design Desk のルールを同期しました（$(head -1 .claude/designdesk-rules.md | sed 's/# //')）"
    # 起動サマリ: 自分の進行中チケットとAIレビュー待機（ヘッダーから取得）
    local my pend
    my=$(grep -i '^x-dd-my-tickets:' "$hdrs" | tr -dc '0-9')
    pend=$(grep -i '^x-dd-pending-ai-reviews:' "$hdrs" | tr -dc '0-9')
    if [ -n "$my" ]; then
      echo "📋 あなたの進行中チケット: ${my}件 / AIレビュー待機: ${pend:-0}件"
      if [ "${pend:-0}" -gt 0 ]; then
        echo "   → Claudeに「AIレビュー実行」と伝えると、待機中の検査を行います"
      fi
    fi
  else
    rm -f .claude/designdesk-rules.md.tmp
    echo "⚠ Design Desk 同期に失敗（オフライン/トークン無効?）。前回のルールのまま続行します"
  fi
  rm -f "$hdrs"

  # Design Desk のチケット操作ツール（MCP）の接続設定を生成する。
  # トークンを含むためコミットされない（.gitignore済み）。初回生成時は次回の起動から有効
  local FIRST_MCP=0; [ -f .mcp.json ] || FIRST_MCP=1
  cat > .mcp.json <<MCPEOF
{
  "mcpServers": {
    "designdesk": {
      "type": "http",
      "url": "$DESIGNDESK_URL/api/mcp?project=$DESIGNDESK_PROJECT",
      "headers": { "Authorization": "Bearer $DESIGNDESK_TOKEN" }
    }
  }
}
MCPEOF
  if [ "$FIRST_MCP" = "1" ]; then
    echo "🔌 Design Desk のチケット操作（MCP）を設定しました。次回の起動から使えます"
  fi
}

# ここまでで全関数の定義が終わってから実行する（{ } でまとめて読み込ませ、pull後のファイル読み違いを防ぐ）
{
  self_update
  sync_designdesk
  exit 0
}
