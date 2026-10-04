# Design Desk Workspace（枠リポジトリ）

Design Desk と連携して手元の AI（Claude Code / OpenAI Codex CLI / Google Gemini CLI のいずれか）で作業するためのテンプレートです。
セットアップ手順は Design Desk の左下「AI との接続方法」を参照してください。

- `.env` — あなた個人の設定（アクセストークン・担当プロジェクト）。コミットされません
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — それぞれ Claude Code / Codex CLI / Gemini CLI が読む入口。AI ごとに違う起動と Figma 接続だけを書き、ふるまい・手伝えることの本文は共通の `.claude/designdesk-entry.md`、案件ルールは `.claude/designdesk-rules.md`（どちらも `sync.sh` が Design Desk から同期。手で編集しない）
- `.mcp.json` / `.codex/config.toml` / `.gemini/settings.json` — 各ツールの接続設定。`sync.sh` が生成します（トークンを含むためコミットされません）
- `.claude/skills/` — 手順（スキル）の正本。`sync.sh` が `.agents/skills/` へ複製し、Codex・Gemini も同じ手順を使えます
- `Codexで開始.command` / `Geminiで開始.command` — 同期してから各ツールを起動（Mac・ダブルクリック）
- `CLAUDE.local.md` / `local/` — あなた専用の自由スペース。同期で上書きされず、コミットもされません
- `panel-bridge.mjs` / `Claude連携パネル.command` — ローカルClaude連携パネル（ベータ）の橋渡し。Design Desk のプロフィール設定でONにした人だけが使う。**作業フォルダの中で** `node panel-bridge.mjs`（またはダブルクリック）で起動し、表示される接続コードをパネルに入力。Claude Code CLI が無くても、Claudeデスクトップアプリ同梱の本体を自動で使う（Node.js は必要）。起動時に Claude のログイン状態を確かめ、確認できなければやることを表示する。別の Mac で動かして手元のブラウザから使うときは SSH に `-L 47831:localhost:47831` を足す（SSH 越しでキーチェーンがロックされていると認証を読めないので `security unlock-keychain ~/Library/Keychains/login.keychain-db`）
