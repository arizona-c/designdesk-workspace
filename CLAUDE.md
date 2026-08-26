# Design Desk Workspace

Arizona Creative の UIデザイナーが Claude Code で案件作業をするための作業場。
日本語で応答する。タイムゾーンは Asia/Tokyo。

- 担当プロジェクトは `.env` の `DESIGNDESK_PROJECT` を参照
- Design Desk との同期（ルール・スキルの自動生成）と MCP 接続は順次有効化される。
  それまでは、案件のルール・画面一覧・スキルは Design Desk の画面で確認すること
- 個人メモや自分専用の指示は `CLAUDE.local.md` と `local/` に書く（同期で上書きされない）
