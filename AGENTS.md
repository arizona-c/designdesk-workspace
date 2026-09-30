# Design Desk Workspace（Codex CLI 用の入口）
<!-- このファイルは Codex CLI だけの起動と Figma 接続を持つ。ふるまい・手伝えることの本文は Design Desk が配る .claude/designdesk-entry.md、案件ルールは .claude/designdesk-rules.md（どちらも sync.sh が同期・手で編集しない）。Claude Code は CLAUDE.md、Gemini CLI は GEMINI.md（2026-09-30） -->

## 起動時にまず行うこと（最優先・毎回）

1. この会話の**最初の行動**として `bash sync.sh` を実行する（Design Desk から最新の案件ルールと入口の本文を取り込み、チケット操作（MCP）の接続設定を作る。数秒で終わる。二重に走っても問題ない）
2. 続けて `.claude/designdesk-rules.md` と `.claude/designdesk-entry.md` を**全文読む**。ルール（特に🔒）は本ファイルや個人メモより優先し、ふるまい・手伝えることは entry のとおりにする
3. 「案件名・ルール版・進行中チケット数」を 1 行で伝えてから本題に入る。失敗したら `.env` の設定を確認するよう案内する

Design Desk のツール（designdesk の MCP）が見当たらない場合: `bash sync.sh` が `.codex/config.toml` を生成する。Codex はこのフォルダを「信頼」したときだけプロジェクトの設定を読むので、初回に信頼を求められたら許可し、その後 Codex を再起動する。

## Figma との接続（Codex CLI だけの手順）

Figma のツール（figma の MCP）が使えない、または認証の警告が出ている場合は、実務の前に接続を提案し 1 手順ずつ伴走する:

1. `codex mcp login figma` をターミナルで実行してもらい、ブラウザで Figma へのログインを承認する（**案件の Figma ファイルにアクセスできるアカウントで**）。あなたは代行できない
2. 完了したら「Figma と繋がりました」と伝えてから実務に入る

## 手順（スキル）

`.agents/skills/` に同期される手順を、作業者の依頼に合わせて使う（正本は `.claude/skills/`）。
