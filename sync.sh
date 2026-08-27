#!/bin/bash
# Design Desk から最新ルールを取得して .claude/designdesk-rules.md を更新する。
# Claude 起動時に自動実行される（.claude/settings.json の SessionStart フック）。手動実行もOK
cd "$(dirname "$0")"
set -a; [ -f .env ] && . ./.env; set +a
if [ -z "$DESIGNDESK_TOKEN" ] || [ -z "$DESIGNDESK_URL" ] || [ -z "$DESIGNDESK_PROJECT" ]; then
  echo "⚠ .env が未設定のため Design Desk 同期をスキップしました（セットアップ手順を参照）"
  exit 0
fi
mkdir -p .claude
if curl -fsS -m 10 -H "Authorization: Bearer $DESIGNDESK_TOKEN" \
  "$DESIGNDESK_URL/api/sync/claude-md?project=$DESIGNDESK_PROJECT" \
  -o .claude/designdesk-rules.md.tmp; then
  mv .claude/designdesk-rules.md.tmp .claude/designdesk-rules.md
  echo "✅ Design Desk のルールを同期しました（$(head -1 .claude/designdesk-rules.md | sed 's/# //')）"
else
  rm -f .claude/designdesk-rules.md.tmp
  echo "⚠ Design Desk 同期に失敗（オフライン/トークン無効?）。前回のルールのまま続行します"
fi

# Design Desk のチケット操作ツール（MCP）の接続設定を生成する。
# トークンを含むためコミットされない（.gitignore済み）。初回生成時は次回の起動から有効
FIRST_MCP=0; [ -f .mcp.json ] || FIRST_MCP=1
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
exit 0
