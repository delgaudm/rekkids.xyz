const state = {
  collection: [],
  sorted: [],
  filtered: [],
  images: new Map(),
  imageUrls: new Map(),
  imageLoadGeneration: 0,
  discogsCooldownUntil: 0,
  source: 'local',
  sourceTotal: 0,
  sourceFetched: 0,
  mediaFilter: 'all',
  representativeSample: false,
  visualItems: [],
  visualShuffleSeed: 0,
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
  sourceLabel: document.getElementById('collection-source-label'),
  tabs: document.querySelectorAll('.tab-button'),
  views: document.querySelectorAll('.view'),
  sampleCards: document.querySelectorAll('.sample-card[data-sample-mode]'),
  grid: document.getElementById('grid-container'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  userForm: document.getElementById('user-loader'),
  username: document.getElementById('discogs-username'),
  mediaFilter: document.getElementById('media-filter'),
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
  visualOrder: document.getElementById('visual-order'),
  reshuffleCovers: document.getElementById('reshuffle-covers'),
  title: document.getElementById('export-title'),
  showUsername: document.getElementById('show-username'),
  coverLoadingStatuses: document.querySelectorAll('[data-cover-loading-status]'),
  coverLoadingTexts: document.querySelectorAll('[data-cover-loading-text]'),
  coverLoadingBars: document.querySelectorAll('[data-cover-loading-bar]'),
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
  els.mediaFilter.value = getMediaFilterFromUrl();
  if (urlUsername) {
    els.username.value = urlUsername;
  } else {
    els.username.value = '';
  }
  try {
    await loadCollection(urlUsername ? { username: urlUsername, mediaFilter: els.mediaFilter.value } : { local: true });
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
    const mediaFilter = sanitizeMediaFilter(els.mediaFilter.value);
    updateUrlCollectionOptions(username, mediaFilter);
    await loadCollection({ username, mediaFilter });
    switchView('studio', { scroll: true });
  });

  els.loadLocal.addEventListener('click', async () => {
    clearUrlUsername();
    els.username.value = '';
    els.mediaFilter.value = 'all';
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

  els.visualOrder.addEventListener('change', () => {
    if (els.visualOrder.value === 'shuffle') {
      state.visualShuffleSeed += 1;
    }
    refreshVisualOrder();
    renderStudio();
  });

  els.reshuffleCovers.addEventListener('click', () => {
    els.visualOrder.value = 'shuffle';
    state.visualShuffleSeed += 1;
    refreshVisualOrder();
    renderStudio();
  });

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

async function loadCollection({ username = '', local = false, mediaFilter = 'all' }) {
  stopMotion();
  state.imageLoadGeneration += 1;
  const loadGeneration = state.imageLoadGeneration;
  setLoading(local ? 'Loading demo collection...' : `Loading ${username}'s public Discogs collection...`);
  resetCoverLoadingStatus();
  clearError();
  clearLoadedImages();
  state.images.clear();
  state.currentSlice = 0;

  try {
    const result = local
      ? { items: await fetchLocalCollection(), total: 0, fetched: 0, representativeSample: false }
      : await fetchPublicDiscogsCollection(username, mediaFilter);
    const { items } = result;
    if (!items.length) {
      throw new Error('No public records were found.');
    }

    state.source = local ? 'local' : 'discogs';
    state.sourceTotal = local ? items.length : result.total;
    state.sourceFetched = local ? items.length : result.fetched;
    state.mediaFilter = local ? 'all' : sanitizeMediaFilter(mediaFilter);
    state.representativeSample = Boolean(result.representativeSample);
    state.username = local ? '' : username;
    state.collection = dedupeCollection(items);
    state.sorted = sortCollection(state.collection, els.sort.value || 'artist');
    state.filtered = state.sorted;
    state.visualShuffleSeed += 1;
    refreshVisualOrder();
    els.title.value = state.username ? `${state.username}-rekkids` : 'sample-rekkids';
    updateStats();
    renderGrid();
    renderStudio();
    els.exportStatus.textContent = getSourceStatus();
    preloadImages(state.collection, loadGeneration, { delayMs: local ? 0 : 400 }).catch(() => {
      if (loadGeneration === state.imageLoadGeneration) {
        updateCoverLoadingStatus({ processed: 0, total: state.collection.length, failed: true });
      }
    });
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

async function fetchPublicDiscogsCollection(username, mediaFilter = 'all') {
  const clean = sanitizeUsername(username);
  if (!clean) {
    throw new Error('Missing username');
  }

  const maxItems = getPublicCollectionLimit();
  const firstPage = await fetchPublicDiscogsPage(clean, 1);
  const total = Number(firstPage.pagination?.items || firstPage.releases?.length || 0);
  const totalPages = Number(firstPage.pagination?.pages || 1);
  const pageBudget = Math.min(totalPages, Math.max(1, Math.ceil(maxItems / 100)));
  const sampledPages = getRepresentativePageNumbers(totalPages, pageBudget);
  const all = [...(firstPage.releases || [])];

  for (const [index, page] of sampledPages.slice(1).entries()) {
    setLoading(`Sampling ${formatMediaFilter(mediaFilter)} collection metadata… ${index + 2} of ${sampledPages.length} pages`);
    await delay(400);
    const data = await fetchPublicDiscogsPage(clean, page);
    all.push(...(data.releases || []));
  }

  const selected = all
    .filter((release) => matchesMediaFilter(release, mediaFilter))
    .slice(0, maxItems)
    .map(formatDiscogsRelease)
    .filter(Boolean);

  return {
    items: selected,
    total,
    fetched: Math.min(all.length, maxItems),
    representativeSample: totalPages > sampledPages.length && sampledPages.length > 1,
  };
}

async function fetchPublicDiscogsPage(username, page) {
  const url = `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=100&page=${page}`;
  let response = await fetchDiscogsPage(url);

  if (response.status === 429) {
    state.discogsCooldownUntil = Date.now() + 65000;
    setLoading('Discogs asked us to slow down. Cooling down for about 65 seconds…');
    await waitForDiscogsCooldown();
    response = await fetchDiscogsPage(url);
  }
  if (response.status === 404) {
    throw new Error('collection is private, missing, or the username was not found');
  }
  if (!response.ok) {
    throw new Error(`Discogs returned HTTP ${response.status}`);
  }
  return response.json();
}

function getRepresentativePageNumbers(totalPages, pageBudget) {
  if (pageBudget >= totalPages) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (pageBudget <= 1) {
    return [1];
  }
  const pages = new Set();
  for (let index = 0; index < pageBudget; index += 1) {
    pages.add(1 + Math.round((index * (totalPages - 1)) / (pageBudget - 1)));
  }
  return [...pages].sort((a, b) => a - b);
}

function matchesMediaFilter(release, mediaFilter) {
  const selected = sanitizeMediaFilter(mediaFilter);
  if (selected === 'all') {
    return true;
  }
  const formats = release.basic_information?.formats || release.formats || [];
  const names = formats.map((format) => String(format.name || '').toLowerCase());
  if (selected === 'other') {
    return !names.some((name) => ['vinyl', 'cd', 'cassette'].includes(name));
  }
  return names.includes(selected);
}

async function fetchDiscogsPage(url) {
  await waitForDiscogsCooldown();
  return fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
}

async function waitForDiscogsCooldown() {
  const remaining = state.discogsCooldownUntil - Date.now();
  if (remaining > 0) {
    await delay(remaining);
  }
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
  const mediaTypes = (info.formats || [])
    .map((format) => String(format.name || '').trim())
    .filter(Boolean);

  if (!releaseId || !title || !remoteImage) {
    return null;
  }

  return normalizeCollectionItem({
    artist,
    title,
    release_id: releaseId,
    image_original_url: remoteImage,
    image: remoteImage,
    image_remote: remoteImage,
    media_types: mediaTypes,
    discogs_url: `https://www.discogs.com/release/${releaseId}`,
  });
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
    media_types: Array.isArray(item.media_types) ? item.media_types : [],
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

function refreshVisualOrder() {
  const alphabetical = sortCollection(state.collection, 'artist');
  state.visualItems = els.visualOrder.value === 'shuffle'
    ? seededShuffle(alphabetical, `${state.username || 'demo'}:${state.visualShuffleSeed}`)
    : alphabetical;
  els.reshuffleCovers.hidden = els.visualOrder.value !== 'shuffle';
}

function getVisualItems() {
  return state.visualItems.length ? state.visualItems : state.collection;
}

function updateStats() {
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
    const loadedUrl = state.imageUrls.get(item.release_id);
    if (loadedUrl) {
      image.src = loadedUrl;
    }
    image.dataset.releaseId = String(item.release_id);
    image.alt = `${item.artist} - ${item.title}`;
    image.loading = 'lazy';

    const caption = document.createElement('figcaption');
    caption.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist)}</span>`;

    link.appendChild(image);
    link.appendChild(caption);
    figure.appendChild(link);
    fragment.appendChild(figure);
  });

  els.grid.replaceChildren(fragment);
}

async function preloadImages(items, generation, { delayMs = 400 } = {}) {
  let processed = 0;
  let loaded = 0;
  const failures = new Map();
  updateCoverLoadingStatus({ processed, total: items.length });

  for (const item of items) {
    if (generation !== state.imageLoadGeneration) {
      return;
    }

    let result = await preloadImage(item);
    if (result.outcome === 'throttled') {
      state.discogsCooldownUntil = Date.now() + 65000;
      updateCoverLoadingStatus({ processed, total: items.length, loaded, cooldownSeconds: 65 });
      await waitForDiscogsCooldown();
      if (generation !== state.imageLoadGeneration) {
        return;
      }
      result = await preloadImage(item);
      if (result.outcome === 'throttled') {
        recordCoverFailure(failures, result);
        reportCoverFailures(failures);
        updateCoverLoadingStatus({ processed, total: items.length, loaded, failure: getPrimaryCoverFailure(failures) });
        return;
      }
    }

    processed += 1;
    if (result.outcome === 'loaded') {
      loaded += 1;
    } else {
      recordCoverFailure(failures, result);
    }
    updateCoverLoadingStatus({ processed, total: items.length, loaded });
    if (!state.animationId && !isRecording() && (processed % 12 === 0 || processed === items.length)) {
      renderStudio();
    }
    if (processed < items.length && delayMs > 0) {
      await delay(delayMs);
    }
  }

  if (processed === items.length && failures.size > 0) {
    reportCoverFailures(failures);
    updateCoverLoadingStatus({ processed, total: items.length, loaded, failure: getPrimaryCoverFailure(failures) });
  }
}

async function preloadImage(item) {
  const urls = [...new Set([item.image, item.image_remote].filter(Boolean))];
  let lastFailure = { outcome: 'failed', reason: 'missing-url' };
  for (const url of urls) {
    try {
      const response = await fetch(getCoverFetchUrl(url), { headers: { Accept: 'image/*' } });
      const contentType = response.headers.get('content-type') || '';
      if (response.status === 429) {
        return { outcome: 'throttled', reason: 'rate-limit', httpStatus: response.status };
      }
      if (!response.ok || !contentType.startsWith('image/')) {
        const message = await response.text();
        if (/too (?:many|fast)|thrott|rate.?limit/i.test(message)) {
          return { outcome: 'throttled', reason: 'rate-limit', httpStatus: response.status };
        }
        lastFailure = {
          outcome: 'failed',
          reason: response.ok ? 'non-image-response' : 'proxy-http',
          httpStatus: response.status,
          contentType,
        };
        continue;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      let img;
      try {
        img = await loadImageElement(objectUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        lastFailure = { outcome: 'failed', reason: 'image-decode' };
        continue;
      }
      state.images.set(item.release_id, img);
      state.imageUrls.set(item.release_id, objectUrl);
      updateGridCover(item.release_id, objectUrl);
      return { outcome: 'loaded' };
    } catch (error) {
      lastFailure = { outcome: 'failed', reason: 'network' };
    }
  }
  return lastFailure;
}

function recordCoverFailure(failures, result) {
  const key = `${result.reason || 'unknown'}:${result.httpStatus || 0}`;
  const current = failures.get(key) || { ...result, count: 0 };
  current.count += 1;
  failures.set(key, current);
}

function getPrimaryCoverFailure(failures) {
  return [...failures.values()].sort((a, b) => b.count - a.count)[0] || { reason: 'unknown', count: 0 };
}

function reportCoverFailures(failures) {
  const summary = [...failures.values()].map(({ reason, httpStatus, contentType, count }) => ({
    reason,
    httpStatus: httpStatus || undefined,
    contentType: contentType || undefined,
    count,
  }));
  console.warn('Cover loading failure summary', summary);
}

function getCoverFetchUrl(url) {
  if (!/^https?:\/\//.test(url)) {
    return url;
  }
  return `/.netlify/images?url=${encodeURIComponent(url)}&fm=jpg&q=90`;
}

function getPublicCollectionLimit() {
  const requested = Number(new URLSearchParams(window.location.search).get('limit'));
  if (Number.isFinite(requested) && requested > 0) {
    return clamp(Math.floor(requested), 1, 800);
  }
  return 800;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function updateGridCover(releaseId, src) {
  const selector = `img[data-release-id="${String(releaseId)}"]`;
  els.grid.querySelectorAll(selector).forEach((image) => {
    image.src = src;
  });
}

function clearLoadedImages() {
  state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
  state.imageUrls.clear();
}

function updateCoverLoadingStatus({ processed, total, loaded = processed, cooldownSeconds = 0, failed = false, failure = null }) {
  if (!els.coverLoadingStatuses.length) {
    return;
  }
  els.coverLoadingStatuses.forEach((status) => {
    status.hidden = false;
  });
  const percent = total ? (processed / total) * 100 : 0;
  els.coverLoadingBars.forEach((bar) => {
    bar.style.width = `${percent.toFixed(1)}%`;
  });
  const collectionScope = getCoverCollectionScopeMessage();
  let message;
  if (failed || failure) {
    message = `${getCoverFailureMessage({ loaded, total, failure })}${collectionScope}`;
  } else if (cooldownSeconds) {
    message = `Discogs asked us to slow down. Loaded ${loaded} of ${total}; cooling down for about ${cooldownSeconds} seconds…${collectionScope}`;
  } else if (processed >= total) {
    message = `${loaded} covers ready.${collectionScope}`;
  } else {
    message = `Loading covers… ${processed} of ${total}.${collectionScope}`;
  }
  els.coverLoadingTexts.forEach((text) => {
    text.textContent = message;
  });
}

function getCoverCollectionScopeMessage() {
  if (state.source !== 'discogs') {
    return '';
  }
  if (state.representativeSample) {
    return ` ${formatMediaSampleLabel(state.mediaFilter)} drawn across ${state.sourceTotal.toLocaleString()} collection entries.`;
  }
  if (state.sourceTotal <= state.sourceFetched) {
    return '';
  }
  return ` Collection capped at the first ${state.sourceFetched.toLocaleString()} of ${state.sourceTotal.toLocaleString()} entries.`;
}

function getCoverFailureMessage({ loaded, total, failure }) {
  const status = failure?.httpStatus ? ` (HTTP ${failure.httpStatus})` : '';
  if (failure?.reason === 'proxy-http' && failure.httpStatus === 404 && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
    return `The local cover proxy is unavailable${status}. Run the site with \`npx netlify-cli dev\`, then try again. Loaded ${loaded} of ${total}.`;
  }
  if (failure?.reason === 'rate-limit') {
    return `Discogs or the cover proxy is still rate-limiting requests${status}. Loaded ${loaded} of ${total}; please wait and try again later.`;
  }
  if (failure?.reason === 'proxy-http') {
    return `The cover proxy could not retrieve the images${status}. Loaded ${loaded} of ${total}; please try again later.`;
  }
  if (failure?.reason === 'non-image-response') {
    return `The cover service returned an unexpected response${status}. Loaded ${loaded} of ${total}; please try again later.`;
  }
  if (failure?.reason === 'image-decode') {
    return `The downloaded covers could not be decoded. Loaded ${loaded} of ${total}; please try again later.`;
  }
  if (failure?.reason === 'network') {
    return `The browser could not reach the cover service. Loaded ${loaded} of ${total}; check the connection and try again.`;
  }
  return `Cover delivery stopped. Loaded ${loaded} of ${total}; please try again later.`;
}

function resetCoverLoadingStatus() {
  els.coverLoadingStatuses.forEach((status) => {
    status.hidden = true;
  });
  els.coverLoadingBars.forEach((bar) => {
    bar.style.width = '0%';
  });
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
  return Math.max(1, Math.ceil(getVisualItems().length / perSlice));
}

function drawPoster() {
  const layout = getPosterLayout();
  const sliceCount = getSliceCount();
  state.currentSlice = clamp(state.currentSlice, 0, sliceCount - 1);
  const start = state.currentSlice * layout.perSlice;
  const items = getVisualItems().slice(start, start + layout.perSlice);

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
  const items = getVisualItems();
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
  const laneItems = getVisualItems();
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
  const items = getVisualItems();
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
  const items = getVisualItems();
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
  const items = getVisualItems();
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
  const items = getVisualItems();
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

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

function getMediaFilterFromUrl() {
  return sanitizeMediaFilter(new URLSearchParams(window.location.search).get('media'));
}

function updateUrlCollectionOptions(username, mediaFilter) {
  const url = new URL(window.location.href);
  url.searchParams.set('u', username);
  if (mediaFilter === 'all') {
    url.searchParams.delete('media');
  } else {
    url.searchParams.set('media', mediaFilter);
  }
  window.history.replaceState({}, '', url);
}

function clearUrlUsername() {
  const url = new URL(window.location.href);
  url.searchParams.delete('u');
  url.searchParams.delete('user');
  url.searchParams.delete('media');
  window.history.replaceState({}, '', url);
}

function sanitizeMediaFilter(value) {
  const normalized = String(value || 'all').toLowerCase();
  return ['all', 'vinyl', 'cd', 'cassette', 'other'].includes(normalized) ? normalized : 'all';
}

function formatMediaFilter(value) {
  return {
    all: 'all-format',
    vinyl: 'Vinyl',
    cd: 'CD',
    cassette: 'Cassette',
    other: 'other-format',
  }[sanitizeMediaFilter(value)];
}

function formatMediaCoverLabel(value) {
  return {
    all: 'covers',
    vinyl: 'Vinyl covers',
    cd: 'CD covers',
    cassette: 'Cassette covers',
    other: 'other-format covers',
  }[sanitizeMediaFilter(value)];
}

function formatMediaSampleLabel(value) {
  return sanitizeMediaFilter(value) === 'all'
    ? 'Representative sample'
    : `Representative ${formatMediaFilter(value)} sample`;
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
    if (state.representativeSample) {
      return `Using ${state.collection.length.toLocaleString()} ${formatMediaCoverLabel(state.mediaFilter)} sampled across ${state.sourceTotal.toLocaleString()} collection entries.`;
    }
    if (state.sourceTotal > state.sourceFetched) {
      return `Loaded the first ${state.sourceFetched.toLocaleString()} of ${state.sourceTotal.toLocaleString()} collection entries to keep loading and video generation reliable in your browser.`;
    }
    if (state.mediaFilter !== 'all') {
      return `Loaded ${state.collection.length.toLocaleString()} ${formatMediaCoverLabel(state.mediaFilter)} from ${state.sourceTotal.toLocaleString()} collection entries.`;
    }
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
