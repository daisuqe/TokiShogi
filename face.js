// 顔（キャラクター）：xwordx の仕組みをそのまま使う。16×16 のドット絵で、
//  肌・髪・服を色で塗り（マスク）、その上に目と口の部品（face/parts/*.png）を重ねる。表情（勝ち・負け）は face/win.png・lose.png
//  部品と色の一覧（XW）は xwordx の player-data.js（GRAVITYFOUR の player.js から作ったもの）と同じ
const FACE = (() => {
  const XW = {"defaults":{"hair":"hair6w","eyes":"eye15","mouth":"mouth1","skinColor":"#FFB985","hairColor":"#000000","clothColor":"#009B0C"},"options":{"hair":["hair1w","hair2w","hair3w","hair4","hair5w","hair6w","hair7","hair8m","hair9m","hair10w","hair11w","hair12w","hair13w","hair14w","hair15","hair16"],"eyes":["eye1","eye2","eye3","eye4","eye5","eye6","eye7","eye8","eye9","eye10","eye11","eye12","eye13","eye14","eye15","eye16","eye17","eye18"],"mouth":["mouth1","mouth2","mouth3","mouth4","mouth5","mouth7","mouth8","mouth9","mouth10"]},"palettes":{"skin":["#FFCDB3","#FFB985","#7F5A3F","#FCC79F"],"hair":["#800000","#4B1515","#813D3C","#7F3100","#000000","#2A2A2A","#DADADA","#FF86CD","#009B0C","#500099","#066F85","#00ACCE","#CEBF00"],"cloth":["#2A2A2A","#000000","#B5B5B5","#00ACCE","#152E4C","#009B0C","#DDB4FF","#EEEEEE","#CD0000","#FFB985","#800000","#005700","#CEBF00","#0D00FF","#C95407","#48164B"]},"layerMasks":{"skin":"0000000007e00ff01ff81ff81ff81ff81ff81ff81ff80ff007e0018000000000","cloth":"0000000000000000000000000000000000000000000000000000000007e00ff0","hair":{"hair1w":"000007f01ff83ff839fc30fc303c201ce007c003c003c003c003400200000000","hair2w":"00000fe01ff83ffc3dfc39fc70fe600e600e600e600e700e781e7e7e00000000","hair3w":"00000fe01ff83ffc3dfc39fc70fe600e600e600e600e700e381c000000000000","hair4":"00000fe01ff83ffc3ffc7ffe6ffe67fe601e601e601e301c0810000000000000","hair5w":"00000fe01ff83ffc3ffc3ffc6ffe64be601e600e200410080000000000000000","hair6w":"00000ff01ff83bfc33fc73fe61fe603e600e6006200410080000000000000000","hair7":"000007f01ff81ffc3dfc31fc30fc200420040004000400080000000000000000","hair8m":"1f003fe03ff8383c300c200c0004000400040004000400080000000000000000","hair9m":"1fe01ff81ff8101c000c00040000000000000000000000000000000000000000","hair10w":"f00ff00ff7ef1ff83dfc39fc30fc200420042004200410080000000000000000","hair11w":"000007e01ff81ff83dfc39fc30fc200c200c200c200c300c381c3e7c381c300c","hair12w":"07e61fff1fff3fff37ff001f000f00070007000f000f000e000e000e00060003","hair13w":"07f01ffc1ffc3ffe2afe52be52ae000600060006000e000e081e0e7e081e000e","hair14w":"07f01ffc1ffc3ffe3bfe31fe30fe207e003e001e001e101e183e1e7e381e300e","hair15":"00000ff01ff81ffc33fc21fc20fc207c001c000c000800000000000000000000","hair16":"0f000f8000000878103c000c000c000400040008000000000000000000000000"}}};
  const KEY = 'toki-avatar';                       // 自分の顔（この端末）。登録していればサーバーにも同じものを送る
  const ok = (key, v) => XW.options[key].includes(v);
  const okColor = (key, v) => XW.palettes[key].includes(v);
  // 形の決まり：w の付く髪型では、mouth8 は選べない（xwordx と同じ）
  function sanitize(a) {
    const d = XW.defaults, o = { ...d };
    if (a && typeof a === 'object') {
      for (const k of ['hair', 'eyes', 'mouth']) if (ok(k, a[k])) o[k] = a[k];
      for (const k of ['skin', 'hair', 'cloth']) { const v = String(a[k + 'Color'] || '').toUpperCase(); if (okColor(k, v)) o[k + 'Color'] = v; }
    }
    if (o.hair.endsWith('w') && o.mouth === 'mouth8') o.mouth = d.mouth;
    return o;
  }
  // 名前から決まる顔（COM や、顔をまだ決めていない人）。いつも同じ顔になる
  function forName(name) {
    const rng = RankCore.mulberry32(RankCore.hash('face:' + String(name)));
    const pick = list => list[Math.floor(rng() * list.length)];
    return sanitize({ hair: pick(XW.options.hair), eyes: pick(XW.options.eyes), mouth: pick(XW.options.mouth),
      skinColor: pick(XW.palettes.skin), hairColor: pick(XW.palettes.hair), clothColor: pick(XW.palettes.cloth) });
  }
  // 順位表などの1行（{ name, avatar }）の顔
  const of = row => row && row.avatar ? sanitize(row.avatar) : forName(row ? row.name : '');
  // 自分の顔
  function mine(name) {
    try { const a = JSON.parse(localStorage.getItem(KEY)); if (a) return sanitize(a); } catch (e) { /* なければ名前から */ }
    return forName(name || 'YOU');
  }
  function saveMine(a) { try { localStorage.setItem(KEY, JSON.stringify(sanitize(a))); } catch (e) { /* 保存できなくても動く */ } }
  const hasMine = () => { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } };

  // マスク（16×16 を 64 桁の16進数で表したもの）の立っているマスに、色を塗る
  function paintMask(canvas, mask, color) {
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(16, 16);
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => parseInt(mask.slice(i * 2, i * 2 + 2), 16));
    const rgb = [1, 3, 5].map(s => parseInt(color.slice(s, s + 2), 16));
    for (let px = 0; px < 256; px++) {
      if (!(bytes[px >> 3] & (128 >> (px & 7)))) continue;
      image.data.set([rgb[0], rgb[1], rgb[2], 255], px * 4);
    }
    ctx.putImageData(image, 0, 0);
  }
  // el（span.face）に顔を描く。expr：'normal'｜'win'｜'lose'
  function paint(el, av, expr = 'normal') {
    if (!el) return el;
    av = sanitize(av);
    el.classList.add('face');
    if (!el.querySelector('canvas')) {
      el.innerHTML = ['skin', 'hair', 'cloth'].map(k => `<canvas data-k="${k}" width="16" height="16"></canvas>`).join('') +
        '<img class="f-eyes" alt=""><img class="f-mouth" alt=""><img class="f-expr" alt="" hidden><img class="f-tear" alt="" hidden>';
    }
    for (const k of ['skin', 'hair', 'cloth']) paintMask(el.querySelector(`canvas[data-k="${k}"]`), k === 'hair' ? XW.layerMasks.hair[av.hair] : XW.layerMasks[k], av[k + 'Color']);
    el.querySelector('.f-eyes').src = `face/parts/${av.eyes}.png`;
    el.querySelector('.f-mouth').src = `face/parts/${av.mouth}.png`;
    setExpr(el, expr);
    return el;
  }
  function setExpr(el, expr) {
    const normal = expr !== 'win' && expr !== 'lose';
    el.querySelector('.f-eyes').hidden = !normal;
    el.querySelector('.f-mouth').hidden = !normal;
    const f = el.querySelector('.f-expr');
    f.hidden = normal;
    if (!normal) f.src = `face/${expr}.png`;
    el.querySelector('.f-tear').hidden = true;
  }
  // 顔の形にだけ、半透明の色を重ねる（どの色の顔でも同じ濃さでかぶる）。目や口の絵が読み込まれたら描き直す
  function tint(el, color) {
    if (!el) return;
    let c = el.querySelector('canvas.f-tint');
    if (!c) { c = document.createElement('canvas'); c.className = 'f-tint'; c.width = c.height = 16; el.append(c); }
    const x = c.getContext('2d');
    const redraw = () => {
      x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, 16, 16);
      for (const l of el.querySelectorAll('canvas[data-k], img')) {
        if (l.hidden || (l.tagName === 'IMG' && !(l.complete && l.naturalWidth))) continue;
        x.drawImage(l, 0, 0, 16, 16);
      }
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color; x.fillRect(0, 0, 16, 16);
    };
    redraw();
    for (const im of el.querySelectorAll('img')) if (!im.complete) im.addEventListener('load', redraw, { once: true });
  }
  const make = (av, cls = '') => { const s = document.createElement('span'); s.className = 'face ' + cls; return paint(s, av); };
  return { XW, sanitize, forName, of, mine, saveMine, hasMine, paint, make, paintMask, tint };
})();
