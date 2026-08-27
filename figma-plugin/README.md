# Design Desk Figmaプラグイン（開発版）

Figmaの中から、自分のチケットの確認・選択中Frameの紐づけ・列移動（作業中/レビュー提出）ができる。
開発版プラグインのため**Figmaの審査・申請は不要**（Community公開する場合のみ審査あり）。

## 導入手順（1人1回・約1分）

1. **Figmaデスクトップアプリ**で任意のファイルを開く（ブラウザ版では導入不可）
2. メニュー → Plugins → Development → **Import plugin from manifest…**
3. このフォルダの `manifest.json` を選択
4. Plugins → Development → **Design Desk** で起動
5. 初回はプロジェクトID（例: app-dev）と、プラグイン用に発行した個人アクセストークンを入力
   （アカウントメニュー→アクセストークンで「Figmaプラグイン」の名前で発行。既存トークンは無効にならない）

## できること

- 自分の担当/レビュー中チケットの一覧・詳細
- **選択中のFrameをチケットに紐づけ**（複数可・node-idからURL自動生成）
- チケットを「作業中へ」「レビューへ提出」

## 補足

- 通信先は Design Desk 本番（`manifest.json` の networkAccess で制限）
- 開発版では `figma.fileKey` が取得できないため、ファイルごとに初回だけURLを貼ってもらう
  （プラグインが記憶する）。組織プランで正式配布する場合はこの手順は不要になる
- トークン等は Figma の clientStorage に保存（ファイルには書き込まない）
