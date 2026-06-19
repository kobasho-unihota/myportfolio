# Shogo Portfolio and Personal Tools

ポートフォリオと個人開発ツールをまとめて管理するリポジトリです。

## 公開URL

- ポートフォリオ: https://kobasho-unihota.github.io/myportfolio/
- ツール一覧: https://kobasho-unihota.github.io/myportfolio/#apps

## 構成

`apps/` 以下に、用途別の小型Webアプリを統合しています。

### 家計・お金

- `BestPrice`: 商品の単価比較
- `pocket-contrib-calculator`: お小遣い計算
- `tatekae`: 立て替え入力
- `bonus-splitter`: ボーナス分配

### 健康・ライフログ

- `BodyBank`: 体内エネルギー収支
- `IUITracker`: 治療サイクル管理

### 生活支援

- `fukan-weather`: 複数地点の天気表示
- `poke-sapo`: ゲーム編成支援

## 開発方針

このリポジトリを全アプリの唯一の開発元とします。

- アプリの実装は `apps/<app-name>/` で編集します。
- 個別リポジトリは既存URLから統合先へ転送する互換レイヤーです。
- 修正を個別リポジトリへ戻したり、両方を同期したりする運用は行いません。
- `bonus-splitter` のNext.jsソースは `apps/bonus-splitter/source/`、公開用の静的出力は `apps/bonus-splitter/` に置きます。
