/* ═══════════════════════════════════════════════════════════
   moodlist — app.js
   개선점:
   1) 반응형/모바일 안정화 — 카드 위치를 px가 아닌 비율(0~1)로 저장,
      화면 크기가 달라도 공유 레이아웃이 유지되고 리사이즈에 반응.
   2) 멀티 플랫폼 — YouTube / Spotify / Apple Music / SoundCloud / 기타 링크.
   3) 코드 파일 분리 — HTML(구조) · CSS(style.css) · JS(app.js).
═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let state = {
  selectedCharacter: null,
  nickname: '',
  playlistTitle: '',
  songs: [],
  isViewOnly: false,
};

let carouselIdx = 0;
let orbitActive = false;
let orbitAngle  = 0;
let orbitRAF    = null;

const MAX_SONGS = 8;
const CARD_TOP  = 64;    // topbar 아래 여백
const thumbCache = {};   // url -> thumbnail url (oEmbed 결과 캐시)

// 모션/입체감 (reduced-motion·hover 환경 대응)
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOVER_CAPABLE  = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let parallaxRAF = null;

/* ═══════════════════════════════════════════
   PLATFORMS
═══════════════════════════════════════════ */
const PF_ICONS = {
  youtube:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.9-.5-5.8a3 3 0 0 0-2.1-2.1C18.5 3.6 12 3.6 12 3.6s-6.5 0-8.4.5A3 3 0 0 0 1.5 6.2C1 8.1 1 12 1 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 8.4.5 8.4.5s6.5 0 8.4-.5a3 3 0 0 0 2.1-2.1C23 15.9 23 12 23 12ZM9.8 15.5v-7l6.1 3.5-6.1 3.5Z"/></svg>',
  spotify:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.2c3.8-.87 7.08-.49 9.72 1.1.3.18.4.57.2.86Zm1.23-2.73a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.16a.78.78 0 1 1-.45-1.49c3.64-1.1 8.16-.57 11.24 1.32.37.22.49.7.25 1.07Zm.1-2.84C14.8 8.96 9.5 8.78 6.4 9.72a.94.94 0 1 1-.54-1.8c3.56-1.07 9.4-.86 13.1 1.33a.94.94 0 0 1-.96 1.62Z"/></svg>',
  apple:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 17.5a2.5 2.5 0 1 1-2-2.45V6.7l10-2v8.3a2.5 2.5 0 1 1-2-2.45V6.9l-6 1.2v9.4Z"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="13" width="1.8" height="6" rx="0.9"/><rect x="5.5" y="10" width="1.8" height="9" rx="0.9"/><rect x="9" y="7.5" width="1.8" height="11.5" rx="0.9"/><rect x="12.5" y="9.5" width="1.8" height="9.5" rx="0.9"/><path d="M17 9.5a5 5 0 0 1 .3 9.5H17V9.5Z"/></svg>',
  other:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18a3 3 0 1 1-2-2.83V4.8L19 2.4v10.77A3 3 0 1 1 17 10.5V4.85L9 6.45V18Z"/></svg>',
};
const PF_NAME = {
  youtube: 'YouTube', spotify: 'Spotify', apple: 'Apple Music',
  soundcloud: 'SoundCloud', other: 'Music',
};
const PF_CODE = { youtube: 0, spotify: 1, apple: 2, soundcloud: 3, other: 4 };
const PF_FROM_CODE = ['youtube', 'spotify', 'apple', 'soundcloud', 'other'];

/* ═══════════════════════════════════════════
   PLATFORM / URL 파싱
═══════════════════════════════════════════ */
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    const m = u.pathname.match(/\/(?:embed|shorts|v)\/([^/?&]+)/);
    if (m) return m[1];
  } catch(e) {}
  return null;
}

function detectPlatform(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch(e) { return { platform: null, videoId: null }; }

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return { platform: 'youtube', videoId: extractYouTubeId(url) };
  }
  if (host.includes('spotify.com'))      return { platform: 'spotify',    videoId: null };
  if (host.includes('music.apple.com'))  return { platform: 'apple',      videoId: null };
  if (host.includes('soundcloud.com'))   return { platform: 'soundcloud', videoId: null };
  return { platform: 'other', videoId: null };
}

function ytThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/* oEmbed 로 썸네일 비동기 획득 (Spotify / SoundCloud). 실패 시 null. */
async function fetchOEmbedThumb(platform, url) {
  if (thumbCache[url] !== undefined) return thumbCache[url];
  let endpoint = null;
  if (platform === 'spotify')    endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  if (platform === 'soundcloud') endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  if (!endpoint) { thumbCache[url] = null; return null; }
  try {
    const res  = await fetch(endpoint);
    const data = await res.json();
    const thumb = data && data.thumbnail_url ? data.thumbnail_url : null;
    thumbCache[url] = thumb;
    return thumb;
  } catch(e) {
    thumbCache[url] = null;
    return null;
  }
}

/* 곡의 링크(재생용) */
function playUrl(song) {
  if (song.url) return song.url;
  if (song.videoId) return `https://www.youtube.com/watch?v=${song.videoId}`;
  return '#';
}

/* ═══════════════════════════════════════════
   RESPONSIVE 좌표 (비율 ↔ px)
═══════════════════════════════════════════ */
function cardMetrics() {
  const sample = document.querySelector('.music-card');
  const w = sample ? sample.offsetWidth  : (window.innerWidth <= 640 ? 150 : 194);
  const h = sample ? sample.offsetHeight : 190;
  return { w, h };
}
function availArea(cardW, cardH) {
  const canvas = document.getElementById('canvas');
  const cw = canvas ? canvas.offsetWidth  : window.innerWidth;
  const ch = canvas ? canvas.offsetHeight : window.innerHeight;
  return {
    cw, ch,
    availX: Math.max(1, cw - cardW - 8),
    availY: Math.max(1, ch - cardH - CARD_TOP - 8),
  };
}
function pctToPx(song, cardW, cardH) {
  const { availX, availY } = availArea(cardW, cardH);
  const xp = (song.xp == null) ? 0.1 : clamp(song.xp, 0, 1);
  const yp = (song.yp == null) ? 0.1 : clamp(song.yp, 0, 1);
  return { left: 4 + xp * availX, top: CARD_TOP + yp * availY };
}
function pxToPct(left, top, cardW, cardH) {
  const { availX, availY } = availArea(cardW, cardH);
  return {
    xp: clamp((left - 4) / availX, 0, 1),
    yp: clamp((top - CARD_TOP) / availY, 0, 1),
  };
}

/* ═══════════════════════════════════════════
   IMAGE LOADER (캐릭터)
═══════════════════════════════════════════ */
function loadImageWithFallback(imgEl, paths) {
  let i = 0;
  imgEl.onload  = () => { imgEl.style.display = 'block'; };
  imgEl.onerror = () => {
    if (i >= paths.length) { imgEl.style.display = 'none'; return; }
    imgEl.src = paths[i++];
  };
  if (!paths.length) { imgEl.style.display = 'none'; return; }
  imgEl.src = paths[i++];
}

/* ═══════════════════════════════════════════
   SONG 정규화 (마이그레이션 포함)
═══════════════════════════════════════════ */
function normalizeSong(s, i) {
  const platform = s.platform || 'youtube';
  const url = s.url || (s.videoId ? `https://www.youtube.com/watch?v=${s.videoId}` : '');
  const videoId = s.videoId || (platform === 'youtube' ? extractYouTubeId(url) : null);

  let xp = s.xp, yp = s.yp;
  if (xp == null || yp == null) {
    // 구버전 px 좌표 → 비율 변환
    if (typeof s.x === 'number' || typeof s.y === 'number') {
      const cw = window.innerWidth, ch = window.innerHeight;
      xp = clamp((s.x || 40) / Math.max(1, cw - 194 - 8), 0, 1);
      yp = clamp(((s.y || 80) - CARD_TOP) / Math.max(1, ch - 190 - CARD_TOP - 8), 0, 1);
    } else {
      xp = 0.05 + (i % 3) * 0.34;
      yp = 0.06 + Math.floor(i / 3) * 0.32;
    }
  }
  return {
    id: s.id || (Date.now().toString() + '_' + i),
    platform, url, videoId,
    title: s.title || '',
    memo:  s.memo  || '',
    xp, yp,
    thumb: s.thumb || (platform === 'youtube' && videoId ? ytThumb(videoId) : null),
  };
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function setVH() {
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}

window.addEventListener('DOMContentLoaded', () => {
  setVH();

  // 1) 캐러셀 캐릭터 이미지
  document.querySelectorAll('.car-item img[data-char]').forEach(img => {
    const n = img.dataset.char;
    loadImageWithFallback(img, [`character_0${n}_cutout.png`, `character_0${n}.png`]);
  });

  // 2) 공유 URL
  const params = new URLSearchParams(location.search);
  const raw = params.get('data');
  if (raw) {
    try {
      const decoded = decodeShareData(raw);
      state = { ...decoded, isViewOnly: true };
      state.songs = state.songs.map(normalizeSong);
      showMain();
      return;
    } catch(e) { console.warn('URL data parse error', e); }
  }

  // 3) localStorage 초안 복원
  try {
    const draft = JSON.parse(localStorage.getItem('moodlist_draft') || 'null');
    if (draft && draft.selectedCharacter) {
      state = { ...draft, isViewOnly: false };
      state.songs = (state.songs || []).map(normalizeSong);
      carouselIdx = state.selectedCharacter - 1;
    }
  } catch(e) {}

  carouselRender();
});

/* 리사이즈 → 카드 재배치 (비율 기반) */
let resizeT;
window.addEventListener('resize', () => {
  setVH();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (document.getElementById('screen-main').classList.contains('hidden')) return;
    if (orbitActive) return; // orbit 중에는 RAF가 위치 관리
    repositionCards();
  }, 120);
});

function repositionCards() {
  const { w, h } = cardMetrics();
  document.querySelectorAll('.music-card').forEach(card => {
    const song = state.songs.find(s => s.id === card.dataset.id);
    if (!song) return;
    const p = pctToPx(song, w, h);
    card.style.left = p.left + 'px';
    card.style.top  = p.top  + 'px';
  });
}

/* ═══════════════════════════════════════════
   CAROUSEL
═══════════════════════════════════════════ */
function carouselRender() {
  const items = document.querySelectorAll('.car-item');
  const total = items.length;
  items.forEach((item, i) => {
    item.classList.remove('center', 'prev', 'next');
    const off = ((i - carouselIdx) % total + total) % total;
    if (off === 0)      item.classList.add('center');
    else if (off === 1) item.classList.add('next');
    else                item.classList.add('prev');
  });
}
function carouselPrev() {
  const total = document.querySelectorAll('.car-item').length;
  carouselIdx = (carouselIdx - 1 + total) % total;
  carouselRender();
}
function carouselNext() {
  const total = document.querySelectorAll('.car-item').length;
  carouselIdx = (carouselIdx + 1) % total;
  carouselRender();
}
function carouselTap(idx) {
  if (idx === carouselIdx) {
    state.selectedCharacter = idx + 1;
    saveDraft();
    showMain();
  } else {
    carouselIdx = idx;
    carouselRender();
  }
}

/* ═══════════════════════════════════════════
   KEYBOARD
═══════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (!document.getElementById('screen-select').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft')  carouselPrev();
    if (e.key === 'ArrowRight') carouselNext();
    if (e.key === 'Enter') {
      state.selectedCharacter = carouselIdx + 1;
      saveDraft();
      showMain();
    }
  }
  if (e.key === 'Escape') { closeAddModal(); closePanel(); closePlayer(); }
});

/* ═══════════════════════════════════════════
   MAIN SCREEN
═══════════════════════════════════════════ */
function showMain() {
  document.getElementById('screen-select').classList.add('hidden');
  document.getElementById('screen-main').classList.remove('hidden');

  applyCharacter();
  updatePanelInputs();
  updateOverlay();
  renderCards();

  if (state.isViewOnly) {
    document.getElementById('view-banner').classList.add('show');
    document.getElementById('btn-edit').style.display = 'none';
    document.getElementById('btn-orbit').style.display = 'none';
    if (state.songs.length > 0) { orbitActive = false; toggleOrbit(); }
  } else {
    setTimeout(() => {
      const panel = document.getElementById('edit-panel');
      if (panel) panel.classList.add('open');
    }, 280);
  }
}

function goSelect() {
  stopOrbit();
  closePanel();
  closePlayer();
  resetParallax();
  document.getElementById('screen-main').classList.add('hidden');
  document.getElementById('screen-select').classList.remove('hidden');
  if (state.selectedCharacter) {
    carouselIdx = state.selectedCharacter - 1;
    carouselRender();
  }
}

function applyCharacter() {
  const n = state.selectedCharacter || 1;
  loadImageWithFallback(document.getElementById('char-bg'),
    [`character_0${n}_bg.png`, `character_0${n}.png`]);
  loadImageWithFallback(document.getElementById('char-cutout'),
    [`character_0${n}_cutout.png`, `character_0${n}.png`]);
}

/* ═══════════════════════════════════════════
   OVERLAY / PANEL
═══════════════════════════════════════════ */
function updateOverlay() {
  state.nickname      = document.getElementById('inp-nick').value.trim();
  state.playlistTitle = document.getElementById('inp-title').value.trim();
  document.getElementById('pl-nick').textContent  = state.nickname || '';
  document.getElementById('pl-title').textContent = state.playlistTitle || '';
  saveDraft();
}
function updatePanelInputs() {
  document.getElementById('inp-nick').value  = state.nickname || '';
  document.getElementById('inp-title').value = state.playlistTitle || '';
}
function togglePanel() { document.getElementById('edit-panel').classList.toggle('open'); }
function closePanel()  { document.getElementById('edit-panel').classList.remove('open'); }

/* ═══════════════════════════════════════════
   ADD SONG MODAL
═══════════════════════════════════════════ */
function openAddModal() {
  if (state.songs.length >= MAX_SONGS) { showToast(`최대 ${MAX_SONGS}곡까지 추가할 수 있어요`); return; }
  document.getElementById('m-url').value    = '';
  document.getElementById('m-stitle').value = '';
  document.getElementById('m-memo').value   = '';
  resetThumb();
  document.getElementById('modal-add').classList.add('open');
  setTimeout(() => document.getElementById('m-url').focus(), 100);
}
function closeAddModal() { document.getElementById('modal-add').classList.remove('open'); }

function previewThumb() {
  const url = document.getElementById('m-url').value.trim();
  const box = document.getElementById('m-thumb');
  const hint = document.getElementById('pf-hint');

  if (!url) { hint.style.display = 'none'; resetThumb(); return; }

  const { platform, videoId } = detectPlatform(url);
  if (!platform) { hint.style.display = 'none'; resetThumb(); return; }

  // 플랫폼 힌트 배지
  hint.style.display = 'flex';
  hint.innerHTML = `<span class="pf-dot pf-bg-${platform}">${PF_ICONS[platform]}</span> ${PF_NAME[platform]} 링크`;

  if (platform === 'youtube' && videoId) {
    box.innerHTML = `<img src="${ytThumb(videoId)}" alt="thumb" onerror="thumbFail(this,'${platform}')">`;
    return;
  }
  if (platform === 'spotify' || platform === 'soundcloud') {
    box.innerHTML = phMarkup(platform, '불러오는 중…');
    fetchOEmbedThumb(platform, url).then(thumb => {
      if (document.getElementById('m-url').value.trim() !== url) return; // 입력 바뀌면 무시
      box.innerHTML = thumb
        ? `<img src="${esc(thumb)}" alt="thumb" onerror="thumbFail(this,'${platform}')">`
        : phMarkup(platform);
    });
    return;
  }
  // apple / other → 브랜드 플레이스홀더
  box.innerHTML = phMarkup(platform);
}
function phMarkup(platform, label) {
  return `<div class="c-thumb-ph pf-bg-${platform}">${PF_ICONS[platform]}<span class="pf-name">${label || PF_NAME[platform]}</span></div>`;
}
function resetThumb() {
  document.getElementById('m-thumb').innerHTML =
    '<span class="thumb-ph">음악 링크를 붙여넣으면 미리보기가 표시됩니다<br>(YouTube · Spotify · Apple Music · SoundCloud)</span>';
}

function addSong() {
  const url    = document.getElementById('m-url').value.trim();
  const title  = document.getElementById('m-stitle').value.trim();
  const memo   = document.getElementById('m-memo').value.trim();
  if (!url)   { showToast('음악 링크를 입력해주세요'); return; }

  const { platform, videoId } = detectPlatform(url);
  if (!platform) { showToast('유효한 링크가 아닙니다'); return; }
  if (!title)    { showToast('노래 제목을 입력해주세요'); return; }

  // 기본 배치 (비율)
  const zones = [
    { x: 0.02, y: 0.06 }, { x: 0.70, y: 0.04 },
    { x: 0.02, y: 0.50 }, { x: 0.70, y: 0.48 },
    { x: 0.33, y: 0.02 }, { x: 0.02, y: 0.86 },
    { x: 0.70, y: 0.84 }, { x: 0.33, y: 0.80 },
  ];
  const z = zones[state.songs.length % zones.length];
  const j = () => (Math.random() - 0.5) * 0.06;

  const song = normalizeSong({
    id: Date.now().toString(),
    platform, url, videoId, title, memo,
    xp: clamp(z.x + j(), 0, 1),
    yp: clamp(z.y + j(), 0, 1),
    thumb: platform === 'youtube' && videoId ? ytThumb(videoId) : null,
  }, state.songs.length);

  state.songs.push(song);
  closeAddModal();
  renderCards();
  renderSongPanel();
  saveDraft();
  showToast(`"${title}" 추가됐어요`);

  // 비 YouTube → oEmbed 썸네일 비동기 갱신
  if (platform === 'spotify' || platform === 'soundcloud') {
    fetchOEmbedThumb(platform, url).then(thumb => {
      if (!thumb) return;
      song.thumb = thumb;
      updateCardThumb(song);
      saveDraft();
    });
  }
}

function deleteSong(id) {
  state.songs = state.songs.filter(s => s.id !== id);
  renderCards();
  renderSongPanel();
  saveDraft();
}

/* ═══════════════════════════════════════════
   CARDS
═══════════════════════════════════════════ */
function renderCards() {
  document.querySelectorAll('.music-card').forEach(c => c.remove());
  const canvas = document.getElementById('canvas');

  state.songs.forEach(song => {
    const card = buildCard(song);
    canvas.appendChild(card);
  });

  // 배치는 실제 카드 크기 측정 후 (반응형)
  const { w, h } = cardMetrics();
  state.songs.forEach(song => {
    const card = canvas.querySelector(`.music-card[data-id="${cssEsc(song.id)}"]`);
    if (!card) return;
    const p = pctToPx(song, w, h);
    card.style.left = p.left + 'px';
    card.style.top  = p.top  + 'px';
    if (!state.isViewOnly) makeDraggable(card, song);
    else card.addEventListener('click', () => openPlayer(song));
    addTilt(card);

    // YouTube 외 플랫폼 썸네일 지연 로딩
    if (!song.thumb && (song.platform === 'spotify' || song.platform === 'soundcloud')) {
      fetchOEmbedThumb(song.platform, song.url).then(thumb => {
        if (!thumb) return;
        song.thumb = thumb;
        updateCardThumb(song);
      });
    }
  });
  renderSongPanel();
}

function thumbInner(song) {
  if (song.thumb) {
    return `<img src="${esc(song.thumb)}" alt="${esc(song.title)}" onerror="thumbFail(this,'${song.platform}')">`;
  }
  return phMarkup(song.platform);
}
function thumbFail(img, platform) {
  if (img && img.parentElement) img.parentElement.innerHTML = phMarkup(platform);
}
function sthumbFail(img, platform) {
  if (img && img.parentElement)
    img.parentElement.innerHTML = `<span class="sthumb-ph pf-bg-${platform}">${PF_ICONS[platform] || ''}</span>`;
}

function buildCard(song) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.dataset.id = song.id;
  card.innerHTML = `
    <div class="card-inner">
      <div class="pf-badge pf-bg-${song.platform}" title="${esc(PF_NAME[song.platform])}">${PF_ICONS[song.platform]}</div>
      <div class="c-thumb">${thumbInner(song)}</div>
      <div class="c-body">
        <div class="c-title">${esc(song.title)}</div>
        ${song.memo ? `<div class="c-memo">${esc(song.memo)}</div>` : ''}
      </div>
      <div class="c-foot">
        <span class="c-play" title="${esc(PF_NAME[song.platform])} 재생">
          <svg width="10" height="10" viewBox="0 0 12 12"><polygon points="3,1.5 10.5,6 3,10.5" fill="white"/></svg>
        </span>
        ${!state.isViewOnly ? `
          <button class="c-del" onclick="deleteSong('${jsEsc(song.id)}')" title="삭제">
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
            </svg>
          </button>` : ''}
      </div>
    </div>
  `;
  return card;
}

function updateCardThumb(song) {
  const card = document.querySelector(`.music-card[data-id="${cssEsc(song.id)}"] .c-thumb`);
  if (card) card.innerHTML = thumbInner(song);
  const row = document.querySelector(`.song-row-p[data-id="${cssEsc(song.id)}"] .sthumb-wrap`);
  if (row) row.outerHTML = songThumbMarkup(song);
}

function songThumbMarkup(song) {
  if (song.thumb) {
    return `<span class="sthumb-wrap"><img class="sthumb" src="${esc(song.thumb)}" alt="" onerror="sthumbFail(this,'${song.platform}')"></span>`;
  }
  return `<span class="sthumb-wrap"><span class="sthumb-ph pf-bg-${song.platform}">${PF_ICONS[song.platform]}</span></span>`;
}

function renderSongPanel() {
  const list = document.getElementById('song-list-p');
  document.getElementById('s-count').textContent = state.songs.length;
  document.getElementById('s-max').textContent = MAX_SONGS;
  const addBtn = document.getElementById('btn-add-song');
  if (addBtn) addBtn.style.display = state.songs.length >= MAX_SONGS ? 'none' : 'flex';

  if (!state.songs.length) {
    list.innerHTML = '<div class="song-empty">아직 추가된 노래가 없어요</div>';
    return;
  }
  list.innerHTML = state.songs.map(s => `
    <div class="song-row-p" data-id="${esc(s.id)}">
      ${songThumbMarkup(s)}
      <div class="sinfo">
        <div class="stitle">${esc(s.title)}</div>
        ${s.memo ? `<div class="smemo">${esc(s.memo)}</div>` : ''}
      </div>
      ${!state.isViewOnly ? `
        <button class="btn-sdel" onclick="deleteSong('${jsEsc(s.id)}')">
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
          </svg>
        </button>` : ''}
    </div>
  `).join('');
}

/* ═══════════════════════════════════════════
   DRAG
═══════════════════════════════════════════ */
function makeDraggable(el, song) {
  let pressed = false, dragging = false, moved = false;
  let holdTimer = null, sx = 0, sy = 0, ox = 0, oy = 0, startTime = 0;

  const TAP_MAX_MS = 180, HOLD_MS = 220, MOVE_THRESHOLD = 5;

  function pauseOrbitForDrag() {
    if (orbitActive && orbitRAF) { cancelAnimationFrame(orbitRAF); orbitRAF = null; }
  }
  function down(e) {
    if (e.target.closest('.c-del')) return;
    pressed = true; dragging = false; moved = false; startTime = Date.now();
    const pt = e.touches ? e.touches[0] : e;
    sx = pt.clientX; sy = pt.clientY;
    ox = parseInt(el.style.left) || 0;
    oy = parseInt(el.style.top)  || 0;
    holdTimer = setTimeout(() => {
      if (!pressed) return;
      dragging = true; pauseOrbitForDrag();
      el.classList.add('dragging'); el.style.zIndex = '60';
    }, HOLD_MS);
    e.preventDefault();
  }
  function move(e) {
    if (!pressed) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - sx, dy = pt.clientY - sy;
    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) moved = true;
    if (moved && !dragging) {
      clearTimeout(holdTimer);
      dragging = true; pauseOrbitForDrag();
      el.classList.add('dragging'); el.style.zIndex = '60';
    }
    if (!dragging) return;
    el.style.left = (ox + dx) + 'px';
    el.style.top  = (oy + dy) + 'px';
    e.preventDefault();
  }
  function up(e) {
    if (!pressed) return;
    clearTimeout(holdTimer);
    const pressTime = Date.now() - startTime;
    const wasDragging = dragging;
    pressed = false; dragging = false;

    if (wasDragging || moved) {
      el.classList.remove('dragging'); el.style.zIndex = '';
      const { w, h } = cardMetrics();
      const pct = pxToPct(parseInt(el.style.left) || 0, parseInt(el.style.top) || 0, w, h);
      song.xp = pct.xp; song.yp = pct.yp;
      saveDraft();
      if (orbitActive && !orbitRAF) startOrbit();
      return;
    }
    if (pressTime <= TAP_MAX_MS) {
      openPlayer(song);
    }
    e.preventDefault();
  }

  el.addEventListener('mousedown', down, { passive: false });
  el.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move, { passive: false });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

/* ═══════════════════════════════════════════
   ORBIT
═══════════════════════════════════════════ */
function toggleOrbit() {
  if (state.songs.length === 0) {
    showToast('노래를 먼저 추가해주세요');
    const p = document.getElementById('edit-panel');
    if (p && !state.isViewOnly) p.classList.add('open');
    return;
  }
  orbitActive = !orbitActive;
  document.getElementById('btn-orbit').classList.toggle('active', orbitActive);
  const row = document.getElementById('orbit-row');
  if (row) row.classList.toggle('active', orbitActive);
  if (orbitActive) startOrbit(); else stopOrbit();
}

function startOrbit() {
  if (orbitRAF) cancelAnimationFrame(orbitRAF);
  document.querySelectorAll('.music-card').forEach(card => { card.style.transition = 'none'; });
  const { w: cardW, h: cardH } = cardMetrics();

  function tick() {
    orbitAngle += 0.006;
    const canvas = document.getElementById('canvas');
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    const cx = cw / 2 - cardW / 2;
    const cy = ch * 0.44 - cardH / 2;
    const rx = clamp(cw * 0.36, 150, 310);
    const ry = clamp(ch * 0.24, 90, 200);
    const cards = document.querySelectorAll('.music-card');
    const n = cards.length;
    cards.forEach((card, i) => {
      const angle = orbitAngle + (i / n) * Math.PI * 2;
      const tx = cx + Math.cos(angle) * rx;
      const ty = cy + Math.sin(angle) * ry;
      card.style.left = clamp(tx, 4, cw - cardW - 4) + 'px';
      card.style.top  = clamp(ty, CARD_TOP, ch - cardH - 4) + 'px';
    });
    orbitRAF = requestAnimationFrame(tick);
  }
  tick();
}

function stopOrbit() {
  if (orbitRAF) { cancelAnimationFrame(orbitRAF); orbitRAF = null; }
  const { w, h } = cardMetrics();
  document.querySelectorAll('.music-card').forEach(card => {
    const song = state.songs.find(s => s.id === card.dataset.id);
    if (song) {
      const pct = pxToPct(parseInt(card.style.left) || 0, parseInt(card.style.top) || 0, w, h);
      song.xp = pct.xp; song.yp = pct.yp;
    }
    card.style.transition = '';
  });
  saveDraft();
}

/* ═══════════════════════════════════════════
   INLINE MINI PLAYER (멀티플랫폼 임베드)
═══════════════════════════════════════════ */
function embedInfo(song) {
  // { src, h } 또는 null(임베드 불가 → 새 탭)
  if (song.platform === 'youtube' && song.videoId) {
    return { src: `https://www.youtube.com/embed/${song.videoId}?autoplay=1&rel=0`, h: 200 };
  }
  if (song.platform === 'spotify') {
    try {
      const m = new URL(song.url).pathname.match(/\/(track|album|playlist|episode|artist)\/([^/?]+)/);
      if (m) {
        const compact = (m[1] === 'track' || m[1] === 'episode');
        return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, h: compact ? 152 : 352 };
      }
    } catch(e) {}
    return null;
  }
  if (song.platform === 'soundcloud') {
    return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(song.url)}&auto_play=true&hide_related=true&show_comments=false&color=%23ff5500`, h: 166 };
  }
  if (song.platform === 'apple') {
    const src = song.url
      .replace('://music.apple.com', '://embed.music.apple.com')
      .replace('://www.music.apple.com', '://embed.music.apple.com');
    if (src.includes('embed.music.apple.com')) return { src, h: 175 };
    return null;
  }
  return null;
}

function openPlayer(song) {
  const info = embedInfo(song);
  if (!info) { // 임베드 불가 플랫폼 → 새 탭
    window.open(playUrl(song), '_blank', 'noopener,noreferrer');
    return;
  }
  const mp    = document.getElementById('mini-player');
  const frame = document.getElementById('mp-frame');
  const badge = document.getElementById('mp-badge');

  document.getElementById('mp-title').textContent = song.title || '';
  document.getElementById('mp-memo').textContent  = song.memo  || '';
  badge.className = 'mp-badge pf-bg-' + song.platform;
  badge.innerHTML = PF_ICONS[song.platform] || '';
  document.getElementById('mp-ext').href = playUrl(song);

  frame.innerHTML = `<iframe src="${esc(info.src)}" height="${info.h}"
    allow="autoplay; encrypted-media; clipboard-write; picture-in-picture; fullscreen"
    allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
    style="height:${info.h}px"></iframe>`;

  mp.classList.toggle('with-banner', !!state.isViewOnly);
  mp.classList.add('open');
}

function closePlayer() {
  const mp = document.getElementById('mini-player');
  mp.classList.remove('open');
  // 재생 중단: iframe 제거
  setTimeout(() => {
    if (!mp.classList.contains('open')) document.getElementById('mp-frame').innerHTML = '';
  }, 420);
}

/* ═══════════════════════════════════════════
   3D 카드 틸트
═══════════════════════════════════════════ */
function addTilt(card) {
  if (!HOVER_CAPABLE || REDUCED_MOTION) return;
  const inner = card.querySelector('.card-inner');
  if (!inner) return;

  card.addEventListener('mousemove', e => {
    if (orbitActive || card.classList.contains('dragging')) return;
    const r  = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width  - 0.5;
    const py = (e.clientY - r.top)  / r.height - 0.5;
    inner.style.transform =
      `perspective(640px) rotateX(${(-py * 11).toFixed(2)}deg) rotateY(${(px * 13).toFixed(2)}deg) translateZ(10px) scale(1.045)`;
    inner.style.setProperty('--gx', ((px + 0.5) * 100).toFixed(1) + '%');
    inner.style.setProperty('--gy', ((py + 0.5) * 100).toFixed(1) + '%');
  });
  card.addEventListener('mouseleave', () => { inner.style.transform = ''; });
}

/* ═══════════════════════════════════════════
   씬 패럴랙스 (2D인데 3D 느낌)
═══════════════════════════════════════════ */
function applyParallax(nx, ny) {
  const grid   = document.getElementById('bg-grid');
  const bgImg  = document.getElementById('char-bg');
  const canvas = document.getElementById('canvas');
  const cut    = document.getElementById('char-cutout');

  if (grid)   grid.style.transform   = `translate3d(${(-nx * 12).toFixed(1)}px, ${(-ny * 8).toFixed(1)}px, 0)`;
  if (bgImg)  bgImg.style.transform  = `translateX(-50%) translate3d(${(nx * 10).toFixed(1)}px, ${(ny * 7).toFixed(1)}px, 0)`;
  if (canvas) canvas.style.transform = `translate3d(${(nx * 16).toFixed(1)}px, ${(ny * 11).toFixed(1)}px, 0)`;
  if (cut)    cut.style.transform    = `translateX(-50%) translate3d(${(nx * 26).toFixed(1)}px, ${(ny * 17).toFixed(1)}px, 0)`;
}
function resetParallax() {
  const grid   = document.getElementById('bg-grid');
  const bgImg  = document.getElementById('char-bg');
  const canvas = document.getElementById('canvas');
  const cut    = document.getElementById('char-cutout');
  if (grid)   grid.style.transform   = '';
  if (bgImg)  bgImg.style.transform  = 'translateX(-50%)';
  if (canvas) canvas.style.transform = '';
  if (cut)    cut.style.transform    = 'translateX(-50%)';
}
function onParallaxMove(nx, ny) {
  if (REDUCED_MOTION) return;
  if (document.getElementById('screen-main').classList.contains('hidden')) return;
  if (parallaxRAF) return;
  parallaxRAF = requestAnimationFrame(() => {
    parallaxRAF = null;
    applyParallax(clamp(nx, -1, 1), clamp(ny, -1, 1));
  });
}
if (HOVER_CAPABLE) {
  window.addEventListener('mousemove', e => {
    onParallaxMove((e.clientX / window.innerWidth - 0.5) * 2,
                   (e.clientY / window.innerHeight - 0.5) * 2);
  });
} else if (window.DeviceOrientationEvent) {
  // 모바일 기울기 (권한 불필요 환경에서 동작 · iOS는 무해하게 무시)
  window.addEventListener('deviceorientation', e => {
    if (e.gamma == null || e.beta == null) return;
    onParallaxMove(clamp(e.gamma / 30, -1, 1), clamp((e.beta - 45) / 30, -1, 1));
  });
}

/* ═══════════════════════════════════════════
   SHARE
═══════════════════════════════════════════ */
function generateShare() {
  if (orbitActive) stopOrbit(); // 현재 위치 확정

  // 페이로드: [char, nick, title, [ [pcode, urlOrId, title, memo, x36, y36], ... ]]
  const payload = [
    state.selectedCharacter || 1,
    state.nickname || '',
    state.playlistTitle || '',
    state.songs.map(s => {
      const x36 = Math.round(clamp(s.xp || 0, 0, 1) * 1000).toString(36);
      const y36 = Math.round(clamp(s.yp || 0, 0, 1) * 1000).toString(36);
      const ref = (s.platform === 'youtube' && s.videoId) ? s.videoId : s.url;
      return [ PF_CODE[s.platform] ?? 4, ref, s.title || '', s.memo || '', x36, y36 ];
    }),
  ];

  const json = JSON.stringify(payload);
  const encoded = LZString.compressToEncodedURIComponent(json);
  const url = `${location.origin}${location.pathname}?data=${encoded}`;

  const box = document.getElementById('share-box');
  box.dataset.url = url;
  box.textContent = '클릭하여 링크 복사 — ' + url.slice(0, 64) + (url.length > 64 ? '...' : '');
  box.classList.add('visible');
  showToast('공유 링크가 생성됐어요');
}

function copyShare() {
  const url = document.getElementById('share-box').dataset.url;
  if (!url) return;
  navigator.clipboard.writeText(url)
    .then(() => showToast('링크가 복사됐어요'))
    .catch(() => prompt('아래 링크를 복사하세요:', url));
}

function decodeShareData(raw) {
  const json = window.LZString ? LZString.decompressFromEncodedURIComponent(raw) : null;
  if (json) {
    const data = JSON.parse(json);
    if (Array.isArray(data)) {
      const songsRaw = data[3] || [];
      return {
        selectedCharacter: data[0] || 1,
        nickname: data[1] || '',
        playlistTitle: data[2] || '',
        songs: songsRaw.map((item, i) => decodeSongItem(item, i)),
      };
    }
    // 아주 오래된 compact object 방식
    if (data && data.s) {
      return {
        selectedCharacter: data.c || 1,
        nickname: data.n || '',
        playlistTitle: data.t || '',
        songs: (data.s || []).map((item, i) => ({
          id: Date.now().toString() + '_' + i,
          platform: 'youtube', videoId: item[0],
          url: `https://www.youtube.com/watch?v=${item[0]}`,
          title: item[1], memo: item[2] || '',
          xp: null, yp: null,
        })),
      };
    }
  }
  // 레거시 base64 방식
  try { return JSON.parse(decodeURIComponent(atob(raw))); }
  catch(e) {
    return { selectedCharacter: 1, nickname: '', playlistTitle: '', songs: [] };
  }
}

function decodeSongItem(item, i) {
  const id = Date.now().toString() + '_' + i;

  // 신규 포맷: 첫 요소가 숫자(플랫폼 코드)
  if (typeof item[0] === 'number') {
    const platform = PF_FROM_CODE[item[0]] || 'other';
    const ref = item[1];
    const url = platform === 'youtube'
      ? `https://www.youtube.com/watch?v=${ref}`
      : ref;
    return {
      id, platform,
      videoId: platform === 'youtube' ? ref : null,
      url,
      title: item[2] || '', memo: item[3] || '',
      xp: (parseInt(item[4], 36) || 0) / 1000,
      yp: (parseInt(item[5], 36) || 0) / 1000,
    };
  }

  // 구 YouTube 전용 포맷: [videoId, title, (memo,) x36, y36] — px 좌표
  const hasMemo = item.length === 5;
  const vid = item[0];
  const px  = parseInt(item[hasMemo ? 3 : 2], 36) || 80;
  const py  = parseInt(item[hasMemo ? 4 : 3], 36) || 120;
  return {
    id, platform: 'youtube', videoId: vid,
    url: `https://www.youtube.com/watch?v=${vid}`,
    title: item[1] || '', memo: hasMemo ? (item[2] || '') : '',
    x: px, y: py,     // normalizeSong 이 px→pct 변환
  };
}

/* ═══════════════════════════════════════════
   VIEW-ONLY → MAKE OWN
═══════════════════════════════════════════ */
function makeOwn() {
  stopOrbit();
  history.replaceState({}, '', location.pathname);
  state.isViewOnly = false;
  document.getElementById('view-banner').classList.remove('show');
  document.getElementById('btn-edit').style.display = '';
  document.getElementById('btn-orbit').style.display = '';
  renderCards();
  setTimeout(() => togglePanel(), 200);
  showToast('이제 자유롭게 편집해보세요');
}

/* ═══════════════════════════════════════════
   LOCALSTORAGE
═══════════════════════════════════════════ */
function saveDraft() {
  if (state.isViewOnly) return;
  try {
    localStorage.setItem('moodlist_draft', JSON.stringify({
      nickname:          state.nickname,
      playlistTitle:     state.playlistTitle,
      selectedCharacter: state.selectedCharacter,
      songs:             state.songs,
    }));
  } catch(e) {}
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
let toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function jsEsc(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal-add');
  if (modal) modal.addEventListener('click', function(e) { if (e.target === this) closeAddModal(); });
});
