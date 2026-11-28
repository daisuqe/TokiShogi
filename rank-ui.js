// ランキング戦の画面まわり：始める・1戦目のあとの登録・結果と順位・順位表
const RankUI = (() => {
  const $ = id => document.getElementById(id);
  let busy = false;

  const msg = text => { const m = $('rankMsg'); m.textContent = text || ''; m.hidden = !text; };
  const place = n => `${n}位`;

  // 「ランキング」：そのまま始まる。1戦目（未登録）は90〜100位の誰か、登録後は近い順位の相手
  async function start() {
    if (busy) return;
    busy = true; msg('');
    try {
      const me = await RankClient.me();
      const opp = await RankClient.opponent();
      if (opp.error || !opp.name) throw new Error(opp.error || 'no opponent');
      startGame('rank', false, {
        name: opp.name, rankLabel: place(opp.rank), strength: RankCore.strengthOf(opp.rating), params: opp.params,
        nonce: opp.nonce, first: !!opp.first, oppRating: opp.rating, myName: me.registered ? me.name : null,
        avatar: opp.avatar || null,   // 相手の顔（ユーザーならその人が決めた顔、COM は名前から決まる顔）
      });
    } catch (e) {
      msg('ランキングにつながりません。しばらくしてからもう一度');
    } finally { busy = false; }
  }

  // 結果の画面（ランキング戦）
  function showResult(text) {
    $('resultRank').textContent = text;
    $('resultRank').hidden = !text;
    $('rankNext').hidden = false;
    $('again').textContent = 'もどる';
    $('result').hidden = false;
  }

  // 1戦目のあと：名前を入力して登録する
  function showEntry(info, preview) {
    const dlg = $('entryDlg'), o = info.rank;
    const ok = preview.registered;
    $('entryMsg').textContent = ok
      ? `名前を入力すると${place(preview.rank)}に登録されます。\n登録後は次の試合からは勝つとランキングが上がり、\n負けるとランキングが下がります。`
      : `${place(preview.rank)}なのでランキングには登録されません。`;
    $('entryLabel').hidden = !ok;
    $('entryYes').hidden = !ok;
    $('entryNo').textContent = ok ? 'Cancel' : 'OK';
    $('entryErr').hidden = true;
    $('entryName').value = '';
    dlg.hidden = false;
    if (ok) $('entryName').focus(); else $('entryNo').focus();

    const close = () => { dlg.hidden = true; };
    const done = text => { close(); showResult(text); };
    $('entryName').oninput = () => { $('entryName').value = RankCore.cleanName($('entryName').value); $('entryErr').hidden = true; };
    $('entryNo').onclick = () => done(ok ? '登録しませんでした。次の試合もランキングに入る前の試合です' : '');
    $('entryYes').onclick = async () => {
      const name = RankCore.cleanName($('entryName').value);
      if (!RankCore.validName(name)) { $('entryErr').textContent = '英大文字（A〜Z）1〜4文字で入力してください'; $('entryErr').hidden = false; return; }
      if (RankCore.rudeName(name)) { $('entryErr').textContent = 'その名前は使えません'; $('entryErr').hidden = false; return; }
      $('entryYes').disabled = true;
      try {
        const r = await RankClient.register(name, { name: o.name, rating: o.oppRating, nonce: o.nonce }, info.win ? 1 : 0, info.margin);
        if (!r.ok) { $('entryErr').textContent = r.error || '登録できませんでした'; $('entryErr').hidden = false; return; }
        done(r.registered ? `${name} ${place(r.rank)}に登録されました` : `${place(r.rank)}なのでランキングには登録されません`);
      } catch (e) {
        $('entryErr').textContent = 'つながりません。しばらくしてからもう一度'; $('entryErr').hidden = false;
      } finally { $('entryYes').disabled = false; }
    };
  }

  // 試合が終わったとき（game.js から呼ばれる）
  async function onEnd(info) {
    const o = info.rank, result = info.win ? 1 : 0;
    try {
      if (o.first) {
        const pv = await RankClient.preview({ name: o.name, rating: o.oppRating }, result, info.margin);
        showEntry(info, pv);
      } else {
        const r = await RankClient.submit(o.nonce, result, info.params);
        if (r.error) throw new Error(r.error);
        const d = r.oldRank - r.newRank;
        const arrow = d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '→';
        showResult(`順位 ${place(r.oldRank)} → ${place(r.newRank)} ${arrow}\nレート ${r.rating}（${r.delta >= 0 ? '+' : ''}${r.delta}）`);
      }
    } catch (e) {
      showResult('順位をつなげませんでした（この試合は順位に入りません）');
    }
  }

  // 順位表
  async function showTable() {
    const dlg = $('tableDlg'), list = $('tableList');
    list.textContent = '';
    dlg.hidden = false;
    $('tableClose').focus();
    try {
      const [rows, me] = await Promise.all([RankClient.ranking(), RankClient.me()]);
      for (const r of rows) {
        const li = document.createElement('li');
        li.className = 'rank-row' + (me.registered && me.name === r.name ? ' me' : '') + (r.isCom ? ' com' : '');
        const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = r.rank;
        // 顔：自分は、この端末で決めた顔。ほかの人はサーバーの顔、COM は名前から決まる顔
        const isMe = me.registered && me.name === r.name;
        const face = typeof FACE !== 'undefined' ? FACE.make(isMe ? FACE.mine(r.name) : FACE.of(r)) : document.createElement('span');
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name + (r.isCom ? '' : ' ★');
        if (r.isCom) { const tag = document.createElement('small'); tag.className = 'com-tag'; tag.textContent = 'COM'; nm.append(tag); }   // COM は小さく薄く
        const rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = r.rating;
        li.append(rk, face, nm, rt);
        list.append(li);
      }
      const mine = list.querySelector('.me');
      if (mine) mine.scrollIntoView({ block: 'center' });
    } catch (e) {
      list.textContent = 'つながりません';
    }
  }

  // ランクマッチの画面：名前・順位を見せて、MATCH START かランキングを見るかを選ぶ
  async function openView() {
    const dlg = $('rankView');
    $('rvErr').hidden = true;
    $('rvName').textContent = '-'; $('rvRank').textContent = '-'; $('rvNote').textContent = '';
    $('rvFace').hidden = true; $('rvEdit').disabled = true;
    dlg.hidden = false;
    $('rvStart').focus();
    try {
      const me = await RankClient.me();
      if (me.registered) {
        $('rvName').textContent = me.name;
        // 顔：この端末で決めていなければ、サーバーに登録してある顔を使う（別の端末で決めた顔）
        if (me.avatar && !FACE.hasMine()) FACE.saveMine(me.avatar);
        FACE.paint($('rvFace'), FACE.mine(me.name)); $('rvFace').hidden = false;
        $('rvEdit').disabled = false;
        myName = me.name;
        $('rvRank').textContent = me.inRanking === false ? '圏外' : place(me.rank);
      } else {
        $('rvName').textContent = '未登録';
        $('rvNote').textContent = '1戦目のあとに、名前を登録できます。CHARACTER EDIT は登録のあとに';
      }
    } catch (e) {
      $('rvErr').textContent = 'ランキングにつながりません'; $('rvErr').hidden = false;
    }
  }
  const closeView = () => { $('rankView').hidden = true; };

  // ===== キャラクターエディット（xwordx と同じ部品）。変えるたびに、この端末に保存し、少し待ってサーバーにも登録しなおす =====
  let myName = null, cur = null, built = false, upTimer = 0, dirty = false;
  const edOptions = [];
  const status = t => { $('editStatus').textContent = t; };
  async function upload() {
    clearTimeout(upTimer); upTimer = 0;
    if (!dirty) return;
    dirty = false;
    status('SAVING...');
    try {
      const r = await RankClient.setAvatar(cur);
      status(r && r.ok ? 'SAVED' : 'SAVE FAILED');
      if (!r || !r.ok) dirty = true;
    } catch (e) { status('SAVE FAILED'); dirty = true; }
  }
  function refreshEditor() {
    FACE.paint($('editFace'), cur, ($('editView').querySelector('.edit-expr .selected') || {}).dataset?.expr || 'normal');
    for (const { button, key, value, preview } of edOptions) {
      button.hidden = key === 'mouth' && value === 'mouth8' && cur.hair.endsWith('w');   // w の髪型では mouth8 は選べない
      const on = cur[key] === value;
      button.classList.toggle('selected', on);
      button.setAttribute('aria-pressed', String(on));
      if (key === 'hair') FACE.paintMask(preview, FACE.XW.layerMasks.hair[value], cur.hairColor);   // 髪型の見本は、いまの髪の色で
    }
    FACE.paint($('rvFace'), cur);
  }
  function buildEditor() {
    if (built) return;
    built = true;
    const XW = FACE.XW;
    const groups = [['edHair', 'hair', XW.options.hair], ['edEyes', 'eyes', XW.options.eyes], ['edMouth', 'mouth', XW.options.mouth],
      ['edHairColor', 'hairColor', XW.palettes.hair], ['edClothColor', 'clothColor', XW.palettes.cloth], ['edSkinColor', 'skinColor', XW.palettes.skin]];
    for (const [id, key, values] of groups) for (const value of values) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'edit-option';
      button.setAttribute('aria-label', `${key} ${value}`);
      let preview = null;
      if (key.endsWith('Color')) { button.classList.add('color'); button.style.background = value; }
      else if (key === 'hair') { preview = document.createElement('canvas'); preview.width = preview.height = 16; button.append(preview); }
      else { preview = document.createElement('img'); preview.alt = ''; preview.src = `face/parts/${value}.png`; button.append(preview); }
      button.addEventListener('click', () => {
        if (key === 'mouth' && value === 'mouth8' && cur.hair.endsWith('w')) return;
        cur = FACE.sanitize({ ...cur, [key]: value });
        FACE.saveMine(cur);
        dirty = true; status('');
        clearTimeout(upTimer); upTimer = setTimeout(upload, 900);
        refreshEditor();
      });
      $(id).append(button);
      edOptions.push({ button, key, value, preview });
    }
    for (const b of $('editView').querySelectorAll('.edit-expr button')) b.addEventListener('click', () => {
      for (const o of $('editView').querySelectorAll('.edit-expr button')) o.classList.toggle('selected', o === b);
      refreshEditor();
    });
  }
  async function openEditor() {
    const me = await RankClient.me().catch(() => ({ registered: false }));
    if (!me.registered) { $('rvEdit').disabled = true; return; }   // 登録していない人は入れない
    myName = me.name;
    if (me.avatar && !FACE.hasMine()) FACE.saveMine(me.avatar);
    cur = FACE.mine(myName);
    buildEditor();
    status('');
    $('editView').hidden = false;
    refreshEditor();
    $('editBack').focus();
  }
  const closeEditor = () => { $('editView').hidden = true; if (dirty) upload(); $('rvEdit').focus(); };
  $('rvEdit').addEventListener('click', openEditor);
  $('editBack').addEventListener('click', closeEditor);
  $('editView').addEventListener('click', e => { if (e.target === $('editView')) closeEditor(); });
  $('modeRank').addEventListener('click', openView);
  $('rvStart').addEventListener('click', () => { closeView(); start(); });
  $('rvTable').addEventListener('click', showTable);
  $('rvBack').addEventListener('click', closeView);
  $('rankView').addEventListener('click', e => { if (e.target === $('rankView')) closeView(); });
  $('rankNext').addEventListener('click', () => { $('result').hidden = true; start(); });
  $('tableClose').addEventListener('click', () => { $('tableDlg').hidden = true; });
  $('tableDlg').addEventListener('click', e => { if (e.target === $('tableDlg')) $('tableDlg').hidden = true; });
  return { start, onEnd, showTable };
})();
