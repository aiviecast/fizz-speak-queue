# fizz-speak-queue

逐次再生キューの**状態機械 + 再生境界イベント導出**。Almide 1 コアを native + wasm へ。
openaituber `src/speech/speakQueue.ts` の判定ロジックを切り出した単一責任部品(§5 音声系)。

LLM がストリームした文の TTS クリップを**順序保証で逐次再生**し、各クリップの再生直前に
emotion / hair / fx / 返答カードを同期発火する。その「**何をどの順で発火するか**」と
「**いつ drain を回すか(再入判定)**」だけが純粋なのでここに集約する。

> 実際の `playAudio` / delegate コールバック / Promise は host の async I/O。元コードも
> 「delegate で decouple して unit-test 可能に」と明言しており、その純粋部分がこの部品。

## 再生境界イベント

item の再生直前に発火する副作用の順序(元コード `drain()` と一致):

```
emotion  →  (hair if 非空)  →  (fx if 非空)  →  reply  →  playAudio
```

| 関数 | 説明 |
|---|---|
| `play_events(hair, fx)` | 発火イベント種別を順に(`["emotion", "hair"?, "fx"?, "reply"]`) |
| `event_count(hair, fx)` | 発火数(常時 2 + hair/fx) |
| `fires_hair(hair)` / `fires_fx(fx)` | 値が非空なら発火 |
| `resolve_mime(mime)` | 既定 `audio/mpeg`(元: `audioMime ?? "audio/mpeg"`) |

## キュー状態機械

host が持つ `{pending, playing, aborted}` に対する純粋な遷移判定:

| 関数 | 元コード対応 |
|---|---|
| `should_start_drain(playing)` | `enqueue`: 再生中でなければ drain 起動 |
| `should_continue_drain(pending, aborted)` | `while (queue.length && !aborted)` |
| `should_restart_drain(pending)` | finally: cancel 後に取り残された item の救済 |
| `is_idle(playing, pending)` / `barrier_passes(...)` | `waitForIdle` のバリア条件 |
| `should_resolve_idle(pending)` | 全再生完了 → 待機者を起こす |

これらは元コードのコメントが「バグの巣」と強調する再入ロジックを 1 箇所にまとめてテスト可能にしたもの。

## wasm 境界

状態機械は Bool/Int を Float で受け渡し(`playing`/`aborted` は 0/1、`pending` は件数)。
hair/fx/mime の文字列入力は `from_list(to_list)` コピー経由(almide#690 回避)、
`play_events` / `mime` 出力は `out_ptr` で読む。
[`browser/speak-queue-driver.js`](browser/speak-queue-driver.js) に、判定を wasm へ委譲した
`SpeakQueue` 参照実装(元 delegate 契約そのまま)を同梱。

## ビルド / テスト

```sh
almide test spec/speak_queue_test.almd
almide build src/main.almd -o build/fizz-speak-queue
almide build src/bridge.almd --target wasm -o build/sq.wasm
node test/wasm-smoke.mjs
```

Almide v0.27.7 で native / wasm とも green。
