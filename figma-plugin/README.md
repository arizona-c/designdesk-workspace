# Design Desk Figmaプラグイン

Figma の中から、自分のチケットの確認・選択中 Frame の紐づけ・キャプチャ登録・列移動（作業中 / レビュー提出）・コンポーネント同期・デザインシステム同期ができる。

## 入れ方（2通り）

### A. Figma Community から（公開後・審査済み版）
1. Figma で Plugins → 「Design Desk」を検索して実行
2. 初回に、プロジェクトID（例: app-dev）と、プラグイン用に発行した個人アクセストークン（Design Desk のアカウントメニュー → アクセストークン）を入力
3. 自社環境に Design Desk を設置している組織は「接続先を変更」を開いて自社の URL を入力（既定は designdesk.arizona-c.com）

### B. 開発版として読み込む（審査を待たずに最新を使う・従来どおり）
1. Figma デスクトップアプリで任意のファイルを開く
2. Plugins → Development → **Import plugin from manifest…** で、このフォルダの `manifest.json` を選ぶ
3. Plugins → Development → Design Desk で起動

A と B は同時に入っていてもよい。緊急の修正は B が先に届き、A は審査（更新のたび）を経て反映される。

## 補足
- 通信先は利用者が設定した Design Desk のサーバーだけ（`manifest.json` の networkAccess は独立設置の組織に対応するため `*` とし、理由を記載）
- `figma.fileKey` は組織の非公開プラグイン専用の API のため、Community 版・開発版とも取得できない。ファイルごとに初回だけ URL を貼ってもらい、プラグインが記憶する
- トークン・接続先は Figma の clientStorage に保存する。Figma ファイルには何も書き込まない
- プライバシーポリシー: https://designdesk.arizona-c.com/privacy

## Community への公開手順（オーナー作業・Figma デスクトップアプリで行う）
`COMMUNITY.md` を参照。
