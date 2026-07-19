const state = {
  collection: [],
  sorted: [],
  filtered: [],
  images: new Map(),
  source: 'local',
  username: '',
  currentSlice: 0,
  animationId: null,
  animationStartedAt: 0,
  recorder: null,
  recordingStopTimer: null,
  recordingProgressFrame: null,
  recordingStartedAt: 0,
  recordingDurationSeconds: 0,
  chunks: [],
};

const els = {
  count: document.getElementById('collection-count'),
  artistCount: document.getElementById('artist-count'),
  sourceLabel: document.getElementById('collection-source-label'),
  tabs: document.querySelectorAll('.tab-button'),
  views: document.querySelectorAll('.view'),
  sampleCards: document.querySelectorAll('.sample-card[data-sample-mode]'),
  grid: document.getElementById('grid-container'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  userForm: document.getElementById('user-loader'),
  username: document.getElementById('discogs-username'),
  loadLocal: document.getElementById('load-local'),
  search: document.getElementById('search-input'),
  sort: document.getElementById('sort-select'),
  visualMode: document.getElementById('visual-mode'),
  format: document.getElementById('format-select'),
  coverSizeControl: document.getElementById('cover-size-control'),
  coverSize: document.getElementById('cover-size'),
  coverSizeValue: document.getElementById('cover-size-value'),
  recordDuration: document.getElementById('record-duration'),
  recordDurationValue: document.getElementById('record-duration-value'),
  title: document.getElementById('export-title'),
  showUsername: document.getElementById('show-username'),
  sliceControls: document.getElementById('slice-controls'),
  sliceLabel: document.getElementById('slice-label'),
  prevSlice: document.getElementById('prev-slice'),
  nextSlice: document.getElementById('next-slice'),
  renderPng: document.getElementById('render-png'),
  playMotion: document.getElementById('play-motion'),
  recordMotion: document.getElementById('record-motion'),
  stopMotion: document.getElementById('stop-motion'),
  exportStatus: document.getElementById('export-status'),
  recordingOverlay: document.getElementById('recording-overlay'),
  recordingTitle: document.getElementById('recording-title'),
  recordingProgressBar: document.getElementById('recording-progress-bar'),
  recordingTime: document.getElementById('recording-time'),
  canvas: document.getElementById('export-canvas'),
};

const ctx = els.canvas.getContext('2d');

const formats = {
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1350 },
  wide: { width: 1920, height: 1080 },
};

const palette = {
  ink: '#14110f',
  paper: '#fff5e6',
  cream: '#f5f1ea',
  muted: '#9c9285',
  accent: '#f04d2f',
  cyan: '#21b7c8',
  gold: '#d8a625',
};

async function init() {
  bindEvents();
  const urlUsername = getUsernameFromUrl();
  if (urlUsername) {
    els.username.value = urlUsername;
  } else {
    els.username.value = '';
  }
  try {
    await loadCollection(urlUsername ? { username: urlUsername } : { local: true });
  } catch (error) {
    els.error.textContent = `Could not load collection: ${error.message}`;
    els.error.style.display = 'block';
  } finally {
    els.loading.style.display = 'none';
  }
}

function bindEvents() {
  els.userForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = sanitizeUsername(els.username.value);
    if (!username) {
      setError('Enter a Discogs username, or reset the demo collection.');
      return;
    }
    updateUrlUsername(username);
    await loadCollection({ username });
    switchView('studio', { scroll: true });
  });

  els.loadLocal.addEventListener('click', async () => {
    clearUrlUsername();
    els.username.value = '';
    await loadCollection({ local: true });
    switchView('studio', { scroll: true });
  });

  els.tabs.forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  els.sampleCards.forEach((button) => {
    button.addEventListener('click', () => {
      els.visualMode.value = button.dataset.sampleMode;
      syncSampleCards();
      switchView('studio', { scroll: true });
    });
  });

  els.search.addEventListener('input', applyBrowseControls);
  els.sort.addEventListener('change', applyBrowseControls);

  [els.visualMode, els.format, els.coverSize, els.recordDuration, els.title, els.showUsername].forEach((input) => {
    input.addEventListener('input', () => {
      if (input === els.coverSize) {
        els.coverSizeValue.textContent = els.coverSize.value;
      }
      if (input === els.recordDuration) {
        els.recordDurationValue.textContent = els.recordDuration.value;
      }
      if (input === els.visualMode) {
        syncSampleCards();
      }
      state.currentSlice = clamp(state.currentSlice, 0, Math.max(0, getSliceCount() - 1));
      renderStudio();
    });
  });

  els.prevSlice.addEventListener('click', () => {
    state.currentSlice = Math.max(0, state.currentSlice - 1);
    renderStudio();
  });

  els.nextSlice.addEventListener('click', () => {
    state.currentSlice = Math.min(getSliceCount() - 1, state.currentSlice + 1);
    renderStudio();
  });

  els.renderPng.addEventListener('click', downloadPng);
  els.playMotion.addEventListener('click', startMotion);
  els.recordMotion.addEventListener('click', recordMotion);
  els.stopMotion.addEventListener('click', stopMotion);
}

async function loadCollection({ username = '', local = false }) {
  stopMotion();
  setLoading(local ? 'Loading demo collection...' : `Loading ${username}'s public Discogs collection...`);
  clearError();
  state.images.clear();
  state.currentSlice = 0;

  try {
    const items = local ? await fetchLocalCollection() : await fetchPublicDiscogsCollection(username);
    if (!items.length) {
      throw new Error('No public records were found.');
    }

    state.source = local ? 'local' : 'discogs';
    state.username = local ? '' : username;
    state.collection = dedupeCollection(items);
    state.sorted = sortCollection(state.collection, els.sort.value || 'artist');
    state.filtered = state.sorted;
    els.title.value = state.username ? `${state.username}-rekkids` : 'sample-rekkids';
    updateStats();
    renderGrid();
    await preloadImages(state.collection);
    renderStudio();
    els.exportStatus.textContent = getSourceStatus();
  } catch (error) {
    if (!local) {
      await loadCollection({ local: true });
      setError(`Could not load ${username} from Discogs: ${error.message}. Showing the demo collection instead.`);
      return;
    }
    setError(`Could not load local collection: ${error.message}`);
  } finally {
    els.loading.style.display = 'none';
  }
}

async function fetchLocalCollection() {
  const response = await fetch(`collection.json?v=20260716-2`);
  if (!response.ok) {
    throw new Error(`collection.json returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('collection.json is not an array');
  }
  return data.map((item) => normalizeCollectionItem(item, { preferLocalCover: true }));
}

async function fetchPublicDiscogsCollection(username) {
  const clean = sanitizeUsername(username);
  if (!clean) {
    throw new Error('Missing username');
  }

  const all = [];
  let page = 1;
  let pages = 1;
  const maxPages = 30;

  do {
    const url = `https://api.discogs.com/users/${encodeURIComponent(clean)}/collection/folders/0/releases?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      throw new Error('collection is private, missing, or the username was not found');
    }
    if (!response.ok) {
      throw new Error(`Discogs returned HTTP ${response.status}`);
    }

    const data = await response.json();
    all.push(...(data.releases || []));
    pages = Math.min(Number(data.pagination?.pages || page), maxPages);
    page += 1;
  } while (page <= pages);

  return all.map(formatDiscogsRelease).filter(Boolean);
}

function formatDiscogsRelease(release) {
  const info = release.basic_information || release;
  const releaseId = info.id || release.id;
  const title = info.title;
  const artists = Array.isArray(info.artists) ? info.artists : [];
  const artist = artists
    .map((entry) => String(entry.name || '').replace(/ \(\d+\)$/, '').trim())
    .filter(Boolean)
    .join(', ') || 'Unknown Artist';
  const remoteImage = info.cover_image || info.thumb || '';

  if (!releaseId || !title || !remoteImage) {
    return null;
  }

  return normalizeCollectionItem({
    artist,
    title,
    release_id: releaseId,
    image_original_url: remoteImage,
    image: `covers/${releaseId}.jpg`,
    image_remote: remoteImage,
    discogs_url: `https://www.discogs.com/release/${releaseId}`,
  }, { preferLocalCover: true });
}

function normalizeCollectionItem(item, { preferLocalCover = false } = {}) {
  const releaseId = item.release_id || item.id;
  const remote = item.image_remote || item.image_original_url || item.cover_image || item.image || '';
  return {
    artist: item.artist || 'Unknown Artist',
    title: item.title || 'Untitled',
    release_id: releaseId,
    image_original_url: item.image_original_url || remote,
    image_remote: remote,
    image: preferLocalCover && releaseId ? `covers/${releaseId}.jpg` : (item.image || remote),
    discogs_url: item.discogs_url || `https://www.discogs.com/release/${releaseId}`,
  };
}

function switchView(viewName, { scroll = false } = {}) {
  els.tabs.forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  els.views.forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`));
  if (viewName === 'studio') {
    renderStudio();
  }
  if (scroll) {
    document.getElementById(`${viewName}-view`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function syncSampleCards() {
  els.sampleCards.forEach((button) => {
    button.classList.toggle('active', button.dataset.sampleMode === els.visualMode.value);
  });
}

function dedupeCollection(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || !item.release_id || seen.has(item.release_id)) {
      return false;
    }
    seen.add(item.release_id);
    return true;
  });
}

function sortCollection(items, mode) {
  const copy = [...items];
  if (mode === 'random') {
    return seededShuffle(copy, 'rekkids');
  }
  return copy.sort((a, b) => {
    const primary = mode === 'title' ? 'title' : 'artist';
    const secondary = mode === 'title' ? 'artist' : 'title';
    return String(a[primary] || '').localeCompare(String(b[primary] || ''), undefined, { sensitivity: 'base' }) ||
      String(a[secondary] || '').localeCompare(String(b[secondary] || ''), undefined, { sensitivity: 'base' });
  });
}

function seededShuffle(items, seedText) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  for (let i = items.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function updateStats() {
  const artistTotal = new Set(state.collection.map((item) => item.artist)).size;
  els.count.textContent = `${state.collection.length} records`;
  const source = state.username ? `public Discogs: ${state.username}` : 'demo collection';
  els.artistCount.textContent = `${artistTotal} artists · ${source}`;
  if (els.sourceLabel) {
    els.sourceLabel.textContent = state.username ? `${state.username}'s public collection` : 'Demo collection already loaded';
  }
}

function applyBrowseControls() {
  const query = els.search.value.trim().toLowerCase();
  state.sorted = sortCollection(state.collection, els.sort.value);
  state.filtered = state.sorted.filter((item) => {
    const haystack = `${item.artist} ${item.title} ${item.release_id}`.toLowerCase();
    return haystack.includes(query);
  });
  renderGrid();
}

function renderGrid() {
  if (!state.filtered.length) {
    els.grid.innerHTML = '<p class="message">No records match that search.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.forEach((item) => {
    const figure = document.createElement('figure');
    figure.className = 'record-card';

    const link = document.createElement('a');
    link.href = item.discogs_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const image = document.createElement('img');
    image.src = item.image;
    image.alt = `${item.artist} - ${item.title}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      if (item.image_remote && image.src !== item.image_remote) {
        image.src = item.image_remote;
      }
    }, { once: true });

    const caption = document.createElement('figcaption');
    caption.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist)}</span>`;

    link.appendChild(image);
    link.appendChild(caption);
    figure.appendChild(link);
    fragment.appendChild(figure);
  });

  els.grid.replaceChildren(fragment);
}

function preloadImages(items) {
  const batch = items.map((item) => new Promise((resolve) => {
    const img = new Image();
    if (/^https?:\/\//.test(item.image)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      state.images.set(item.release_id, img);
      resolve();
    };
    img.onerror = () => {
      if (item.image_remote && item.image_remote !== item.image) {
        const remoteImg = new Image();
        remoteImg.crossOrigin = 'anonymous';
        remoteImg.onload = () => {
          state.images.set(item.release_id, remoteImg);
          resolve();
        };
        remoteImg.onerror = () => resolve();
        remoteImg.src = item.image_remote;
        return;
      }
      resolve();
    };
    img.src = item.image;
  }));
  return Promise.all(batch);
}

function renderStudio() {
  stopAnimationFrameOnly();
  applyCanvasFormat();
  const mode = els.visualMode.value;
  els.coverSizeControl.hidden = mode === 'dungeon';
  els.sliceControls.style.display = mode === 'poster' ? 'grid' : 'none';
  updateExportControls();
  if (mode === 'poster') {
    drawPoster();
  } else {
    drawMotionFrame(getStaticMotionPreviewTime(mode), mode);
  }
}

function applyCanvasFormat() {
  const selected = formats[els.format.value];
  if (els.canvas.width !== selected.width || els.canvas.height !== selected.height) {
    els.canvas.width = selected.width;
    els.canvas.height = selected.height;
  }
}

function getPosterLayout() {
  const width = els.canvas.width;
  const height = els.canvas.height;
  const coverSize = Number(els.coverSize.value);
  const margin = Math.round(Math.min(width, height) * 0.055);
  const gap = Math.max(8, Math.round(coverSize * 0.055));
  const headerHeight = 0;
  const footerHeight = Math.round(height * 0.06);
  const gridTop = margin + headerHeight;
  const gridHeight = height - gridTop - margin - footerHeight;
  const cols = Math.max(1, Math.floor((width - margin * 2 + gap) / (coverSize + gap)));
  const rows = Math.max(1, Math.floor((gridHeight + gap) / (coverSize + gap)));
  return { width, height, coverSize, margin, gap, headerHeight, footerHeight, gridTop, cols, rows, perSlice: cols * rows };
}

function getSliceCount() {
  const { perSlice } = getPosterLayout();
  return Math.max(1, Math.ceil(state.sorted.length / perSlice));
}

function drawPoster() {
  const layout = getPosterLayout();
  const sliceCount = getSliceCount();
  state.currentSlice = clamp(state.currentSlice, 0, sliceCount - 1);
  const start = state.currentSlice * layout.perSlice;
  const items = state.sorted.slice(start, start + layout.perSlice);

  drawBackground();

  const usedWidth = layout.cols * layout.coverSize + (layout.cols - 1) * layout.gap;
  const x0 = Math.round((layout.width - usedWidth) / 2);

  items.forEach((item, index) => {
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    const x = x0 + col * (layout.coverSize + layout.gap);
    const y = layout.gridTop + row * (layout.coverSize + layout.gap);
    drawCover(item, x, y, layout.coverSize, 1, 0);
  });

  drawFooter(getCanvasFooterText());
  els.sliceLabel.textContent = `Slice ${state.currentSlice + 1} of ${sliceCount}`;
  els.prevSlice.disabled = state.currentSlice === 0;
  els.nextSlice.disabled = state.currentSlice >= sliceCount - 1;
}

function drawMotionFrame(progressSeconds, mode) {
  if (mode === 'dungeon') {
    drawRecordDungeon(progressSeconds);
    drawFooter(getCanvasFooterText());
    return;
  }
  drawBackground();
  if (mode === 'river') {
    drawCoverRiver(progressSeconds);
  } else if (mode === 'billboard') {
    drawBillboardRush(progressSeconds);
  } else if (mode === 'pile') {
    drawRecordPile(progressSeconds);
  } else {
    drawCrateFlip(progressSeconds);
  }
  drawFooter(getCanvasFooterText());
}

const dungeon = createDungeon();

function createDungeon() {
  const size = 21;
  const map = Array.from({ length: size }, () => Array(size).fill(1));
  const route = [
    [3, 3], [10, 3], [17, 3], [17, 9], [13, 9], [13, 6],
    [8, 6], [8, 11], [17, 11], [17, 17], [10, 17], [3, 17],
    [3, 12], [6, 12], [6, 8], [3, 8],
  ];

  for (let index = 0; index < route.length; index += 1) {
    const start = route[index];
    const end = route[(index + 1) % route.length];
    const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
    for (let step = 0; step <= steps; step += 1) {
      const amount = steps ? step / steps : 0;
      const x = Math.round(lerp(start[0], end[0], amount));
      const y = Math.round(lerp(start[1], end[1], amount));
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          map[y + offsetY][x + offsetX] = 0;
        }
      }
    }
  }
  return { map, route };
}

function drawRecordDungeon(seconds) {
  const items = state.sorted.length ? state.sorted : state.collection;
  const width = els.canvas.width;
  const height = els.canvas.height;
  if (!items.length) {
    drawBackground();
    return;
  }

  const horizon = Math.round(height * 0.49);
  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  ceiling.addColorStop(0, '#05090c');
  ceiling.addColorStop(1, '#172126');
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, width, horizon);
  const floor = ctx.createLinearGradient(0, horizon, 0, height);
  floor.addColorStop(0, '#46352a');
  floor.addColorStop(0.45, '#171515');
  floor.addColorStop(1, '#060708');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, width, height - horizon);

  const camera = getDungeonCamera(seconds);
  const directionX = Math.cos(camera.angle);
  const directionY = Math.sin(camera.angle);
  const planeScale = Math.tan((66 * Math.PI / 180) / 2);
  const planeX = -directionY * planeScale;
  const planeY = directionX * planeScale;
  const rayStep = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let featured = null;

  for (let screenX = 0; screenX < width; screenX += rayStep) {
    const cameraX = (2 * screenX) / width - 1;
    const rayX = directionX + planeX * cameraX;
    const rayY = directionY + planeY * cameraX;
    const hit = castDungeonRay(camera.x, camera.y, rayX, rayY, items.length);
    if (!hit) {
      continue;
    }

    const wallHeight = Math.min(height * 2.2, height / Math.max(0.12, hit.distance));
    const top = Math.round(horizon - wallHeight / 2);
    const item = items[hit.itemIndex];
    const img = state.images.get(item.release_id);
    const darkness = clamp((hit.distance - 1.5) * 0.025 + (hit.side ? 0.035 : 0), 0, 0.28);

    if (img) {
      const sourceX = clamp(Math.floor((1 - hit.textureX) * img.naturalWidth), 0, Math.max(0, img.naturalWidth - 1));
      ctx.drawImage(img, sourceX, 0, 1, img.naturalHeight, screenX, top, rayStep, wallHeight);
    } else {
      ctx.fillStyle = '#5d4e43';
      ctx.fillRect(screenX, top, rayStep, wallHeight);
    }

    ctx.fillStyle = `rgba(4, 8, 10, ${darkness})`;
    ctx.fillRect(screenX, top, rayStep, wallHeight);
    if (Math.abs(cameraX) < 0.015) {
      featured = { item, distance: hit.distance };
    }
  }

  drawDungeonAtmosphere(width, height, horizon);
  drawDungeonHud(featured, items.length, width, height);
}

function getDungeonCamera(seconds) {
  const route = dungeon.route;
  const secondsPerLeg = 4.2;
  const progress = seconds / secondsPerLeg;
  const leg = Math.floor(progress) % route.length;
  const phase = progress - Math.floor(progress);
  const start = route[leg];
  const end = route[(leg + 1) % route.length];
  const next = route[(leg + 2) % route.length];
  const currentAngle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const nextAngle = Math.atan2(next[1] - end[1], next[0] - end[0]);
  const angleDelta = shortestAngleDelta(currentAngle, nextAngle);
  const isCorner = Math.abs(angleDelta) > 0.05;
  const move = smoothstep(0, isCorner ? 0.52 : 1, phase);
  let x = lerp(start[0] + 0.5, end[0] + 0.5, move);
  let y = lerp(start[1] + 0.5, end[1] + 0.5, move);
  let angle = currentAngle;

  if (isCorner) {
    const peerIn = smoothstep(0.52, 0.66, phase);
    const peerOut = smoothstep(0.76, 0.86, phase);
    const peerDistance = 0.62 * peerIn * (1 - peerOut);
    x += Math.cos(currentAngle) * peerDistance;
    y += Math.sin(currentAngle) * peerDistance;
    const turn = smoothstep(0.86, 1, phase);
    angle += angleDelta * turn;
  }
  return { x, y, angle };
}

function castDungeonRay(originX, originY, rayX, rayY, itemCount) {
  let mapX = Math.floor(originX);
  let mapY = Math.floor(originY);
  const deltaX = Math.abs(1 / (rayX || 0.000001));
  const deltaY = Math.abs(1 / (rayY || 0.000001));
  const stepX = rayX < 0 ? -1 : 1;
  const stepY = rayY < 0 ? -1 : 1;
  let sideX = rayX < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
  let sideY = rayY < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;
  let side = 0;

  for (let depth = 0; depth < 48; depth += 1) {
    if (sideX < sideY) {
      sideX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      sideY += deltaY;
      mapY += stepY;
      side = 1;
    }
    if (!dungeon.map[mapY] || dungeon.map[mapY][mapX] === undefined) {
      return null;
    }
    if (dungeon.map[mapY][mapX]) {
      const distance = side === 0
        ? (mapX - originX + (1 - stepX) / 2) / rayX
        : (mapY - originY + (1 - stepY) / 2) / rayY;
      let wallPoint = side === 0 ? originY + distance * rayY : originX + distance * rayX;
      wallPoint -= Math.floor(wallPoint);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) {
        wallPoint = 1 - wallPoint;
      }
      const face = side === 0 ? (stepX > 0 ? 1 : 3) : (stepY > 0 ? 2 : 0);
      const itemIndex = Math.abs((mapX * 97 + mapY * 53 + face * 29)) % itemCount;
      return { distance: Math.abs(distance), textureX: wallPoint, itemIndex, side };
    }
  }
  return null;
}

function drawDungeonAtmosphere(width, height, horizon) {
  const vignette = ctx.createRadialGradient(width / 2, horizon, height * 0.12, width / 2, horizon, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(0.82, 'rgba(0, 0, 0, 0.06)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawDungeonHud(featured, itemCount, width, height) {
  const margin = Math.round(Math.min(width, height) * 0.055);
  const fontSize = Math.round(Math.min(width, height) * 0.024);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(6, 8, 9, 0.72)';
  ctx.fillRect(margin, margin, Math.min(width * 0.42, 520), fontSize * 2.9);
  ctx.fillStyle = palette.gold;
  ctx.font = `900 ${Math.round(fontSize * 0.72)}px monospace`;
  ctx.fillText(`RECORD DUNGEON  //  ${itemCount} LP`, margin + fontSize * 0.7, margin + fontSize);
  if (featured?.item && featured.distance < 7) {
    ctx.fillStyle = palette.paper;
    ctx.font = `800 ${fontSize}px Inter, sans-serif`;
    ctx.fillText(fitDungeonText(featured.item.title, 34), margin + fontSize * 0.7, margin + fontSize * 2.15);
    ctx.fillStyle = 'rgba(255, 245, 230, 0.7)';
    ctx.font = `650 ${Math.round(fontSize * 0.65)}px Inter, sans-serif`;
    ctx.fillText(fitDungeonText(featured.item.artist, 44), margin + fontSize * 0.7, margin + fontSize * 2.75);
  }
  ctx.restore();
}

function fitDungeonText(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function drawCoverRiver(seconds) {
  const size = Number(els.coverSize.value);
  const gap = Math.round(size * 0.14);
  const lanes = Math.max(2, Math.floor((els.canvas.height - 240) / (size + gap)));
  const yStart = Math.round((els.canvas.height - lanes * size - (lanes - 1) * gap) / 2) + 40;
  const laneItems = state.sorted.length ? state.sorted : state.collection;
  if (!laneItems.length) {
    return;
  }

  for (let lane = 0; lane < lanes; lane += 1) {
    const speed = (lane % 2 === 0 ? 54 : -42) + lane * 7;
    const direction = speed >= 0 ? 1 : -1;
    const cycle = size + gap;
    const y = yStart + lane * (size + gap);
    const distance = seconds * Math.abs(speed) + lane * cycle * 1.7;
    const tileShift = Math.floor(distance / cycle);
    const offset = distance % cycle;
    const visible = Math.ceil(els.canvas.width / cycle) + 4;
    const laneSeed = lane * 23;

    for (let i = -1; i < visible; i += 1) {
      const itemIndex = direction > 0
        ? laneSeed + i - tileShift
        : laneSeed + i + tileShift;
      const item = laneItems[wrapIndex(itemIndex, laneItems.length)];
      const baseX = direction > 0
        ? -cycle + i * cycle + offset
        : i * cycle - offset;
      drawCover(item, baseX, y, size, lane % 2 === 0 ? 0 : -1.4, 0);
    }
  }
}

function drawBillboardRush(seconds) {
  const base = Number(els.coverSize.value);
  const rows = 5;
  const items = state.sorted.length ? state.sorted : state.collection;
  if (!items.length) {
    return;
  }

  const width = els.canvas.width;
  const height = els.canvas.height;
  const minDimension = Math.min(width, height);
  const topSafe = Math.round(height * 0.13);
  const bottomSafe = Math.round(height - minDimension * 0.105);

  for (let row = 0; row < rows; row += 1) {
    const depth = row / (rows - 1);
    const scale = 0.58 + depth * 0.57;
    const size = base * scale;
    const verticalDepth = Math.pow(depth, 1.16);
    const y = lerp(topSafe, bottomSafe - size, verticalDepth);
    const speed = 95 + row * 34;
    const gap = size * 0.18;
    const cycle = size + gap;
    const distance = seconds * speed + row * cycle * 2.4;
    const tileShift = Math.floor(distance / cycle);
    const offset = distance % cycle;
    const visible = Math.ceil(width / cycle) + 5;
    const rowSeed = row * 31;

    ctx.globalAlpha = 0.48 + depth * 0.42;
    for (let i = -1; i < visible; i += 1) {
      const item = items[wrapIndex(rowSeed + i + tileShift, items.length)];
      const x = i * cycle - offset;
      drawCover(item, x, y, size, row % 2 ? -2.5 : 2.5, 0);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCrateFlip(seconds) {
  const items = state.sorted.length ? state.sorted : state.collection;
  if (!items.length) {
    return;
  }
  const size = Number(els.coverSize.value);
  const centerX = els.canvas.width / 2;
  const centerY = els.canvas.height * 0.58;
  const progress = seconds * 0.68;
  const baseIndex = Math.floor(progress);
  const phase = progress - baseIndex;
  const easing = easeInOutCubic(phase);
  const frontSize = size * 2.08;
  const stackCount = 9;
  const baseTilt = -7;

  drawCrateBase(centerX, centerY, frontSize, stackCount);

  for (let depth = stackCount; depth >= 1; depth -= 1) {
    const index = wrapIndex(baseIndex + depth, items.length);
    const advance = depth - easing;
    const scale = 1 - Math.min(advance, stackCount) * 0.045;
    const drawnSize = frontSize * Math.max(0.62, scale);
    const x = centerX - drawnSize / 2;
    const y = centerY - drawnSize / 2 - advance * 18;
    const continuousAlpha = 1 - Math.max(0, advance - 1.15) * 0.095;
    const rearFade = depth === stackCount ? smoothstep(0.08, 0.62, phase) : 1;
    ctx.globalAlpha = clamp(continuousAlpha, 0.28, 1) * rearFade;
    drawCover(items[index], x, y, drawnSize, baseTilt * clamp(advance, 0, 1), 20);
    ctx.globalAlpha = 1;
  }

  const featured = items[wrapIndex(baseIndex, items.length)];
  const next = items[wrapIndex(baseIndex + 1, items.length)];
  const flipStart = 0.38;
  const flipPhase = phase <= flipStart ? 0 : (phase - flipStart) / (1 - flipStart);
  const flip = easeInCubic(flipPhase);
  const frontY = centerY - frontSize / 2 + flip * frontSize * 0.98;
  const frontScaleY = Math.max(0.2, 1 - flip * 0.72);
  const frontAlpha = Math.max(0, 1 - flip * 1.08);
  drawFlippingCover(featured, centerX, frontY, frontSize, frontScaleY, flip * 10, frontAlpha);

  const captionItem = flip < 0.58 ? featured : next;
  ctx.fillStyle = palette.paper;
  ctx.font = `800 ${Math.round(els.canvas.width * 0.03)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(captionItem.title, centerX, centerY + frontSize * 0.77);
  ctx.fillStyle = palette.muted;
  ctx.font = `600 ${Math.round(els.canvas.width * 0.018)}px Inter, sans-serif`;
  ctx.fillText(captionItem.artist, centerX, centerY + frontSize * 0.87);
}

function drawRecordPile(seconds) {
  const items = state.sorted.length ? state.sorted : state.collection;
  if (!items.length) {
    return;
  }

  drawTabletop();

  const width = els.canvas.width;
  const height = els.canvas.height;
  const minDimension = Math.min(width, height);
  const pileLimit = getPileLimit(items);
  const countScale = clamp(Math.sqrt(84 / pileLimit), 0.54, 1);
  const coverSize = clamp(Number(els.coverSize.value) * 1.64 * countScale, minDimension * 0.105, minDimension * 0.235);
  const dealEvery = getPileDealEvery(items);
  const dealProgress = seconds / dealEvery;
  const activeDeal = Math.min(Math.floor(dealProgress), pileLimit - 1);
  const phase = dealProgress - activeDeal;

  for (let deal = 0; deal <= activeDeal; deal += 1) {
    const item = items[wrapIndex(deal, items.length)];
    const age = activeDeal - deal;
    const landing = getPileLanding(deal, coverSize, width, height);
    const isActive = deal === activeDeal;
    const settle = isActive ? easeDealtCard(clamp(phase, 0, 1)) : 1;
    const incoming = getPileEntry(deal, coverSize, width, height);
    const x = isActive ? lerp(incoming.x, landing.x, settle) : landing.x;
    const y = isActive ? lerp(incoming.y, landing.y, settle) : landing.y;
    const rotation = isActive ? lerp(incoming.rotate, landing.rotate, settle) : landing.rotate;
    const dropScale = isActive ? lerp(1.3, 1, settle) : 1;

    drawPileCover(item, x, y, coverSize * landing.scale * dropScale, rotation, 1, isActive, age);
  }

  drawPileCaption(items[wrapIndex(activeDeal, items.length)]);
}

function drawTabletop() {
  const width = els.canvas.width;
  const height = els.canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#6f4325');
  gradient.addColorStop(0.42, '#875730');
  gradient.addColorStop(1, '#3b2418');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let y = -height * 0.4; y < height * 1.3; y += Math.max(26, height * 0.038)) {
    ctx.strokeStyle = y % 3 ? '#fff2d5' : '#1b0f0a';
    ctx.lineWidth = Math.max(1, width * 0.0016);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.32, y + height * 0.045, width * 0.66, y - height * 0.04, width, y + height * 0.02);
    ctx.stroke();
  }
  ctx.restore();

  const shade = ctx.createRadialGradient(width * 0.48, height * 0.58, 0, width * 0.5, height * 0.58, Math.max(width, height) * 0.62);
  shade.addColorStop(0, 'rgba(255, 235, 190, 0.18)');
  shade.addColorStop(0.58, 'rgba(0, 0, 0, 0.08)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

function getPileLanding(index, size, width, height) {
  const fullX = -size * 0.55 + hashUnit(index, 1) * (width + size * 1.1);
  const fullY = -size * 0.42 + hashUnit(index, 2) * (height + size * 0.98);
  const centerX = width * 0.5 - size / 2 + hashSigned(index, 6) * width * 0.28;
  const centerY = height * 0.56 - size / 2 + hashSigned(index, 7) * height * 0.22;
  const scatter = hashUnit(index, 9) > 0.34 ? 0.88 : 0.48;
  const x = lerp(centerX, fullX, scatter);
  const y = lerp(centerY, fullY, scatter);
  const rotate = hashSigned(index, 3) * 36;
  const scale = 0.82 + hashUnit(index, 4) * 0.28;
  return { x, y, rotate, scale };
}

function getPileEntry(index, size, width, height) {
  const side = index % 4;
  const rotate = hashSigned(index, 8) * 54;
  if (side === 0) {
    return { x: width * 0.5 - size / 2, y: -size * 1.28, rotate };
  }
  if (side === 1) {
    return { x: width + size * 0.7, y: height * (0.24 + hashUnit(index, 6) * 0.3), rotate };
  }
  if (side === 2) {
    return { x: -size * 1.7, y: height * (0.3 + hashUnit(index, 7) * 0.34), rotate };
  }
  return { x: width * (0.22 + hashUnit(index, 5) * 0.58), y: height + size * 0.7, rotate };
}

function drawPileCover(item, x, y, size, rotateDeg, alpha, active, age = 0) {
  if (!item) {
    return;
  }
  const img = state.images.get(item.release_id);
  const radius = Math.max(8, size * 0.035);
  const detailed = active || age < 48 || age % 8 === 0;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = detailed ? (active ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.3)') : 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = detailed ? (active ? size * 0.16 : size * 0.055) : 0;
  ctx.shadowOffsetX = detailed ? size * 0.025 : 0;
  ctx.shadowOffsetY = detailed ? (active ? size * 0.08 : size * 0.032) : 0;
  drawRoundedRect(-size / 2, -size / 2, size, size, radius);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = '#2b2723';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = palette.muted;
    ctx.font = `800 ${Math.round(size * 0.18)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('?', 0, 8);
  }
  ctx.strokeStyle = 'rgba(255, 245, 230, 0.42)';
  ctx.lineWidth = Math.max(2, size * 0.014);
  drawRoundedRect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2, radius);
  ctx.stroke();
  ctx.restore();
}

function drawPileCaption(item) {
  if (!item) {
    return;
  }
  const width = els.canvas.width;
  const height = els.canvas.height;
  const margin = Math.round(Math.min(width, height) * 0.055);
  const y = height - margin * 1.55;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(20, 17, 15, 0.56)';
  ctx.fillRect(width - margin - width * 0.36, y - margin * 0.72, width * 0.36, margin * 1.15);
  ctx.fillStyle = palette.paper;
  ctx.font = `800 ${Math.round(width * 0.021)}px Inter, sans-serif`;
  ctx.fillText(item.title, width - margin, y - margin * 0.08);
  ctx.fillStyle = 'rgba(255, 245, 230, 0.72)';
  ctx.font = `650 ${Math.round(width * 0.014)}px Inter, sans-serif`;
  ctx.fillText(item.artist, width - margin, y + margin * 0.38);
  ctx.restore();
}

function drawCrateBase(centerX, centerY, frontSize, stackCount) {
  const width = frontSize * 1.18;
  const height = frontSize * 0.34;
  const x = centerX - width / 2;
  const y = centerY + frontSize * 0.38;
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, 'rgba(255, 245, 230, 0.16)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width * 0.86, y + height);
  ctx.lineTo(x + width * 0.14, y + height);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 245, 230, 0.13)';
  ctx.lineWidth = Math.max(2, frontSize * 0.01);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 245, 230, 0.06)';
  for (let i = 1; i <= stackCount; i += 1) {
    const lineY = centerY - frontSize / 2 - i * 18 + frontSize * 0.03;
    ctx.beginPath();
    ctx.moveTo(centerX - frontSize * 0.53, lineY);
    ctx.lineTo(centerX + frontSize * 0.53, lineY - frontSize * 0.08);
    ctx.stroke();
  }
}

function drawFlippingCover(item, centerX, y, size, scaleY, rotateDeg, alpha) {
  if (!item || alpha <= 0) {
    return;
  }
  const img = state.images.get(item.release_id);
  ctx.save();
  ctx.translate(centerX, y + size / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.scale(1, scaleY);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(12, size * 0.08);
  ctx.shadowOffsetY = Math.max(4, size * 0.06);
  drawRoundedRect(-size / 2, -size / 2, size, size, 20);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = '#2b2723';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = palette.muted;
    ctx.font = `800 ${Math.round(size * 0.18)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('?', 0, 8);
  }
  ctx.restore();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, els.canvas.width, els.canvas.height);
  gradient.addColorStop(0, '#15110f');
  gradient.addColorStop(0.48, '#251812');
  gradient.addColorStop(1, '#091f23');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  ctx.fillStyle = 'rgba(255, 245, 230, 0.05)';
  const step = Math.max(44, Math.round(els.canvas.width / 24));
  for (let x = -step; x < els.canvas.width + step; x += step) {
    ctx.fillRect(x, 0, 1, els.canvas.height);
  }
}

function drawFooter(text) {
  const margin = Math.round(Math.min(els.canvas.width, els.canvas.height) * 0.055);
  ctx.fillStyle = 'rgba(255, 245, 230, 0.76)';
  ctx.font = `700 ${Math.round(els.canvas.width * 0.014)}px Inter, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(text, margin, els.canvas.height - margin * 0.7);
}

function getCanvasFooterText() {
  if (!els.showUsername?.checked) {
    return 'rekkids.xyz';
  }
  const identity = state.username || 'sample collection';
  return `rekkids.xyz  |  ${identity}`;
}

function drawCover(item, x, y, size, rotateDeg = 0, radius = 0) {
  if (!item) {
    return;
  }
  const img = state.images.get(item.release_id);
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = Math.max(8, size * 0.08);
  ctx.shadowOffsetY = Math.max(3, size * 0.04);
  drawRoundedRect(-size / 2, -size / 2, size, size, radius);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = '#2b2723';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = palette.muted;
    ctx.font = `800 ${Math.round(size * 0.18)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('?', 0, 8);
  }
  ctx.restore();
}

function drawRoundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  if (!radius) {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function startMotion() {
  const mode = els.visualMode.value === 'poster' ? 'river' : els.visualMode.value;
  els.visualMode.value = mode;
  state.animationStartedAt = performance.now();
  stopAnimationFrameOnly();
  const tick = (now) => {
    const elapsed = (now - state.animationStartedAt) / 1000;
    drawMotionFrame(elapsed, mode);
    state.animationId = requestAnimationFrame(tick);
  };
  state.animationId = requestAnimationFrame(tick);
  els.exportStatus.textContent = `Previewing ${modeLabel(mode).toLowerCase()}.`;
  updateExportControls();
}

function stopAnimationFrameOnly() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }
}

function stopMotion() {
  stopAnimationFrameOnly();
  if (state.recordingStopTimer) {
    window.clearTimeout(state.recordingStopTimer);
    state.recordingStopTimer = null;
  }
  stopRecordingProgress();
  if (state.recorder && state.recorder.state !== 'inactive') {
    state.recorder.stop();
  }
  state.recorder = null;
  els.exportStatus.textContent = 'Motion stopped.';
  updateExportControls();
  if (state.collection.length) {
    renderStudio();
  }
}

function recordMotion() {
  if (!els.canvas.captureStream || !window.MediaRecorder) {
    els.exportStatus.textContent = 'This browser cannot record canvas video.';
    return;
  }

  if (isRecording()) {
    return;
  }

  if (state.recordingStopTimer) {
    window.clearTimeout(state.recordingStopTimer);
    state.recordingStopTimer = null;
  }

  const durationSeconds = getRecordDurationSeconds();
  const mode = els.visualMode.value === 'poster' ? 'river' : els.visualMode.value;
  startMotion();
  const stream = els.canvas.captureStream(30);
  const recording = createCompatibleRecorder(stream);
  if (!recording) {
    stopAnimationFrameOnly();
    els.exportStatus.textContent = 'This browser could not start a compatible video recorder.';
    return;
  }
  const { recorder, format } = recording;
  state.chunks = [];
  state.recorder = recorder;
  state.recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };
  state.recorder.onstop = () => {
    if (state.recordingStopTimer) {
      window.clearTimeout(state.recordingStopTimer);
      state.recordingStopTimer = null;
    }
    const actualMimeType = state.recorder?.mimeType || format.mimeType;
    const extension = actualMimeType.startsWith('video/mp4') ? 'mp4' : format.extension;
    const blob = new Blob(state.chunks, { type: actualMimeType });
    downloadBlob(blob, `${slugify(els.title.value)}-${els.visualMode.value}.${extension}`);
    els.exportStatus.textContent = extension === 'mp4'
      ? 'MP4 downloaded — ready to upload to Reddit.'
      : 'WebM downloaded. This browser cannot record MP4; try another current browser for Reddit uploads.';
    stopRecordingProgress({ complete: true });
    state.recorder = null;
    stopAnimationFrameOnly();
    updateExportControls();
  };
  state.recorder.start();
  startRecordingProgress(durationSeconds, mode);
  els.exportStatus.textContent = format.extension === 'mp4'
    ? `Generating a ${durationSeconds}-second Reddit-ready MP4 in this browser.`
    : `Generating a ${durationSeconds}-second WebM. This browser does not support MP4 recording.`;
  state.recordingStopTimer = window.setTimeout(() => {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.stop();
    }
  }, durationSeconds * 1000);
  updateExportControls();
}

function createCompatibleRecorder(stream) {
  const formats = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const format of formats) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported(format.mimeType)) {
      continue;
    }
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        videoBitsPerSecond: 8000000,
      });
      return { recorder, format };
    } catch (error) {
      // Some browsers report format support but still reject it for a canvas stream.
    }
  }
  return null;
}

function updateExportControls() {
  const isPoster = els.visualMode.value === 'poster';
  const recording = isRecording();
  const hasActiveMotion = Boolean(state.animationId) || recording;

  els.renderPng.hidden = !isPoster;
  els.playMotion.hidden = isPoster;
  els.recordMotion.hidden = isPoster;
  els.stopMotion.hidden = isPoster || !hasActiveMotion;

  els.renderPng.classList.toggle('primary', isPoster);
  els.recordMotion.classList.toggle('primary', !isPoster);
  els.recordMotion.textContent = recording ? 'Generating...' : 'Generate Video';

  els.renderPng.disabled = recording;
  els.playMotion.disabled = recording;
  els.recordMotion.disabled = recording;
}

function isRecording() {
  return Boolean(state.recorder && state.recorder.state !== 'inactive');
}

function startRecordingProgress(durationSeconds, mode) {
  stopRecordingProgress();
  state.recordingStartedAt = performance.now();
  state.recordingDurationSeconds = durationSeconds;
  els.recordingOverlay.hidden = false;
  els.recordingTitle.textContent = `${modeLabel(mode)} video`;
  updateRecordingProgress(0);

  const tick = () => {
    const elapsed = (performance.now() - state.recordingStartedAt) / 1000;
    updateRecordingProgress(elapsed);
    if (elapsed < state.recordingDurationSeconds && isRecording()) {
      state.recordingProgressFrame = requestAnimationFrame(tick);
    }
  };
  state.recordingProgressFrame = requestAnimationFrame(tick);
}

function updateRecordingProgress(elapsedSeconds) {
  const duration = Math.max(1, state.recordingDurationSeconds || getRecordDurationSeconds());
  const elapsed = clamp(elapsedSeconds, 0, duration);
  const percent = (elapsed / duration) * 100;
  els.recordingProgressBar.style.width = `${percent.toFixed(1)}%`;
  els.recordingTime.textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
}

function stopRecordingProgress({ complete = false } = {}) {
  if (state.recordingProgressFrame) {
    cancelAnimationFrame(state.recordingProgressFrame);
    state.recordingProgressFrame = null;
  }
  if (complete) {
    updateRecordingProgress(state.recordingDurationSeconds || getRecordDurationSeconds());
  } else {
    els.recordingProgressBar.style.width = '0%';
  }
  window.setTimeout(() => {
    if (!isRecording()) {
      els.recordingOverlay.hidden = true;
    }
  }, complete ? 450 : 0);
}

function formatTime(seconds) {
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function downloadPng() {
  if (els.visualMode.value !== 'poster') {
    drawMotionFrame(getStaticMotionPreviewTime(els.visualMode.value), els.visualMode.value);
  } else {
    drawPoster();
  }
  try {
    els.canvas.toBlob((blob) => {
      if (!blob) {
        els.exportStatus.textContent = 'PNG export failed. Remote cover images may not be exportable from the browser yet.';
        return;
      }
      const suffix = els.visualMode.value === 'poster' ? `slice-${state.currentSlice + 1}` : els.visualMode.value;
      downloadBlob(blob, `${slugify(els.title.value)}-${suffix}.png`);
      els.exportStatus.textContent = 'PNG downloaded.';
    }, 'image/png');
  } catch (error) {
    els.exportStatus.textContent = `PNG export failed: ${error.message}. This usually means remote Discogs covers need a server-side cache.`;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function modeLabel(mode) {
  return {
    poster: 'Image slices',
    river: 'Cover river',
    billboard: 'Billboard rush',
    dungeon: 'Record dungeon',
    crate: 'Crate flip',
    pile: 'Record pile',
  }[mode] || 'Visual';
}

function getStaticMotionPreviewTime(mode) {
  if (mode === 'pile') {
    const items = state.sorted.length ? state.sorted : state.collection;
    return getPileDealEvery(items) * Math.max(1, getPileLimit(items) - 1);
  }
  return 2.5;
}

function getPileLimit(items) {
  return Math.max(1, Math.min(items.length || 1, 240));
}

function getPileDealEvery(items) {
  const limit = getPileLimit(items);
  return clamp((getRecordDurationSeconds() * 0.92) / limit, 0.16, 0.55);
}

function getRecordDurationSeconds() {
  return Number(els.recordDuration?.value || 30);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInCubic(value) {
  const t = clamp(value, 0, 1);
  return t * t * t;
}

function easeDealtCard(value) {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function hashUnit(index, salt) {
  const value = Math.sin((index + 1) * 91.345 + salt * 43.21) * 10000;
  return value - Math.floor(value);
}

function hashSigned(index, salt) {
  return hashUnit(index, salt) * 2 - 1;
}

function getUsernameFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeUsername(params.get('u') || params.get('user') || '');
}

function updateUrlUsername(username) {
  const url = new URL(window.location.href);
  url.searchParams.set('u', username);
  window.history.replaceState({}, '', url);
}

function clearUrlUsername() {
  const url = new URL(window.location.href);
  url.searchParams.delete('u');
  url.searchParams.delete('user');
  window.history.replaceState({}, '', url);
}

function sanitizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9_.-]/g, '');
}

function setLoading(message) {
  els.loading.textContent = message;
  els.loading.style.display = 'block';
}

function clearError() {
  els.error.textContent = '';
  els.error.style.display = 'none';
}

function setError(message) {
  els.error.textContent = message;
  els.error.style.display = 'block';
}

function getSourceStatus() {
  if (state.source === 'discogs') {
    return 'Loaded from public Discogs data. Choose a motion visual and generate a video.';
  }
  return 'Demo collection loaded. Choose a motion visual and generate a video.';
}

function slugify(value) {
  return String(value || 'rekkids')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'rekkids';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

init();
