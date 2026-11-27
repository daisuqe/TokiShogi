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
      if (!RankCore.validName(name)) { $('entryErr').textContent = '英大文字4文字で入力してください'; $('entryErr').hidden = false; return; }
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
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name + (r.isCom ? '' : ' ★');
        const rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = r.rating;
        li.append(rk, nm, rt);
        list.append(li);
      }
      const mine = list.querySelector('.me');
      if (mine) mine.scrollIntoView({ block: 'center' });
    } catch (e) {
      list.textContent = 'つながりません';
    }
  }

  $('modeRank').addEventListener('click', start);
  $('rankNext').addEventListener('click', () => { $('result').hidden = true; start(); });
  $('showTable').addEventListener('click', showTable);
  $('tableClose').addEventListener('click', () => { $('tableDlg').hidden = true; });
  $('tableDlg').addEventListener('click', e => { if (e.target === $('tableDlg')) $('tableDlg').hidden = true; });
  return { start, onEnd, showTable };
})();
