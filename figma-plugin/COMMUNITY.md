# Community 公開の手順と掲載文（2026-09-08 作成）

## 事前に用意するもの
- アイコン 128×128（`icon-128.png` あり）
- カバー画像 1920×960（要作成。顧客名・実案件のデータを写さない。サンプル案件のボードとプラグイン画面の合成が無難）
- 掲載文（下記）、タグ、サポート連絡先、プライバシーポリシー URL（https://designdesk.arizona-c.com/privacy）

## 手順（Figma デスクトップアプリ）
1. このフォルダの `manifest.json` を Plugins → Development → Import plugin from manifest… で読み込む（既に読み込み済みならそのまま）
2. Plugins → Development → Design Desk の右クリック（または「…」）→ **Publish…**
3. 公開者を **Arizona Creative（組織）** にする。名前 / タグライン / 説明 / タグ / カバー / アイコン / サポート連絡先 / プライバシーポリシー URL を入力
4. 「Submit for review」。Figma の審査は数日〜2週間。承認されると Community に載り、`manifest.json` の `id` が Figma 発行の ID に書き換わる（この変更はコミットする）
5. 以後の更新は同じ画面から「Publish new version」。更新のたびに審査がある。急ぎの修正は開発版（README の B）で先に配る

## 掲載文（案）

**名前**: Design Desk

**タグライン（日本語）**: Design Desk のチケットを Figma の中から確認・更新する連携プラグイン

**Tagline (EN)**: Companion plugin for Design Desk — view and update your design tickets without leaving Figma.

**説明（日本語）**
Design Desk（UIデザインチーム向けの業務基盤）の利用者向けの連携プラグインです。利用には Design Desk のアカウントと個人アクセストークンが必要です。

できること
- 自分が担当・レビュー中のチケットの一覧と詳細
- 選択中の Frame をチケットに紐づけ（node-id 付き URL を自動生成）
- 作業前後のキャプチャ（Before / After）をチケットに登録
- チケットを「作業中」「レビュー待ち」へ移動、コメントの投稿
- コンポーネント一覧とデザインシステム（変数・スタイル）の同期（ディレクター向け）

データの扱い
- 通信先は、利用者が設定した Design Desk のサーバーだけです（既定は designdesk.arizona-c.com。自社環境に設置している組織は自社の URL を設定します）。
- 送信するのは、個人アクセストークン、チケットの操作内容、選択した Frame の識別子と書き出し画像、コンポーネント・デザインシステムの構成情報です。Figma ファイルには何も書き込みません。
- プライバシーポリシー: https://designdesk.arizona-c.com/privacy

**Description (EN)**
Companion plugin for Design Desk, a design-operations workspace for UI design teams. A Design Desk account and a personal access token are required.

Features
- See the tickets you own or review, with details
- Link the selected frames to a ticket (node-id URLs are generated for you)
- Attach before/after captures to a ticket
- Move tickets to "In progress" / "Ready for review", post comments
- Sync component inventory and design-system variables/styles (for directors)

Data & privacy
- The plugin talks only to the Design Desk server you configure (default: designdesk.arizona-c.com; self-hosted organizations enter their own URL).
- It sends your personal access token, ticket actions, the IDs and exported images of frames you select, and component/design-system metadata. It never writes to your Figma file.
- Privacy policy: https://designdesk.arizona-c.com/privacy

**タグ（案）**: tickets, workflow, design ops, review, handoff, design system

**サポート連絡先**: Design Desk のプライバシーポリシー記載のメールアドレス
