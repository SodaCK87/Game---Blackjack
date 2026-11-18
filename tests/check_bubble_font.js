// 守對白字型的產出檔（app/lib/bubble_font.js，由 tools/make_bubble_font.js 產生）：跟產生器與程式裡的對白同步；
// 程式裡每一句對白的每一個字子集都真的有（讀 WOFF2 裡的 cmap，不是信產出檔自己記的字表）；授權文字跟著發布。
// 純讀檔，CI 也跑：CI 上沒有原字型（tools/_fonts/ 不進版控），原字型的雜湊只在這台有檔時比。
// 字型在瀏覽器裡有沒有載起來、載好後泡泡有沒有重擺、載不起來時退回系統字，在 check_bubble.js 開瀏覽器量。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const FONT = require('../tools/make_bubble_font');

function loadFont(src = fs.readFileSync(FONT.TARGET, 'utf8')) {
  const window = {};
  // 只要資料：FontFace 換成什麼都不做的假貨，ready 不會被叫到
  vm.runInNewContext(src, { window, FontFace: function () { this.load = () => new Promise(() => {}); }, console });
  return window.BJK.view.bubbleFont;
}
const woff2Of = font => Buffer.from(font.url.split(',')[1], 'base64');

// ---- 讀 WOFF2：表目錄、brotli 解開、cmap（格式 4 與 12）----
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT',
  'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function woff2Tables(buf) {
  assert.strictEqual(buf.toString('ascii', 0, 4), 'wOF2', '不是 WOFF2');
  const count = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('UIntBase128 太長'); };
  const dir = [];
  for (let i = 0; i < count; i++) {
    const flags = buf[p++];
    const tag = (flags & 0x3f) === 63 ? buf.toString('ascii', (p += 4) - 4, p) : KNOWN[flags & 0x3f];
    const version = flags >> 6, orig = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : orig });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(p, p + compressed));
  const tables = {};
  let at = 0;
  for (const t of dir) { tables[t.tag] = { start: at, data: data.subarray(at, at + t.length) }; at += t.length; }
  assert.strictEqual(at, data.length, `表的長度加起來 ${at}，解開的資料 ${data.length}：目錄讀錯了`);
  return { tables, data, dirEnd: p, compressed };
}
// 回傳 Map(字 → glyph id)，id 0 是缺字
function cmapOf(cmap) {
  const n = cmap.readUInt16BE(2);
  const subs = Array.from({ length: n }, (_, i) => ({ pid: cmap.readUInt16BE(4 + i * 8), eid: cmap.readUInt16BE(6 + i * 8), off: cmap.readUInt32BE(8 + i * 8) }));
  const pick = subs.find(s => s.pid === 3 && s.eid === 10) || subs.find(s => s.pid === 3 && s.eid === 1) || subs.find(s => s.pid === 0);
  assert.ok(pick, 'cmap 沒有 Unicode 的子表');
  const t = cmap.subarray(pick.off), out = new Map();
  const format = t.readUInt16BE(0);
  if (format === 12) {
    for (let g = 0, groups = t.readUInt32BE(12); g < groups; g++) {
      const start = t.readUInt32BE(16 + g * 12), end = t.readUInt32BE(20 + g * 12), gid = t.readUInt32BE(24 + g * 12);
      for (let c = start; c <= end; c++) out.set(String.fromCodePoint(c), gid + c - start);
    }
  } else if (format === 4) {
    const segs = t.readUInt16BE(6) / 2, ends = 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = t.readUInt16BE(ends + s * 2), start = t.readUInt16BE(starts + s * 2), delta = t.readInt16BE(deltas + s * 2), range = t.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid = range ? t.readUInt16BE(ranges + s * 2 + range + (c - start) * 2) : c;
        if (range && gid) gid += delta; else if (!range) gid += delta;
        out.set(String.fromCharCode(c), gid & 0xffff);
      }
    }
  } else {
    throw new Error(`沒寫讀 cmap 格式 ${format} 的方法`);
  }
  return out;
}
const glyphsOf = buf => { const m = cmapOf(woff2Tables(buf).tables.cmap.data); return new Set([...m].filter(([, g]) => g).map(([c]) => c)); };
const missing = (text, have) => [...new Set(text)].filter(c => !have.has(c)).join('');

// 從子集真的拿掉一個字：格式 4 裡那個字單獨一段時，把它的 idDelta 改成對到 glyph 0（缺字），重新壓回 WOFF2
function dropGlyph(buf, ch) {
  const { tables, data, dirEnd } = woff2Tables(buf);
  const cmap = tables.cmap.data, n = cmap.readUInt16BE(2);
  const out = Buffer.from(data);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const off = cmap.readUInt32BE(8 + i * 8), t = cmap.subarray(off);
    if (t.readUInt16BE(0) !== 4) continue;
    const segs = t.readUInt16BE(6) / 2, ends = 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2, c = ch.charCodeAt(0);
    for (let s = 0; s < segs; s++) {
      if (t.readUInt16BE(ends + s * 2) === c && t.readUInt16BE(starts + s * 2) === c && t.readUInt16BE(ranges + s * 2) === 0) {
        out.writeUInt16BE((0x10000 - c) & 0xffff, tables.cmap.start + off + deltas + s * 2);
        hit++;
      }
    }
  }
  if (!hit) return null;
  const packed = zlib.brotliCompressSync(out);
  const whole = Buffer.concat([buf.subarray(0, dirEnd), packed]);
  whole.writeUInt32BE(whole.length, 8);
  whole.writeUInt32BE(packed.length, 20);
  return whole;
}

test('bubble_font.js 跟產生器、程式裡的對白同步，子集沒被手改', t => {
  const font = loadFont();
  assert.strictEqual(font.source.script, FONT.scriptHash(), '改了 tools/make_bubble_font.js，重跑 node tools/make_bubble_font.js');
  const want = FONT.charset();
  assert.strictEqual(font.chars, [...want].filter(c => !font.lacking.includes(c)).join(''),
    `對白改了（多了「${missing(want, new Set(font.chars))}」、用不到「${missing(font.chars, new Set(want))}」），重跑 node tools/make_bubble_font.js`);
  assert.strictEqual(FONT.sha(woff2Of(font)), font.source.woff2, '產出檔裡的子集被改過');
  if (fs.existsSync(FONT.FONT)) assert.strictEqual(FONT.sha(fs.readFileSync(FONT.FONT)), font.source.font, '換了原字型，重跑 node tools/make_bubble_font.js');
  else t.diagnostic('這台沒有原字型（CI），原字型的雜湊略過');
});

test('程式裡每一句對白（含插進去的名字、動作名）與名牌的每一個字，子集的 cmap 都有；子集收的就是產出檔記的那些字', t => {
  const font = loadFont(), have = glyphsOf(woff2Of(font));
  const { chars } = FONT.dialogueText(FONT.appSources().js);
  t.diagnostic(`對白用到 ${[...chars].length} 個字，子集共 ${have.size} 個字，WOFF2 ${(woff2Of(font).length / 1024).toFixed(1)} KB`);
  assert.strictEqual(missing(chars + FONT.cssText(FONT.appSources().css), have), '', '子集缺字');
  assert.deepStrictEqual([...have].sort().join(''), [...font.chars].sort().join(''), 'cmap 跟產出檔記的字表不一樣：讀法或產生器有錯');
  assert.ok(chars.includes('阿') && chars.includes('虎') && chars.includes('停'), `掃不到插進句子的名字或動作名：${chars}`);
});

test('陽性對照：從子集拿掉一個常用字，要判成缺字', () => {
  const font = loadFont(), buf = woff2Of(font);
  const { chars } = FONT.dialogueText(FONT.appSources().js);
  // 挑對白裡第一個在 cmap 單獨成一段的常用字（子集裡相鄰的字很少，幾乎每個都是）
  const ch = [...'你的了是牌'].find(c => chars.includes(c) && dropGlyph(buf, c));
  assert.ok(ch, '找不到能拿掉的字，量法要改');
  const broken = dropGlyph(buf, ch);
  assert.strictEqual(missing(chars, glyphsOf(broken)), ch);
});

test('陽性對照：程式裡加一句含冷僻字的對白、AI 改個冷僻的名字，要判成缺字與產出檔過期', () => {
  const font = loadFont(), have = glyphsOf(woff2Of(font));
  const src = FONT.appSources(), file = 'js/view/director.js', director = src.js[file];
  const say = "say('deal', '下注結束，發牌！');";
  assert.ok(director.includes(say), '破壞沒有命中');
  const added = { ...src, js: { ...src.js, [file]: director.replace(say, `${say} say('idle', '饕餮之徒請入座。');`) } };
  assert.deepStrictEqual([...missing(FONT.dialogueText(added.js).chars, have)].sort(), [...'饕餮之徒座'].sort());
  assert.notStrictEqual(FONT.charset(added), font.chars, '加了對白卻沒判成過期');
  // 名字是 SEATS 裡的字串，經 popLine → FX.pop(line) → LINES／meta → SEATS 一路追到
  const name = "name: '阿美'";
  assert.ok(director.includes(name), '破壞沒有命中');
  const renamed = { ...src.js, [file]: director.replace(name, "name: '阿燊'") };
  assert.strictEqual(missing(FONT.dialogueText(renamed).chars, have), '燊');
});

test('陽性對照：改了產生器，要判成過期', () => {
  const script = fs.readFileSync(require.resolve('../tools/make_bubble_font'), 'utf8');
  assert.ok(script.includes("const PUNCT = '"), '破壞沒有命中');
  assert.notStrictEqual(FONT.scriptHash(script.replace("const PUNCT = '", "const PUNCT = '※")), loadFont().source.script);
});

// 「值」算：pop 的第一個引數用到 LABELS，整個物件的字串都收（多收不會錯，少收才會）
test('掃法本身：註解、物件的鍵、函式宣告、正規表示式、pop 的座標不算對白；樣板字串裡插的變數照宣告追', () => {
  const js = {
    'a.js': [
      '// say(\'註解\')',
      "const who = n > 1 ? `第 ${n} 手` : '輪到你';",
      "const LABELS = { 鍵: '值' };",
      'function say(text) { show(text); }',
      'const re = /say\\(/g;',
      "say(`${who}：要牌？`);",
      "FX.pop(LABELS.x, { y: '座標' });",
    ].join('\n'),
  };
  assert.strictEqual(FONT.dialogueText(js).chars, [...new Set('第 手輪到你：要牌？值')].sort().join(''));
});

test('授權文字跟著發布：app/lib/bubble_font_ofl.txt 是 OFL-1.1，產出檔開頭寫了字型名稱、版本與授權', () => {
  const ofl = fs.readFileSync(FONT.LICENSE_OUT, 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /LXGW WenKai/);
  if (fs.existsSync(FONT.LICENSE)) assert.strictEqual(ofl, fs.readFileSync(FONT.LICENSE, 'utf8'), '授權文字跟原字型附的不一樣');
  const head = fs.readFileSync(FONT.TARGET, 'utf8').split('\n').slice(0, 6).join('\n');
  const font = loadFont();
  assert.ok(head.includes(font.name) && head.includes(`Version ${font.version}`) && head.includes('OFL-1.1') && head.includes('bubble_font_ofl.txt'), head);
  assert.ok(!/^\s*(import|export)\s/m.test(fs.readFileSync(FONT.TARGET, 'utf8')), 'app/lib 不在 check_file_protocol 的 ES module 掃描範圍內，這裡自己擋');
});
