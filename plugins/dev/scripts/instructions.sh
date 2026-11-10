#!/usr/bin/env bash
# セッションの開始・再開・要約の後に、ユーザーからの指示を Claude に渡す (stdout が文脈に入る)
cat << 'MSG'
ユーザーからの指示:
- 自分の作った PR を claude[bot] のレビューが下書きに戻したときは、指摘を直す (または返信する) push をして CI が通ったら、ユーザーに聞かずに「レビュー可能」に戻してよい (update_pull_request で draft: false)。
- ほかの人が下書きに戻した PR は戻さない。
MSG
