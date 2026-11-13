# 🔁 前のプラグイン (cloud・frontend・python・security) から移る

[← README に戻る](../README.md)

前のプラグインは、autopilot 1 つにまとめました。前のプラグインを入れたままにすると、hook が重ねて動きます。

## Claude Code on the Web

環境の「セットアップスクリプト」を、README の「プラグインを入れる」の手順 4 の内容に書き換えてください。

## PC の Claude Code

次のコマンドを実行してから、Claude Code を起動し直します。

```bash
claude plugin uninstall security@indiehacker
claude plugin uninstall frontend@indiehacker
claude plugin uninstall python@indiehacker
claude plugin marketplace update indiehacker

claude plugin install autopilot@indiehacker
```
