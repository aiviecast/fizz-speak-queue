// speak-queue-driver.js — 逐次再生キューのグルー例。
// 「何をどの順で発火するか」「いつ drain を回すか」= Almide(wasm)、
// 実際の playAudio / delegate コールバック / Promise = host の async I/O。
//
// 元 speakQueue.ts と同じ delegate 契約をそのまま使い、判定だけ wasm に委譲する。
export async function loadSpeakQueue(wasmUrl) {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  const mod = await WebAssembly.compile(bytes);
  const imports = {}; for (const i of WebAssembly.Module.imports(mod)) (imports[i.module] ??= {})[i.name] = () => 0;
  const { exports: ex } = await WebAssembly.instantiate(mod, imports); try { ex._start(); } catch {}
  const enc = new TextEncoder(), dec = new TextDecoder();
  const writeBuf = (allocName, s) => { const b = enc.encode(s); const p = ex[allocName](b.length); new Uint8Array(ex.memory.buffer, Number(p), b.length).set(b); };
  const readOut = (len) => dec.decode(new Uint8Array(ex.memory.buffer, Number(ex.out_ptr()), Number(len)));

  const core = {
    // item の再生境界で発火するイベント種別を順に返す: ["emotion", "hair"?, "fx"?, "reply"]。
    playEvents(hair = "", fx = "") { writeBuf("hair_alloc", hair); writeBuf("fx_alloc", fx); return readOut(ex.play_events_resolve()).split("\n"); },
    resolveMime(mime = "") { writeBuf("mime_alloc", mime); return readOut(ex.resolve_mime()); },
    shouldStartDrain(playing) { return ex.should_start_drain(playing ? 1 : 0) === 1; },
    shouldContinueDrain(pending, aborted) { return ex.should_continue_drain(pending, aborted ? 1 : 0) === 1; },
    shouldRestartDrain(pending) { return ex.should_restart_drain(pending) === 1; },
    isIdle(playing, pending) { return ex.is_idle(playing ? 1 : 0, pending) === 1; },
    barrierPasses(playing, pending) { return ex.barrier_passes(playing ? 1 : 0, pending) === 1; },
    shouldResolveIdle(pending) { return ex.should_resolve_idle(pending) === 1; },
  };

  // 元 speakQueue.ts の SpeakQueue を、判定を core に委譲して再構成した参照実装。
  // delegate: { playAudio(audio, mime)->Promise, setEmotion, setReply, setHair?, setFx?, onSpeakingChange? }
  class SpeakQueue {
    constructor(delegate) { this.delegate = delegate; this.queue = []; this.playing = false; this.aborted = false; this.idleResolvers = []; }
    enqueue(item) { this.queue.push(item); if (core.shouldStartDrain(this.playing)) void this.#drain(); }
    clear() { this.queue = []; this.aborted = true; const rs = this.idleResolvers.splice(0); rs.forEach((r) => r()); }
    get pending() { return this.queue.length; }
    waitForIdle() { if (core.barrierPasses(this.playing, this.queue.length)) return Promise.resolve(); return new Promise((r) => this.idleResolvers.push(r)); }
    async #drain() {
      this.playing = true; this.aborted = false; this.delegate.onSpeakingChange?.(true);
      try {
        while (core.shouldContinueDrain(this.queue.length, this.aborted)) {
          const item = this.queue.shift();
          // wasm が決めた発火順どおりに delegate を呼ぶ。
          for (const ev of core.playEvents(item.hair ?? "", item.fx ?? "")) {
            if (ev === "emotion") this.delegate.setEmotion(item.emotion);
            else if (ev === "hair") this.delegate.setHair?.(item.hair);
            else if (ev === "fx") this.delegate.setFx?.(item.fx);
            else if (ev === "reply") this.delegate.setReply(item.text);
          }
          try { await this.delegate.playAudio(item.audio, core.resolveMime(item.audioMime ?? "")); }
          catch (e) { console.error(`[speakQueue] playback error on "${item.text.slice(0, 80)}"`, e); }
        }
      } finally {
        this.playing = false; this.aborted = false;
        if (core.shouldRestartDrain(this.queue.length)) void this.#drain();
        else { this.delegate.onSpeakingChange?.(false); if (core.shouldResolveIdle(this.queue.length)) { const rs = this.idleResolvers.splice(0); rs.forEach((r) => r()); } }
      }
    }
  }
  return { core, SpeakQueue };
}
