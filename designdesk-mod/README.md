# Design Desk の Mod（ベータ・Claude Code 2.1.287 以上）

Claude Code のターミナルの中に、Design Desk の**ホームと同じもの**を出します: まずやること（見出し）・いまのチケットのカード・担当しているチケットの一覧（あなたの順番）。カードのボタンで一言（「Design Desk の #62 を進めて」など）をあなたの言葉として送れるので、ブラウザを開かずに進められます。

試した版: Claude Code 2.1.290（Mac・ターミナル）。描いた UI が見えるのは、ターミナルと Desktop アプリの Code タブだけです（Remote Control の claude.ai / スマホの画面には出ません）。

## 使い方

作業フォルダ（この README の 1 つ上）で起動します:

```
claude --plugin-dir ./designdesk-mod
```

- 広い端末（144 列以上）では起動時に右に pane が出ます。狭い端末では `/dd` で開きます（Esc で閉じる）
- `g` いまのカードの「続きを進めて」を送る / `1`〜`5` ほかの頼み方 / `l` あとで（並びの末尾へ）/ `r` 取り直し
- Design Desk の道具が呼ばれたあと（AI がチケットを動かした・報告を書いた）は自動で取り直します。60 秒ごとにも取り直します

## 何に触るか（信頼のために）

Mod はあなたの権限で動きます。この Mod が触るのは次の 2 つだけです:

- 作業フォルダの `.env` を読む（`DESIGNDESK_URL` / `DESIGNDESK_TOKEN` / `DESIGNDESK_PROJECT`）
- `DESIGNDESK_URL` の `/api/mod/home` に HTTP で読み書き（読む: ホームの中身 / 書く: 「あとで」の並びだけ）

ほかのファイル・プロセス・環境変数・ネットワークには触れません。`claude plugin validate ./designdesk-mod` の `calls:` 行で確かめられます。

## テスト

```
cd designdesk-mod && claude plugin test
```
