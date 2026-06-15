import { readFileSync } from "node:fs";
const mod = await WebAssembly.compile(readFileSync(new URL("../build/sq.wasm", import.meta.url)));
const imports = {}; for (const i of WebAssembly.Module.imports(mod)) (imports[i.module] ??= {})[i.name] = () => 0;
const { exports: ex } = await WebAssembly.instantiate(mod, imports); try { ex._start(); } catch {}
const enc = new TextEncoder(), dec = new TextDecoder();
const writeBuf = (allocName, s) => { const b = enc.encode(s); const p = ex[allocName](b.length); new Uint8Array(ex.memory.buffer, Number(p), b.length).set(b); };
const readOut = (len) => dec.decode(new Uint8Array(ex.memory.buffer, Number(ex.out_ptr()), Number(len)));
const setHairFx = (hair, fx) => { writeBuf("hair_alloc", hair); writeBuf("fx_alloc", fx); };
const events = (hair, fx) => { setHairFx(hair, fx); const len = ex.play_events_resolve(); const s = readOut(len); return s === "" ? [] : s.split("\n"); };
const mime = (m) => { writeBuf("mime_alloc", m); return readOut(ex.resolve_mime()); };
let ok = true; const ck = (c, m) => { if (!c) { console.error("FAIL " + m); ok = false; } };

// 再生境界イベント
ck(events("short", "tear").join(">") === "emotion>hair>fx>reply", "events full");
ck(events("", "").join(">") === "emotion>reply", "events plain");
ck(events("twin", "").join(">") === "emotion>hair>reply", "events hair only");
ck(events("", "heart").join(">") === "emotion>fx>reply", "events fx only");
setHairFx("short", "tear"); ck(ex.event_count() === 4, "count 4");
setHairFx("", ""); ck(ex.event_count() === 2, "count 2");
setHairFx("x", ""); ck(ex.fires_hair() === 1 && ex.fires_fx() === 0, "fires flags");

// mime
ck(mime("") === "audio/mpeg", "mime default");
ck(mime("audio/wav") === "audio/wav", "mime keep");

// 状態機械
ck(ex.should_start_drain(0) === 1 && ex.should_start_drain(1) === 0, "start drain");
ck(ex.should_continue_drain(2, 0) === 1, "continue live");
ck(ex.should_continue_drain(0, 0) === 0, "continue empty");
ck(ex.should_continue_drain(2, 1) === 0, "continue aborted");
ck(ex.should_restart_drain(1) === 1 && ex.should_restart_drain(0) === 0, "restart");
ck(ex.is_idle(0, 0) === 1 && ex.is_idle(1, 0) === 0 && ex.is_idle(0, 3) === 0, "is_idle");
ck(ex.barrier_passes(0, 0) === 1 && ex.barrier_passes(1, 0) === 0, "barrier");
ck(ex.should_resolve_idle(0) === 1 && ex.should_resolve_idle(2) === 0, "resolve idle");

// 多重読み: 同じ hair/fx で events を複数回 + event_count を挟んでも安定 (almide#690)
const a = events("twin", "heart").join(">"); ex.event_count(); const b2 = events("twin", "heart").join(">");
ck(a === "emotion>hair>fx>reply" && a === b2, "multi-read events stable");

console.log(ok ? "wasm OK — speak-queue events + state machine match native" : "FAIL"); if (!ok) process.exit(1);
