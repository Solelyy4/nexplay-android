/* ============================================================
   NEXPLAY — app streaming premium
   Sumber video: Internet Archive (byte-range, sah, percuma)
   Metadata    : AniList (anime/donghua) + TVMaze (drama)
   ============================================================ */
'use strict';

const NEXPLAY = (() => {

  const IA = 'https://archive.org';
  const KUNCI_SIMPAN = 'nexplay-v1';
  const KUNCI_TOKEN = 'nexplay-token';

  const keadaan = {
    tab: 'rumah',
    senarai: {},       // cache: nama -> hasil
    item: null,        // item butiran semasa
    episod: [],        // episod item semasa
    videoSemasa: null,
    hls: null,
  };

  const $ = (s) => document.querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  // ---------- kunci capaian ----------
  function adaAkses() {
    const t = localStorage.getItem(KUNCI_TOKEN);
    if (t) return true;
    const kod = prompt('Kod akses NEXPLAY:');
    if (kod === null) return false;
    // hash ringkas — kod sebenar tidak disimpan mentah
    const h = [...kod].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0).toString(36);
    localStorage.setItem(KUNCI_TOKEN, h);
    return true;
  }

  // ---------- rangkaian ----------
  async function dapatkan(url, jenis = 'json', timeout = 30000) {
    const kawal = new AbortController();
    const t = setTimeout(() => kawal.abort(), timeout);
    try {
      const r = await fetch(url, { signal: kawal.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return jenis === 'json' ? r.json() : r.text();
    } catch (e) {
      clearTimeout(t);
      throw new Error(e.name === 'AbortError' ? 'Tamat masa' : e.message);
    }
  }

  // cache dengan masa luput (24 jam)
  async function cache(kunci, fn, jam = 24) {
    try {
      const simpan = JSON.parse(localStorage.getItem(KUNCI_SIMPAN) || '{}');
      const c = simpan[kunci];
      if (c && Date.now() - c.masa < jam * 3600000) return c.data;
    } catch (e) { /* cache rosak — abaikan */ }
    const data = await fn();
    try {
      const simpan = JSON.parse(localStorage.getItem(KUNCI_SIMPAN) || '{}');
      simpan[kunci] = { data, masa: Date.now() };
      // hadkan saiz cache
      const ki = Object.keys(simpan);
      if (ki.length > 60) delete simpan[ki[0]];
      localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(simpan));
    } catch (e) { /* penuh — abaikan */ }
    return data;
  }

  // ---------- sumber: Internet Archive ----------
  const SUMBER = {
    async cariIA(soalan, had = 18) {
      const q = `(${soalan}) AND mediatype:movies`;
      const u = `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}` +
        `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=downloads` +
        `&fl%5B%5D=item_size&fl%5B%5D=language&sort%5B%5D=downloads+desc&rows=${had}&output=json`;
      const d = await dapatkan(u);
      return (d.response?.docs || []).map(x => ({
        id: x.identifier, tajuk: x.title, tahun: x.year,
        muatTurun: x.downloads, saiz: x.item_size, bahasa: x.language,
        sumber: 'ia',
      }));
    },

    async butiranIA(id) {
      const d = await dapatkan(`${IA}/metadata/${id}`, 'json', 60000);
      const md = d.metadata || {};
      // Hanya format yang pelayar boleh main secara langsung.
      // .mkv/.avi SELALUNYA gagal dalam <video> (audio/video codec tidak disokong).
      // Jadi keutamaan: mp4 -> webm -> m4v, dan .mkv/.avi hanya sebagai sandaran.
      const BOLEH_MAIN = ['.mp4', '.m4v', '.webm'];
      const SANDARAN = ['.mkv', '.avi', '.ogv'];
      const semua = (d.files || []);
      const pilih = [];
      for (const e of BOLEH_MAIN) {
        for (const f of semua) {
          if ((f.name || '').toLowerCase().endsWith(e) && !pilih.includes(f)) pilih.push(f);
        }
      }
      // sandaran hanya kalau tiada langsung format boleh main
      if (!pilih.length) {
        for (const e of SANDARAN) {
          for (const f of semua) {
            if ((f.name || '').toLowerCase().endsWith(e) && !pilih.includes(f)) pilih.push(f);
          }
        }
      }
      const vid = pilih.sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
      return {
        id, tajuk: md.title || id, keterangan: md.description || '',
        bahasa: md.language, pembuat: md.creator, tahun: md.year || md.date,
        poster: `${IA}/services/img/${id}`,
        episod: vid.map((f, i) => ({
          no: i + 1, nama: f.name,
          saizMB: (parseInt(f.size || 0) / 1048576).toFixed(1),
          pautan: `${IA}/download/${id}/${encodeURIComponent(f.name)}`,
        })),
      };
    },

    // AniList — anime & donghua
    async cariAniList(soalan, had = 18) {
      const q = {
        query: `query($s:String,$n:Int){Page(perPage:$n){media(type:ANIME,search:$s){
          id title{romaji english} episodes format coverImage{extraLarge}
          genres averageScore startDate{year}}}}`,
        variables: { s: soalan, n: had },
      };
      const d = await dapatkan('https://graphql.anilist.co', 'json');
      // GraphQL perlu POST; guna laluan berasingan
      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
      });
      const j = await r.json();
      return (j.data?.Page?.media || []).map(m => ({
        id: 'al-' + m.id, tajuk: m.title.english || m.title.romaji,
        episod: m.episodes, poster: m.coverImage?.extraLarge,
        skor: m.averageScore, genre: m.genres, tahun: m.startDate?.year,
        sumber: 'anilist', anilistId: m.id,
      }));
    },

    // TVMaze — drama
    async cariTVMaze(soalan, had = 18) {
      const d = await dapatkan(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(soalan)}`);
      return d.slice(0, had).map(x => ({
        id: 'tv-' + x.show.id, tajuk: x.show.name,
        poster: x.show.image?.original, tahun: (x.show.premiered || '').slice(0, 4),
        status: x.show.status, genre: x.show.genres, sumber: 'tvmaze', tvmazeId: x.show.id,
      }));
    },

    async episodTVMaze(id) {
      const d = await dapatkan(`https://api.tvmaze.com/shows/${id}/episodes`);
      return d.map(e => ({
        no: e.number, musim: e.season, nama: e.name,
        tarikh: e.airdate, ringkasan: (e.summary || '').replace(/<[^>]+>/g, '').slice(0, 220),
        pautan: null, sumber: 'tvmaze',
      }));
    },
  };

  // ---------- pilih sumber berdasarkan kategori ----------
  async function cariMengikut(kategori, soalan) {
    const kunci = 'cari:' + kategori + ':' + soalan;
    return cache(kunci, async () => {
      if (kategori === 'anime' || kategori === 'donghua') {
        try { const a = await SUMBER.cariAniList(soalan); if (a.length) return a; } catch (e) {}
        return SUMBER.cariIA(soalan + ' anime');
      }
      if (kategori === 'drama') {
        try { const t = await SUMBER.cariTVMaze(soalan); if (t.length) return t; } catch (e) {}
        return SUMBER.cariIA(soalan + ' drama');
      }
      if (kategori === 'movie') {
        return SUMBER.cariIA(soalan + ' movie');
      }
      // 'semua' — gabung
      const hasil = [];
      try { hasil.push(...await SUMBER.cariTVMaze(soalan, 8)); } catch (e) {}
      try { hasil.push(...await SUMBER.cariAniList(soalan, 8)); } catch (e) {}
      try { hasil.push(...await SUMBER.cariIA(soalan, 12)); } catch (e) {}
      return hasil;
    });
  }

  // ---------- paparan ----------
  function skeletonBaris(n = 1) {
    let h = '';
    for (let b = 0; b < n; b++) {
      h += '<div class="baris"><div class="sk sk-baris" style="width:180px;height:20px;margin-bottom:14px"></div><div class="skrol">';
      for (let i = 0; i < 7; i++) {
        h += '<div class="sk-kad"><div class="sk sk-poster"></div>' +
             '<div class="sk sk-baris"></div><div class="sk sk-baris" style="width:60%"></div></div>';
      }
      h += '</div></div>';
    }
    return h;
  }

  function kadItem(x) {
    const poster = x.poster || (x.sumber === 'ia' ? `${IA}/services/img/${x.id}` : '');
    const gambar = poster
      ? `<img src="${poster}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '';
    const lencana = x.episod ? `<span class="lencana">${x.episod} EP</span>`
      : x.skor ? `<span class="lencana">★ ${x.skor}</span>` : '';
    const meta = [x.tahun, x.status, (x.genre || []).slice(0, 2).join(', ')]
      .filter(Boolean).join(' • ');
    return `<div class="kad" tabindex="0" role="button"
              onclick="NEXPLAY.buka('${x.sumber}','${x.id}')"
              onkeydown="if(event.key==='Enter')NEXPLAY.buka('${x.sumber}','${x.id}')">
        <div class="poster">${gambar}${lencana}
          <div class="main"><div class="main-ikon">▶</div></div>
        </div>
        <div class="nama">${x.tajuk || '—'}</div>
        <div class="meta">${meta || ''}</div>
      </div>`;
  }

  function paparBaris(tajuk, senarai) {
    if (!senarai || !senarai.length) return '';
    return `<section class="baris"><h2>${tajuk}</h2>
      <div class="skrol">${senarai.map(kadItem).join('')}</div></section>`;
  }

  function paparRalat(mesej, cubaLagi) {
    const btn = cubaLagi ? `<button class="btn-utama"
      onclick="${cubaLagi}">Cuba lagi</button>` : '';
    return `<div style="text-align:center;padding:60px 20px">
      <div style="font-size:38px;margin-bottom:14px">⚠️</div>
      <h2 style="margin-bottom:10px">Tidak dapat dimuatkan</h2>
      <p style="color:var(--muted);margin-bottom:22px;max-width:440px;margin-inline:auto">${mesej}</p>
      ${btn}</div>`;
  }

  // ---------- halaman ----------
  const TAB = [
    { id: 'rumah', label: '🏠 Rumah' },
    { id: 'drama', label: '🎭 Drama' },
    { id: 'anime', label: '🎌 Anime' },
    { id: 'donghua', label: '🐉 Donghua' },
    { id: 'movie', label: '🎬 Movie' },
    { id: 'cari', label: '🔍 Cari' },
  ];

  function binaTab() {
    $('#tab').innerHTML = TAB.map(t =>
      `<button class="${keadaan.tab === t.id ? 'aktif' : ''}"
        onclick="NEXPLAY.tukarTab('${t.id}')">${t.label}</button>`).join('');
  }

  async function rumah() {
    keadaan.tab = 'rumah'; binaTab();
    $('#utama').innerHTML = skeletonBaris(3);
    const r = [];
    try { r.push(['Trending Anime', await cache('rumah:anime', () => SUMBER.cariAniList('', 18))]); } catch (e) {}
    try { r.push(['Drama Popular', await cache('rumah:drama', () => SUMBER.cariTVMaze('korean', 18))]); } catch (e) {}
    try { r.push(['Klasik & Penuh', await cache('rumah:ia', () => SUMBER.cariIA('anime full series', 18))]); } catch (e) {}

    const hidup = r.filter(x => x[1] && x[1].length);
    if (!hidup.length) {
      $('#utama').innerHTML = paparRalat(
        'Tiada sumber dapat dicapai. Periksa sambungan internet.', 'NEXPLAY.rumah()');
      return;
    }
    $('#utama').innerHTML = hidup.map(([t, s]) => paparBaris(t, s)).join('');
  }

  async function tukarTab(id) {
    keadaan.tab = id; binaTab();
    if (id === 'rumah') return rumah();
    $('#utama').innerHTML = skeletonBaris(2);
    const kata = { drama: 'korean', anime: 'popular', donghua: 'chinese', movie: 'action' }[id] || '';
    try {
      const s = await cariMengikut(id, kata);
      $('#utama').innerHTML = s.length
        ? paparBaris(id.charAt(0).toUpperCase() + id.slice(1), s)
        : paparRalat('Tiada hasil. Cuba kategori lain.', `NEXPLAY.tukarTab('${id}')`);
    } catch (e) {
      $('#utama').innerHTML = paparRalat(e.message, `NEXPLAY.tukarTab('${id}')`);
    }
  }

  async function cariDariKotak() {
    const q = $('#kotak-cari').value.trim();
    if (!q) return;
    await cari(q);
  }

  async function cari(q) {
    keadaan.tab = 'cari'; binaTab();
    $('#utama').innerHTML = skeletonBaris(2);
    try {
      const s = await cariMengikut('semua', q);
      keadaan.senarai.cari = s;
      $('#utama').innerHTML = s.length
        ? paparBaris(`Hasil untuk "${q}"`, s)
        : paparRalat(`Tiada hasil untuk "${q}".`, null);
    } catch (e) {
      $('#utama').innerHTML = paparRalat(e.message, null);
    }
  }

  // ---------- butiran ----------
  async function buka(sumber, id) {
    if (!adaAkses()) return;
    $('#utama').innerHTML = skeletonBaris(2);
    window.scrollTo(0, 0);
    try {
      let d, ep = [];
      if (sumber === 'ia') {
        d = await SUMBER.butiranIA(id);
        ep = d.episod;
      } else if (sumber === 'anilist') {
        const al = id.replace('al-', '');
        // AniList: cari dalam IA sebagai sumber video
        d = { id, tajuk: 'Anime #' + al, poster: null, keterangan: '' };
        const ia = await SUMBER.cariIA(d.tajuk).catch(() => []);
        if (ia.length) { const b = await SUMBER.butiranIA(ia[0].id); d = b; ep = b.episod; }
      } else if (sumber === 'tvmaze') {
        const tv = id.replace('tv-', '');
        ep = await SUMBER.episodTVMaze(tv).catch(() => []);
        const cariIA = await SUMBER.cariIA($('#kotak-cari')?.value || id).catch(() => []);
        d = cariIA.length ? await SUMBER.butiranIA(cariIA[0].id) : { id, tajuk: 'Drama #' + tv, episod: [] };
        if (d.episod?.length) ep = d.episod.map(e => ({ ...e, musim: null, tarikh: null }));
      }
      keadaan.item = d; keadaan.episod = ep;
      paparButiran(d, ep);
    } catch (e) {
      $('#utama').innerHTML = paparRalat(e.message, null);
    }
  }

  function paparButiran(d, ep) {
    const poster = d.poster || (d.id ? `${IA}/services/img/${d.id}` : '');
    // Sahkan ia benar-benar format boleh main, bukan sekadar ada pautan
    const bolehMain = /[.](mp4|m4v|webm)$/i;
    const adaVideo = ep && ep.length && ep[0].pautan && bolehMain.test(ep[0].nama || '');
    const adaSandaran = !adaVideo && ep && ep.length && ep[0].pautan;
    const tanda = [
      d.tahun ? `<span>${String(d.tahun).slice(0, 4)}</span>` : '',
      d.bahasa ? `<span>${d.bahasa}</span>` : '',
      d.pembuat ? `<span>${d.pembuat}</span>` : '',
      ep?.length ? `<span>${ep.length} episod</span>` : '',
      adaVideo ? `<span class="skor">✔ Boleh main</span>` : `<span>⚠ Tiada video</span>`,
    ].filter(Boolean).join('');

    $('#utama').innerHTML = `
      <div class="butiran">
        <div class="poster-besar">
          <div class="poster">${poster ? `<img src="${poster}" alt="" onerror="this.style.display='none'">` : ''}</div>
        </div>
        <div class="info">
          <h1>${d.tajuk || '—'}</h1>
          <div class="tanda">${tanda}</div>
          <p class="ringkas">${(d.keterangan || 'Tiada sinopsis.').replace(/<[^>]+>/g, '').slice(0, 420)}</p>
          <div class="aksi">
            ${adaVideo ? `<button class="btn-utama" onclick="NEXPLAY.mainEpisod(1)">▶ Main Sekarang</button>` : ''}
            <button class="btn-kedua" onclick="NEXPLAY.rumah()">← Kembali</button>
          </div>
        </div>
      </div>
      ${ep && ep.length ? `<section class="senarai-ep"><h3>Senarai Episod (${ep.length})</h3>
        <div class="grid-ep">${ep.map((e, i) => `
          <button class="ep" onclick="NEXPLAY.mainEpisod(${i + 1})">
            <span class="n">${e.musim ? 'S' + e.musim + 'E' + e.no : e.no}</span>
            <span class="t"><b>${(e.nama || '').replace(/\.(mp4|mkv|avi|webm)$/i, '')}</b>
            <small>${e.saizMB ? e.saizMB + ' MB' : (e.tarikh || '')}</small></span>
          </button>`).join('')}</div></section>` : ''}
      ${!adaVideo && !adaSandaran ? `<div class="nota" style="margin-top:24px">
        ⚠️ Item ini tiada fail video yang boleh dimainkan terus dalam Internet Archive.
        Cuba cari dengan nama lain — banyak koleksi lain yang berfungsi.</div>` : ''}
      ${adaSandaran ? `<div class="nota" style="margin-top:24px">
        ⚠️ Fail ini berformat <b>${(ep[0].nama || '').split('.').pop().toUpperCase()}</b> —
        sesetengah peranti tidak boleh memainkannya terus dalam pelayar.
        Cuba episod lain, atau guna pemain luar (VLC).</div>` : ''}`;
  }

  // ---------- pemain ----------
  let videoSemasa = null;
  let sembunyiTimer = null;

  function mainEpisod(n) {
    const e = keadaan.episod[n - 1];
    if (!e || !e.pautan) { alert('Episod ini tiada pautan video.'); return; }
    mainPautan(e.pautan, e.nama, `${keadaan.item?.tajuk || ''} — Episod ${n}`);
  }

  function mainPautan(url, nama, tajuk) {
    videoSemasa = { url, nama };
    const v = $('#video');
    $('#tajuk-p').textContent = tajuk || nama;
    $('#pemain').classList.add('sedia');
    // kembali ke kedudukan terakhir
    const ked = JSON.parse(localStorage.getItem('nexplay-kedudukan') || '{}')[url];
    if (ked && ked.saat > 30) {
      v.currentTime = ked.saat;
    }
    v.src = url;
    v.load();
    v.play().catch(() => { /* autoplay disekat — pengguna tekan */ });
  }

  function tutupPemain() {
    const v = $('#video');
    v.pause();
    simpanKedudukan();
    v.removeAttribute('src'); v.load();
    $('#pemain').classList.remove('sedia');
  }

  function togolMain() {
    const v = $('#video');
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }

  function lompat(s) {
    const v = $('#video');
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + s));
  }

  function skrinPenuh() {
    const p = $('#pemain');
    if (document.fullscreenElement) document.exitFullscreen();
    else p.requestFullscreen?.().catch(() => {});
  }

  const LAJU = [1, 1.25, 1.5, 2, 0.75];
  let lajuIdx = 0;
  function laju() {
    lajuIdx = (lajuIdx + 1) % LAJU.length;
    const v = $('#video');
    v.playbackRate = LAJU[lajuIdx];
    const b = document.getElementById('btn-laju');
    if (b) b.textContent = LAJU[lajuIdx] + 'x';
  }

  async function pip() {
    const v = $('#video');
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
    } catch (e) { /* tidak disokong */ }
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), d = Math.floor(s % 60);
    return m + ':' + String(d).padStart(2, '0');
  }

  function simpanKedudukan() {
    const v = $('#video');
    if (!videoSemasa || !v.currentTime) return;
    try {
      const semua = JSON.parse(localStorage.getItem('nexplay-kedudukan') || '{}');
      semua[videoSemasa.url] = { saat: v.currentTime, masa: Date.now() };
      // hadkan
      const ki = Object.keys(semua);
      if (ki.length > 60) {
        ki.sort((a, b) => semua[a].masa - semua[b].masa);
        delete semua[ki[0]];
      }
      localStorage.setItem('nexplay-kedudukan', JSON.stringify(semua));
    } catch (e) {}
  }

  function pasangPemain() {
    const v = $('#video');
    const bar = $('#bar'), kem = $('#kemajuan'), masa = $('#masa');

    v.addEventListener('timeupdate', () => {
      if (!v.duration) return;
      kem.style.width = (v.currentTime / v.duration * 100) + '%';
      masa.textContent = `${fmt(v.currentTime)} / ${fmt(v.duration)}`;
    });
    v.addEventListener('play', () => { $('#btn-main').textContent = '❚❚'; });
    v.addEventListener('pause', () => { $('#btn-main').textContent = '▶'; });
    v.addEventListener('ended', () => { $('#btn-main').textContent = '▶'; });
    v.addEventListener('error', () => {
      $('#tajuk-p').textContent = '⚠️ Video tidak dapat dimainkan — cuba episod lain';
    });
    v.addEventListener('click', () => { v.paused ? v.play().catch(()=>{}) : v.pause(); });

    bar.addEventListener('click', (e) => {
      const r = bar.getBoundingClientRect();
      v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
    });

    // simpan setiap 5 saat
    setInterval(simpanKedudukan, 5000);

    // skrin penuh automatik pada TV
    if (window.innerWidth >= 1200 && !('ontouchstart' in window)) {
      $('#pemain').addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
      }, { once: true });
    }

    // sembunyi kawalan semasa main
    const lapisan = $('#plapisan');
    const tunjuk = () => {
      lapisan.classList.remove('sorok');
      clearTimeout(sembunyiTimer);
      if (!v.paused) sembunyiTimer = setTimeout(() => lapisan.classList.add('sorok'), 3000);
    };
    $('#pemain').addEventListener('mousemove', tunjuk);
    $('#pemain').addEventListener('touchstart', tunjuk, { passive: true });
    v.addEventListener('pause', () => lapisan.classList.remove('sorok'));
    v.addEventListener('play', tunjuk);

    // pintasan papan kekunci (Android TV jauh juga hantar ini)
    document.addEventListener('keydown', (e) => {
      if (!$('#pemain').classList.contains('sedia')) return;
      if (e.code === 'Space') { e.preventDefault(); togolMain(); }
      else if (e.code === 'ArrowLeft') lompat(-10);
      else if (e.code === 'ArrowRight') lompat(10);
      else if (e.code === 'Escape') tutupPemain();
      else if (e.key === 'f' || e.key === 'F') skrinPenuh();
    });
  }

  // ---------- permulaan ----------
  function mula() {
    pasangPemain();
    binaTab();
    const cari = $('#kotak-cari');
    cari.addEventListener('keydown', (e) => { if (e.key === 'Enter') cariDariKotak(); });
    // baca kategori dari URL (?k=drama)
    const p = new URLSearchParams(location.search);
    if (p.get('k')) tukarTab(p.get('k')); else rumah();
    // daftar service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return { mula, rumah, tukarTab, cari, cariDariKotak, buka, mainEpisod, tutupPemain,
           togolMain, lompat, skrinPenuh, pip, laju, keadaan };
})();

document.addEventListener('DOMContentLoaded', NEXPLAY.mula);
