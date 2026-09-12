#!/bin/bash
# Design Desk 同期スクリプト。手元の AI（Claude Code / Codex CLI / Gemini CLI）の起動時に実行される。
#   Claude Code: .claude/settings.json の SessionStart フック（デスクトップアプリではフックが動かないため CLAUDE.md の指示で最初に実行）
#   Gemini CLI : .gemini/settings.json の SessionStart フック（--hook-json で JSON を返す）
#   Codex CLI  : 「Codexで開始.command」か、AGENTS.md の指示で最初に実行
# 手動実行もOK。やること:
#   1. workspace自体の自動更新（gitで取得したフォルダは git pull／zipで配られたフォルダは Design Desk から雛形を取得して上書き。
#      Figmaプラグインの新版もこれで手元に届く）
#   2. Design Desk から最新ルールを取得して .claude/designdesk-rules.md を更新（3ツール共通の正本）
#   3. チケット操作ツール（MCP）とFigma接続の設定を生成: .mcp.json（Claude）/ .codex/config.toml（Codex）/ .gemini/settings.json（Gemini）
#   4. 手順（スキル）を .claude/skills から .agents/skills（Codex・Gemini 共通）へ複製
# 実行中に自分自身が書き換わると誤動作するため、全体を関数にして末尾のブロックでまとめて実行する
cd "$(dirname "$0")"

# zip配布（git無し）のフォルダ向け: Design Desk から雛形zipを取得して雛形管理のファイルだけ上書きする。
# 個人ファイル（.env / CLAUDE.local.md / local/ / 同期生成物）は雛形に含まれないので触られない。6時間に1回まで
template_update() {
  set -a; [ -f .env ] && . ./.env; set +a
  [ -n "${DESIGNDESK_TOKEN:-}" ] && [ -n "${DESIGNDESK_URL:-}" ] && [ -n "${DESIGNDESK_PROJECT:-}" ] || return 0
  command -v unzip >/dev/null 2>&1 || return 0
  mkdir -p .claude
  local stamp=".claude/.template-synced"
  if [ -f "$stamp" ] && [ -n "$(find "$stamp" -mmin -360 2>/dev/null)" ]; then return 0; fi
  local tmpzip tmpdir
  tmpzip=$(mktemp -t dd-template.XXXXXX) || return 0
  tmpdir=$(mktemp -d -t dd-template.XXXXXX) || { rm -f "$tmpzip"; return 0; }
  if curl -fsS -m 20 -H "Authorization: Bearer $DESIGNDESK_TOKEN" \
      "$DESIGNDESK_URL/api/sync/workspace?project=$DESIGNDESK_PROJECT" -o "$tmpzip" \
     && unzip -o -q "$tmpzip" -d "$tmpdir"; then
    local before after
    before=$(cat CLAUDE.md sync.sh .claude/settings.json 2>/dev/null | cksum)
    cp -R "$tmpdir"/. .
    chmod +x ./*.command 2>/dev/null || true # zip経由だと実行権限が落ちるため（ダブルクリック起動用）
    after=$(cat CLAUDE.md sync.sh .claude/settings.json 2>/dev/null | cksum)
    touch "$stamp"
    if [ "$before" != "$after" ]; then
      echo "⬆️ 作業フォルダの雛形を更新しました（Figmaプラグインの更新が含まれる場合、プラグインは次回起動から最新になります）"
    fi
  else
    echo "⚠ 作業フォルダの自動更新に失敗（オフライン?）。今の版のまま続行します"
  fi
  rm -rf "$tmpzip" "$tmpdir"
}

self_update() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then template_update; return 0; fi
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
  SYNCED_VERSION=$(cat .claude/.synced-version 2>/dev/null | tr -dc '0-9')
  local hdrs=".claude/.sync-headers.tmp"
  if curl -fsS -m 10 -D "$hdrs" -H "Authorization: Bearer $DESIGNDESK_TOKEN" \
    "$DESIGNDESK_URL/api/sync/claude-md?project=$DESIGNDESK_PROJECT" \
    -o .claude/designdesk-rules.md.tmp; then
    mv .claude/designdesk-rules.md.tmp .claude/designdesk-rules.md
    SYNCED_VERSION=$(grep -i '^x-rules-version:' "$hdrs" | tr -dc '0-9')
    echo "${SYNCED_VERSION:-0}" > .claude/.synced-version
    # この同期成功の瞬間、Design Desk側のサイドバーの連携チップも🟢になる（last_used_at更新）
    echo "🔗 Design Desk と連携しました（プロジェクト: $DESIGNDESK_PROJECT）— Web側サイドバーの連携表示も点灯します"
    echo "✅ 最新ルールを同期しました（$(head -1 .claude/designdesk-rules.md | sed 's/# //')）"
    # 起動サマリ: 自分の進行中チケットとAIレビュー待機（ヘッダーから取得）
    local my pend
    my=$(grep -i '^x-dd-my-tickets:' "$hdrs" | tr -dc '0-9')
    pend=$(grep -i '^x-dd-pending-ai-reviews:' "$hdrs" | tr -dc '0-9')
    if [ -n "$my" ]; then
      echo "📋 あなたの進行中チケット: ${my}件 / AIレビュー待機: ${pend:-0}件"
      if [ "${pend:-0}" -gt 0 ]; then
        echo "   → AIに「AIレビュー実行」と伝えると、待機中の検査を行います"
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
  # figma: 公式のリモートMCP（初回利用時にブラウザでFigmaへのログイン許可が出る）。
  # CLIで公式プラグインを入れている人は同じ接続先なので二重にならない
  cat > .mcp.json <<MCPEOF
{
  "mcpServers": {
    "designdesk": {
      "type": "http",
      "url": "$DESIGNDESK_URL/api/mcp?project=$DESIGNDESK_PROJECT",
      "headers": { "Authorization": "Bearer $DESIGNDESK_TOKEN", "X-DD-Synced-Version": "${SYNCED_VERSION:-0}" }
    },
    "figma": {
      "type": "http",
      "url": "https://mcp.figma.com/mcp"
    }
  }
}
MCPEOF
  # Codex CLI（.codex/config.toml・プロジェクト単位の設定は「信頼済み」フォルダでのみ読まれる）
  mkdir -p .codex
  cat > .codex/config.toml <<TOMLEOF
# Design Desk が生成（sync.sh）。トークンを含むためコミットされない
[mcp_servers.designdesk]
url = "$DESIGNDESK_URL/api/mcp?project=$DESIGNDESK_PROJECT"
http_headers = { "Authorization" = "Bearer $DESIGNDESK_TOKEN", "X-DD-Synced-Version" = "${SYNCED_VERSION:-0}" }

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
TOMLEOF
  # Gemini CLI（.gemini/settings.json: 接続設定＋起動時/送信前フック。フックの標準出力は JSON のみ許されるため --hook-json 経由）
  mkdir -p .gemini
  cat > .gemini/settings.json <<GEMEOF
{
  "mcpServers": {
    "designdesk": {
      "httpUrl": "$DESIGNDESK_URL/api/mcp?project=$DESIGNDESK_PROJECT",
      "headers": { "Authorization": "Bearer $DESIGNDESK_TOKEN", "X-DD-Synced-Version": "${SYNCED_VERSION:-0}" }
    },
    "figma": { "httpUrl": "https://mcp.figma.com/mcp" }
  },
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "bash sync.sh --hook-json", "timeout": 60000 } ] } ],
    "BeforeAgent": [ { "hooks": [ { "type": "command", "command": "bash sync.sh --hook-json --if-stale", "timeout": 20000 } ] } ]
  }
}
GEMEOF
  # 手順（スキル）を Codex・Gemini が読む場所へ複製（正本は .claude/skills）
  if [ -d .claude/skills ]; then
    rm -rf .agents/skills && mkdir -p .agents/skills && cp -R .claude/skills/. .agents/skills/
  fi
  if [ "$FIRST_MCP" = "1" ]; then
    echo "🔌 Design Desk のチケット操作（MCP）とFigma接続を設定しました。次回の起動から使えます（Figmaは初回にブラウザで許可を求められます）"
  fi
}

# --hook-json: Gemini CLI のフック用。通常の出力を JSON の systemMessage に包んで返す（stdout に素の文字を出すとフックが失敗するため）
hook_json() {
  local out
  out=$(bash "$0" "$@" 2>/dev/null)
  local esc
  esc=$(printf '%s' "$out" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS="\\n"} {print}' | sed -e 's/\\n$//')
  if [ -n "$esc" ]; then printf '{"systemMessage":"%s"}\n' "$esc"; else printf '{}\n'; fi
  exit 0
}

# --if-stale: メッセージ送信ごとのフック（UserPromptSubmit）から呼ばれる軽い確認。10分に1回まで Design Desk に版だけ問い合わせ、
# 手元の同期版と同じなら何も出さずに終わる。差分がある時だけ本同期を走らせる（ターミナル版で長時間つけっぱなしでも最新に追随する）
stale_check() {
  set -a; [ -f .env ] && . ./.env; set +a
  [ -n "${DESIGNDESK_TOKEN:-}" ] && [ -n "${DESIGNDESK_URL:-}" ] && [ -n "${DESIGNDESK_PROJECT:-}" ] || exit 0
  local stamp=".claude/.stale-checked"
  if [ -f "$stamp" ] && [ -n "$(find "$stamp" -mmin -10 2>/dev/null)" ]; then exit 0; fi
  mkdir -p .claude; touch "$stamp"
  local local_v remote_v
  local_v=$(cat .claude/.synced-version 2>/dev/null | tr -dc '0-9')
  remote_v=$(curl -fsS -m 5 -H "Authorization: Bearer $DESIGNDESK_TOKEN" \
    "$DESIGNDESK_URL/api/sync/claude-md?project=$DESIGNDESK_PROJECT&check=1" 2>/dev/null | tr -dc '0-9')
  [ -n "$remote_v" ] || exit 0
  if [ "$local_v" = "$remote_v" ]; then exit 0; fi
  echo "🔄 案件ルールが v${local_v:-?} → v${remote_v} に更新されていたため同期しました。.claude/designdesk-rules.md を読み直してから続けてください"
  sync_designdesk >/dev/null 2>&1
  exit 0
}

# ここまでで全関数の定義が終わってから実行する（{ } でまとめて読み込ませ、pull後のファイル読み違いを防ぐ）
{
  if [ "${1:-}" = "--hook-json" ]; then shift; hook_json "$@"; fi
  if [ "${1:-}" = "--if-stale" ]; then stale_check; fi
  self_update
  sync_designdesk
  exit 0
}
