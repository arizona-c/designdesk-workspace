# Design Desk Workspace（Gemini CLI 用の入口）
<!-- このファイルは Gemini CLI だけの起動と Figma 接続を持つ。ふるまい・手伝えることの本文は Design Desk が配る .claude/designdesk-entry.md、案件ルールは .claude/designdesk-rules.md（どちらも sync.sh が同期・手で編集しない）。Claude Code は CLAUDE.md、Codex CLI は AGENTS.md（2026-09-30） -->

## 起動時にまず行うこと（最優先・毎回）

起動時のフック（`.gemini/settings.json` の SessionStart）が `bash sync.sh` を自動で実行し、最新の案件ルールと入口の本文を取り込む。フックが動いていない様子（同期のメッセージが出ない・下のファイルが無い / 古い）なら、この会話の最初の行動として `bash sync.sh` を実行する。二重に走っても問題ない。
実行後は「案件名・ルール版・進行中チケット数」を 1 行で伝えてから本題に入る。失敗したら `.env` の設定を確認するよう案内する。

## 案件ルールとふるまい（Design Desk から自動同期）

**ルール（特に🔒）は本ファイルや個人メモより優先**。

@.claude/designdesk-rules.md

@.claude/designdesk-entry.md

## Figma との接続（Gemini CLI だけの手順）

Figma のツール（figma の MCP）が使えない、または認証の警告が出ている場合は、実務の前に接続を提案し 1 手順ずつ伴走する:

1. `/mcp auth figma` を入力してもらい、ブラウザで Figma へのログインを承認する（**案件の Figma ファイルにアクセスできるアカウントで**）。あなたは代行できない
2. 完了したら「Figma と繋がりました」と伝えてから実務に入る

Design Desk のツール（designdesk の MCP）が見当たらない場合は、`bash sync.sh` のあと Gemini CLI を一度再起動する（同期が `.gemini/settings.json` の接続設定を生成するため）。

## 手順（スキル）

`.agents/skills/` に同期される手順を、作業者の依頼に合わせて使う（正本は `.claude/skills/`）。
