// 音效：發牌、翻牌、洗牌、收牌與籌碼碰撞，全部用 Web Audio 當場合成、不帶音檔：雙擊開啟（file://）也響得了，
// 公開 repo 也不必查素材授權。瀏覽器規定使用者點過才准出聲，所以第一次真的點擊或按鍵時才建 AudioContext；
// 頁面裡用 el.click() 模擬的點擊不算（navigator.userActivation 是 false），探針那樣點時不建、不出聲。
(function () {
  const V = window.BJK.view;
  // 每一聲的音高與間隔稍微錯開，聽起來才不像同一段錄音一直重播
  const rnd = V.rng(7);

  // 白噪音：牌的摩擦、洗牌的嗒嗒聲都從它濾出來。每個 context 一份
  const noiseOf = new WeakMap();
  function noise(ac) {
    let buf = noiseOf.get(ac);
    if (!buf) {
      buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = buf.getChannelData(0), r = V.rng(11);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      noiseOf.set(ac, buf);
    }
    return buf;
  }

  // 一段濾過的噪音：t 開始、attack 秒爬到 peak，再 decay 秒衰減到聽不見；to 是濾波頻率滑到哪。回傳結束的時間
  function burst(ac, out, t, { type = 'bandpass', freq, to, q = 1, peak, attack = 0.004, decay }) {
    const src = ac.createBufferSource();
    src.buffer = noise(ac);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, rnd() * 0.4, attack + decay + 0.02);
    return t + attack + decay;
  }

  // 很快衰減的正弦：籌碼互碰那一聲「叩」
  function ping(ac, out, t, { freq, peak, decay }) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.02);
    return t + decay;
  }

  // 每一種聲音：(context, 接到哪, 從什麼時間開始, 選項) → 結束的時間。dur 是對應的動畫要演多久，
  // 落桌那一聲排在動畫結束時；context 也可以是 OfflineAudioContext，探針拿它離線算出波形量音量
  const SOUNDS = {
    // 牌從牌靴滑出去的「唰」，落到絨布上一聲輕拍
    deal(ac, out, t, { dur = 0.36 } = {}) {
      burst(ac, out, t, { freq: 2200, to: 4200, q: 0.9, peak: 0.35, attack: 0.012, decay: 0.12 });
      return burst(ac, out, t + Math.max(dur - 0.03, 0.05), { type: 'lowpass', freq: 1400, q: 0.7, peak: 0.45, attack: 0.003, decay: 0.06 });
    },
    // 翻開底牌：掀起來「啪」一下，翻過去落回桌面再一聲
    flip(ac, out, t, { dur = 0.42 } = {}) {
      burst(ac, out, t, { type: 'highpass', freq: 2500, q: 0.7, peak: 0.16, attack: 0.002, decay: 0.035 });
      return burst(ac, out, t + Math.max(dur - 0.04, 0.06), { type: 'lowpass', freq: 1800, q: 0.8, peak: 0.35, attack: 0.002, decay: 0.07 });
    },
    // 洗牌：兩疊牌交錯落下的一長串嗒嗒聲，中間最響，最後疊合起來一聲「唰」
    shuffle(ac, out, t, { dur = 0.8 } = {}) {
      const span = Math.max(dur - 0.22, 0.1), n = 36;
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1), at = t + span * x + (rnd() - 0.5) * span / n;
        burst(ac, out, Math.max(at, t), { freq: 3000 + rnd() * 2000, q: 1.5, peak: 0.1 + 0.18 * Math.sin(Math.PI * x), attack: 0.001, decay: 0.012 });
      }
      return burst(ac, out, t + span + 0.03, { type: 'lowpass', freq: 2500, q: 0.7, peak: 0.3, attack: 0.02, decay: 0.12 });
    },
    // 一局結束收牌：整把牌掃進棄牌盒，一段由亮轉暗的長「唰」
    collect(ac, out, t, { dur = 0.42 } = {}) {
      return burst(ac, out, t, { freq: 3000, to: 900, q: 0.8, peak: 0.3, attack: Math.min(0.08, dur / 3 + 0.01), decay: Math.max(dur, 0.15) });
    },
    // 籌碼落下：兩三顆互碰的「喀啦」，每一下是很短的兩個高音加一點雜音
    chip(ac, out, t) {
      let end = t;
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0, at = t; i < n; i++, at += 0.025 + rnd() * 0.03) {
        const k = 0.92 + rnd() * 0.16, peak = 0.16 * (1 - i * 0.2);
        ping(ac, out, at, { freq: 3100 * k, peak, decay: 0.045 });
        ping(ac, out, at, { freq: 4700 * k, peak: peak * 0.6, decay: 0.03 });
        end = Math.max(end, burst(ac, out, at, { type: 'highpass', freq: 3500, q: 0.7, peak: peak * 0.8, attack: 0.001, decay: 0.012 }), at + 0.045);
      }
      return end;
    },
  };

  // 所有聲音共用一個主音量
  const MASTER = 0.6;
  function chain(ac) {
    const master = ac.createGain();
    master.gain.value = MASTER;
    master.connect(ac.destination);
    return master;
  }

  let ac = null, out = null;
  // 只掛在點擊與按鍵上；舊版 Safari 沒有 navigator.userActivation，就當這次是真的操作。
  // 已經建好但被暫停（iOS 切到背景、來電）的，下一次點擊再叫醒
  function unlock() {
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        out = chain(ac);
      }
      if (ac.state !== 'running') ac.resume().catch(() => {});
    } catch (e) {
      ac = null;   // 建不起來就沒有聲音，遊戲照玩
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) document.addEventListener(type, unlock, true);

  const sfx = {
    on: true,
    // 每種聲音被叫過幾次（關掉音效、還沒點過時也照算）：導演拿它核對每個事件都有出聲
    requested: {},
    // 真的排進喇叭的次數
    played: 0,
    get state() { return ac ? ac.state : 'locked'; },
    play(name, opts) {
      const fn = SOUNDS[name];
      if (!fn) throw new Error(`沒有這個音效：${name}`);
      sfx.requested[name] = (sfx.requested[name] || 0) + 1;
      if (!sfx.on || !ac || ac.state !== 'running' || document.hidden) return;
      fn(ac, out, ac.currentTime + 0.005, opts);
      sfx.played++;
    },
    SOUNDS, chain,
  };

  V.sfx = sfx;
})();
