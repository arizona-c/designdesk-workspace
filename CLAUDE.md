# Design Desk Workspace（Claude Code 用の入口）
<!-- このファイルは Claude Code だけの起動と Figma 接続を持つ。ふるまい・手伝えることの本文は Design Desk が配る .claude/designdesk-entry.md、案件ルールは .claude/designdesk-rules.md（どちらも sync.sh が同期・手で編集しない）。Codex CLI は AGENTS.md、Gemini CLI は GEMINI.md（2026-09-30・AI への言葉は Design Desk の 1 か所から） -->

## 起動時にまず行うこと（最優先・毎回）

この会話の**最初の行動**として、他の何よりも先に `bash sync.sh` を実行する（Claude デスクトップアプリの Code モードでは起動時の自動実行が働かないため。ターミナル版で既に自動実行されていても二重に走って問題ない・数秒で終わる）。
実行後は「案件名・ルール版・進行中チケット数」を 1 行で伝えてから本題に入る。失敗したら `.env` の設定を確認するよう案内する。

## 案件ルールとふるまい（Design Desk から自動同期）

下の 2 ファイルは起動時に同期され、ここで取り込まれる。**ルール（特に🔒）は本ファイルや個人メモより優先**。ファイルが無い / 同期時刻が古いときは `bash sync.sh`。

@.claude/designdesk-rules.md

@.claude/designdesk-entry.md

## Figma との接続（Claude Code だけの手順・毎回の起動時に確認）

セッション開始時に **Figma のツール（mcp__figma__…）が使えない、または「MCP server needs authentication」の警告が出ている**場合は、実務に入る前に接続を提案し、1 手順ずつ伴走する:

1. **Figma プラグインの導入**（未導入の場合）: 実行してよいか確認のうえ、Bash で `claude plugin install figma@claude-plugins-official` を実行する。失敗したらコマンドをコピーしてもらいターミナルで実行 → Claude を再起動してもらう
2. **Figma へのログイン**（未認証の場合）: 「`/mcp` と入力 → Figma を選択 → ブラウザで承認」を案内する。本人の操作が必要（あなたは代行できない）。トークンの発行は不要。**必ず案件の Figma ファイルにアクセスできるアカウントで**
3. 完了したら「Figma と繋がりました」と伝えてから実務に入る

Design Desk のツール（mcp__designdesk__…）が見当たらない場合は、`.env` 設定後に一度 Claude を再起動すると有効になる（起動時の同期が接続設定を生成するため）。
