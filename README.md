# Design Desk Workspace（枠リポジトリ）

Design Desk と連携して Claude Code で作業するためのテンプレートです。
セットアップ手順は Design Desk のようこそ画面 / アカウントメニューを参照してください。

- `.env` — あなた個人の設定（アクセストークン・担当プロジェクト）。コミットされません
- `CLAUDE.md` — Claude への基本指示（今後、Design Desk からルール・スキルが自動生成されます）
- `CLAUDE.local.md` / `local/` — あなた専用の自由スペース。同期で上書きされず、コミットもされません
- `panel-bridge.mjs` / `Claude連携パネル.command` — ローカルClaude連携パネル（ベータ）の橋渡し。Design Desk のプロフィール設定でONにした人だけが使う。`node panel-bridge.mjs`（またはダブルクリック）で起動し、表示される接続コードをパネルに入力
