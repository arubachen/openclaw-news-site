const THEME_KEY = 'openclaw-news-site-theme-mode';
const PAGE_SIZE = 20;
const BACK_TO_TOP_THRESHOLD_FACTOR = 1;
const SEARCH_INPUT_DEBOUNCE_MS = 220;
const DATA_REQUEST_OPTIONS = { cache: 'no-cache' };
const themeModes = ['system', 'dark', 'light'];
const themeMeta = {
  system: { icon: '◐', title: '主题：跟随系统（点击切换）' },
  dark: { icon: '☾', title: '主题：深色（点击切换）' },
  light: { icon: '☀︎', title: '主题：浅色（点击切换）' },
};

const state = {
  items: [],
  query: '',
  activeChannel: '全部',
  scoreFilter: '全部',
  themeMode: 'system',
  visibleCount: PAGE_SIZE,
  manifest: null,
  totalItems: 0,
  progressiveEnabled: false,
  isFullyLoaded: false,
  backgroundError: '',
};

const loadedChunkIds = new Set();
const loadingChunkPromises = new Map();
const seenItemIds = new Set();
let renderQueued = false;
let backgroundLoaderStarted = false;
let searchDebounceTimer = null;
let legacyHydrationPromise = null;

const els = {
  root: document.querySelector('#content-root'),
  routeTitle: document.querySelector('#route-title'),
  channelChips: document.querySelector('#channel-chips'),
  scoreSummary: document.querySelector('#score-summary'),
  dateLinks: document.querySelector('#date-links'),
  tagCloud: document.querySelector('#tag-cloud'),
  searchInput: document.querySelector('#search-input'),
  themeToggle: document.querySelector('#theme-toggle'),
  backToTop: document.querySelector('#back-to-top'),
};

const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

const fmtDate = (value) => new Date(value).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const getIngestedAt = (item = {}) => item.ingestedAt || item.publishedAt || '';
const getDateKey = (item = {}) => getIngestedAt(item).slice(0, 10);
const sortItems = (items = []) => [...items].sort((a, b) => new Date(getIngestedAt(b)) - new Date(getIngestedAt(a)));

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const slugifyHash = (text) => encodeURIComponent(text);
const readHash = () => (window.location.hash || '#/all').replace(/^#/, '');
const scoreTone = (score = 0) => score >= 8 ? '高匹配' : score >= 7 ? '中匹配' : '一般';
const scoreColor = (score = 0) => score >= 8 ? 'var(--high)' : score >= 7 ? 'var(--warn)' : 'var(--good)';
const scoreClass = (score = 0) => score >= 8 ? 'score-high' : score >= 7 ? 'score-mid' : 'score-low';

function stripCommentPrefix(value = '') {
  return String(value)
    .replace(/^\*\*(?:评|点评)：\*\*\s*/u, '')
    .replace(/^(?:评|点评)：\s*/u, '')
    .trim();
}

function humanizeComment(value = '') {
  let text = stripCommentPrefix(value);
  const firstSentence = text.split(/[。！？]/u)[0] || text;

  if (/^(?:这条|这类|这则|这波)/u.test(text) && /(?:不是|不在于)/u.test(firstSentence) && /(?:而是|而在于)/u.test(firstSentence)) {
    const idx = text.search(/(?:而是|而在于)/u);
    if (idx !== -1) text = text.slice(idx).replace(/^(?:而是|而在于)\s*/u, '');
  }

  const patterns = [
    /^(?:真正|更)?值得看的是\s*/u,
    /^(?:真正|更)?值得盯的是\s*/u,
    /^(?:这条|这类|这则|这波)(?:消息|信息|内容|动态|情报)?(?:的)?(?:重点|看点|价值|核心|关键)(?:是|在于)\s*/u,
    /^(?:这条|这类|这则|这波)(?:消息|信息|内容|动态|情报)?(?:释放出的信号是|说明了)\s*/u,
    /^(?:核心|关键|重点)(?:在于|是)\s*/u,
    /^(?:这条|这类|这则|这波)(?:消息|信息|内容|动态|情报)?[，,]\s*/u,
    /^(?:这不只是|这不单是)\s*[^，。；]+(?:，|,|、)?(?:更是|更意味着)\s*/u,
  ];

  for (const pattern of patterns) text = text.replace(pattern, '');
  text = text.replace(/^(?:而是|而在于|意味着|说明)\s*/u, '');
  text = text.replace(/^[，,。；、\s]+/u, '');
  return text.trim();
}

function getActualTheme(mode = state.themeMode) {
  return mode === 'system' ? (mediaDark.matches ? 'dark' : 'light') : mode;
}

function applyTheme(mode = state.themeMode) {
  const actual = getActualTheme(mode);
  document.documentElement.dataset.theme = actual;
  const meta = themeMeta[mode];
  if (els.themeToggle && meta) {
    els.themeToggle.textContent = meta.icon;
    els.themeToggle.title = meta.title;
    els.themeToggle.setAttribute('aria-label', meta.title);
  }
}

function cycleTheme() {
  const currentIndex = themeModes.indexOf(state.themeMode);
  state.themeMode = themeModes[(currentIndex + 1) % themeModes.length];
  localStorage.setItem(THEME_KEY, state.themeMode);
  applyTheme();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (themeModes.includes(stored)) state.themeMode = stored;
  applyTheme();
  els.themeToggle?.addEventListener('click', cycleTheme);
  mediaDark.addEventListener('change', () => {
    if (state.themeMode === 'system') applyTheme();
  });
}

function updateBackToTopVisibility() {
  if (!els.backToTop) return;
  const threshold = window.innerHeight * BACK_TO_TOP_THRESHOLD_FACTOR;
  const shouldShow = window.scrollY > threshold;
  els.backToTop.classList.toggle('is-visible', shouldShow);
}

function initBackToTop() {
  if (!els.backToTop) return;
  els.backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
  window.addEventListener('resize', updateBackToTopVisibility);
  updateBackToTopVisibility();
}

function buildDisplayFacts(item) {
  const facts = Array.isArray(item.facts) ? item.facts : [];
  const take = (...labels) => facts
    .filter((fact) => labels.includes(String(fact.label || '').trim()))
    .map((fact) => String(fact.value || '').trim())
    .filter(Boolean);

  if (item.channel === '招投标') {
    const eventParts = [
      ...take('采购方', '主', '类', '门槛', '中标方', '一候', '二候'),
    ];
    const timeParts = [
      ...take('截标', '时', '标书获取', '售标', '发布时间'),
    ];
    const numberParts = [
      ...take('预算', '数', '价', '报价'),
    ];

    return {
      event: eventParts.join('；'),
      time: timeParts.join('；'),
      number: numberParts.join('；'),
      impact: take('影').join('；'),
    };
  }

  const first = (...labels) => take(...labels)[0] || '';
  const eventParts = [];
  for (const label of ['主', '动', '落']) {
    const value = first(label);
    if (value) eventParts.push(value);
  }

  if (!eventParts.length) {
    for (const fact of facts) {
      const label = String(fact.label || '').trim();
      if (!['时', '数', '影'].includes(label) && fact.value) {
        eventParts.push(String(fact.value).trim());
      }
    }
  }

  return {
    event: eventParts.join('；'),
    time: first('时'),
    number: first('数'),
    impact: first('影'),
  };
}

function getRouteParts() {
  const raw = readHash();
  const [_, route = 'all', value = ''] = raw.split('/');
  return { route, value: decodeURIComponent(value) };
}

function getGlobalScoreSummary() {
  return Array.isArray(state.manifest?.summary?.scores) ? state.manifest.summary.scores : null;
}

function isDefaultAllRoute() {
  const { route, value } = getRouteParts();
  return route === 'all' && !value && !state.query;
}

function getLoadProgressText() {
  if (!state.progressiveEnabled || state.isFullyLoaded || !state.totalItems) return '';
  return `已加载 ${state.items.length}/${state.totalItems} 条，后台同步中`;
}

function getChannelEntries() {
  if (Array.isArray(state.manifest?.summary?.channels)) return state.manifest.summary.channels;

  const counts = new Map();
  state.items.forEach((item) => counts.set(item.channel, (counts.get(item.channel) || 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

function renderChannelChips() {
  const entries = getChannelEntries();
  const countMap = new Map(entries.map((entry) => [entry.name, entry.count]));
  const channels = ['全部', ...entries.map((entry) => entry.name)];

  els.channelChips.innerHTML = channels.map((channel) => {
    const count = channel === '全部' ? (state.totalItems || state.items.length) : (countMap.get(channel) || 0);
    return `
      <button class="chip ${state.activeChannel === channel ? 'active' : ''}" data-channel="${esc(channel)}" type="button">
        <span>${esc(channel)}</span>
        <em>${count}</em>
      </button>
    `;
  }).join('');

  els.channelChips.querySelectorAll('[data-channel]').forEach((button) => {
    button.addEventListener('click', () => {
      const channel = button.dataset.channel;
      state.visibleCount = PAGE_SIZE;
      window.location.hash = channel === '全部' ? '#/all' : `#/channel/${slugifyHash(channel)}`;
    });
  });
}

function renderSidebarStatic() {
  const manifestDates = Array.isArray(state.manifest?.summary?.dates) ? state.manifest.summary.dates : null;
  const dates = manifestDates
    ? manifestDates.slice(0, 5)
    : [...new Set(state.items.map((item) => getDateKey(item)))].sort().reverse().slice(0, 5).map((day) => ({
      day,
      count: state.items.filter((item) => getDateKey(item) === day).length,
    }));

  els.dateLinks.innerHTML = dates.map(({ day, count }) => `
    <a href="#/date/${day}">
      <span>${day}</span>
      <span>${count} 条</span>
    </a>
  `).join('');

  const manifestTags = Array.isArray(state.manifest?.summary?.tags) ? state.manifest.summary.tags : null;
  const tags = manifestTags
    ? manifestTags.slice(0, 10)
    : [...new Map(state.items.flatMap((item) => item.tags || []).map((tag) => [tag, 0])).keys()].map((tag) => {
      const count = state.items.filter((item) => (item.tags || []).includes(tag)).length;
      return { tag, count };
    }).sort((a, b) => b.count - a.count).slice(0, 10);

  els.tagCloud.innerHTML = tags.map(({ tag, count }) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)} · ${count}</a>`).join('');
}

function matchesQuery(item, query) {
  if (!query) return true;
  const blob = [
    item.title,
    item.channel,
    item.summary,
    item.judgment,
    item.sourceName,
    item.sourceType,
    ...(item.tags || []),
    ...((item.facts || []).map((fact) => `${fact.label} ${fact.value}`)),
  ].join(' ').toLowerCase();
  return blob.includes(query.toLowerCase());
}

function matchesScore(item, scoreFilter = state.scoreFilter) {
  const score = Number(item.score || 0);
  if (scoreFilter === '高匹配') return score >= 8;
  if (scoreFilter === '中匹配') return score >= 7 && score < 8;
  return true;
}

function getRouteContext() {
  const { route, value } = getRouteParts();

  if (route === 'article' && value) {
    const item = state.items.find((entry) => entry.slug === value);
    if (!item) return { kind: 'missing', title: '文章不存在', description: '请返回列表重新选择', items: [], baseItems: [] };
    state.activeChannel = item.channel;
    const baseItems = state.items.filter((entry) => entry.channel === item.channel);
    return { kind: 'article', item, title: item.title, description: `${item.channel} · 入站 ${fmtDate(getIngestedAt(item))}`, items: [item], baseItems };
  }

  let extraFilter = () => true;
  let title = '最新资讯';
  let description = '默认按入站时间倒序';
  state.activeChannel = '全部';

  if (route === 'channel' && value) {
    state.activeChannel = value;
    const channel = state.activeChannel;
    extraFilter = (item) => item.channel === channel;
    title = `频道：${channel}`;
    description = '按频道查看';
  } else if (route === 'tag' && value) {
    const tag = value;
    extraFilter = (item) => (item.tags || []).includes(tag);
    title = `标签：#${tag}`;
    description = '按标签查看';
  } else if (route === 'date' && value) {
    const day = value;
    extraFilter = (item) => getDateKey(item) === day;
    title = `归档：${day}`;
    description = '按入站日期查看';
  }

  const baseItems = sortItems(state.items
    .filter((item) => matchesQuery(item, state.query))
    .filter(extraFilter));

  const items = baseItems.filter((item) => matchesScore(item));
  return { kind: 'list', title, description, items, baseItems };
}

function renderScoreSummary(baseItems) {
  const useGlobal = !state.isFullyLoaded && isDefaultAllRoute() && getGlobalScoreSummary();
  const scores = useGlobal
    ? getGlobalScoreSummary().map((item) => ({
      label: item.label,
      className: item.label === '高匹配' ? 'score-high' : item.label === '中匹配' ? 'score-mid' : 'score-all',
      count: item.count,
    }))
    : [
      { label: '全部', className: 'score-all', count: baseItems.length },
      { label: '高匹配', className: 'score-high', count: baseItems.filter((item) => Number(item.score || 0) >= 8).length },
      { label: '中匹配', className: 'score-mid', count: baseItems.filter((item) => Number(item.score || 0) >= 7 && Number(item.score || 0) < 8).length },
    ];

  els.scoreSummary.innerHTML = scores.map((item) => `
    <button type="button" class="metric-link ${item.className} ${state.scoreFilter === item.label ? 'active' : ''}" data-score="${item.label}">
      <strong>${item.label}</strong>
      <span>${item.count} 条</span>
    </button>
  `).join('');

  els.scoreSummary.querySelectorAll('[data-score]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.score;
      state.scoreFilter = target === '全部' ? '全部' : (state.scoreFilter === target ? '全部' : target);
      state.visibleCount = PAGE_SIZE;
      renderRoute();
    });
  });
}

function getRouteFilterPills() {
  const { route, value } = getRouteParts();
  const pills = [];

  if (route === 'channel' && value) pills.push({ key: 'channel', label: `资讯类型：${value}` });
  if (route === 'tag' && value) pills.push({ key: 'tag', label: `标签：#${value}` });
  if (route === 'date' && value) pills.push({ key: 'date', label: `日期：${value}` });
  if (state.scoreFilter !== '全部') pills.push({ key: 'score', label: `业务匹配：${state.scoreFilter}` });
  if (state.query) pills.push({ key: 'query', label: `检索：${state.query}` });

  return pills;
}

function bindRouteFilterActions() {
  els.routeTitle.querySelectorAll('[data-clear-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.clearFilter;
      state.visibleCount = PAGE_SIZE;

      if (key === 'score') {
        state.scoreFilter = '全部';
        renderRoute();
        return;
      }

      if (key === 'query') {
        state.query = '';
        if (els.searchInput) els.searchInput.value = '';
        renderRoute();
        return;
      }

      if (['channel', 'tag', 'date'].includes(key)) {
        window.location.hash = '#/all';
      }
    });
  });
}

function renderRouteTitle(title, description = '', totalCount = 0, visibleCount = totalCount) {
  const subtitleParts = [description].filter(Boolean);
  const loadingText = getLoadProgressText();
  if (loadingText) subtitleParts.push(loadingText);

  if (state.isFullyLoaded) {
    if (visibleCount < totalCount) subtitleParts.push(`已显示 ${visibleCount}/${totalCount}`);
    subtitleParts.push(`${totalCount} 条`);
  } else if (totalCount > 0) {
    subtitleParts.push(visibleCount < totalCount ? `当前命中 ${visibleCount}/${totalCount} 条` : `当前命中 ${totalCount} 条`);
  }

  if (state.backgroundError) subtitleParts.push(`后台加载异常：${state.backgroundError}`);

  const pills = getRouteFilterPills();

  els.routeTitle.innerHTML = `
    <strong>${esc(title)}</strong>
    ${subtitleParts.length ? `<span class="route-subtitle">${esc(subtitleParts.join(' · '))}</span>` : ''}
    ${pills.length ? `<div class="route-filters">${pills.map((item) => `
      <button type="button" class="filter-pill" data-clear-filter="${esc(item.key)}">
        <span>${esc(item.label)}</span>
        <b>×</b>
      </button>
    `).join('')}</div>` : ''}
  `;

  bindRouteFilterActions();
}

function renderFactRows(item) {
  const facts = buildDisplayFacts(item);
  const labels = item.channel === '招投标'
    ? ['事项', '节点', '金额']
    : ['事件', '时间', '数字'];
  const rows = [
    [labels[0], facts.event],
    [labels[1], facts.time],
    [labels[2], facts.number],
  ].filter(([, value]) => value);

  return `<div class="facts-block">${rows.map(([label, value]) => `
    <div class="fact-row">
      <span class="fact-key">${esc(label)}</span>
      <div class="fact-value">${esc(value)}</div>
    </div>
  `).join('')}</div>`;
}

function renderCommentBox(item) {
  const facts = buildDisplayFacts(item);
  const judgment = humanizeComment(item.judgment || '');
  const lines = [];
  if (facts.impact) lines.push(`<p class="comment-line"><strong>影响：</strong>${esc(facts.impact)}</p>`);
  if (judgment) lines.push(`<p class="comment-line"><strong>点评：</strong>${esc(judgment)}</p>`);
  return `<div class="comment-box">${lines.join('')}</div>`;
}

function renderScorePill(item) {
  return `<span class="meta-pill score-pill ${scoreClass(item.score)}">${esc(scoreTone(item.score))} ${Number(item.score || 0).toFixed(1)}</span>`;
}

function renderMetaRow(item) {
  const parts = [
    `<span class="meta-pill primary">${esc(item.channel)}</span>`,
    item.channel === '招投标'
      ? `<span class="meta-pill">${esc(item.sourceName)}</span>`
      : `<span class="meta-pill">${esc(item.sourceName)} · ${esc(item.sourceType)}</span>`,
  ];

  parts.push(`<span class="meta-pill">入站 ${fmtDate(getIngestedAt(item))}</span>`);
  parts.push(renderScorePill(item));
  return parts.join('');
}

function renderTagRow(item) {
  if (!item.tags?.length) return '';
  return `
    <div class="footer-row">
      <div class="tag-row">
        ${item.tags.map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
      </div>
    </div>
  `;
}

function renderCards(title, description, items) {
  const visibleItems = items.slice(0, state.visibleCount);
  renderRouteTitle(title, description, items.length, visibleItems.length);

  if (!items.length) {
    const loadingHint = !state.isFullyLoaded && state.progressiveEnabled
      ? '当前只完成了部分数据加载，后台仍在继续同步；如果暂时没看到结果，可以稍等几秒。'
      : '可以换个资讯类型、关键词，或切一下高/中匹配再试。';
    els.root.innerHTML = `<div class="empty"><h3>没有匹配内容</h3><p>${esc(loadingHint)}</p></div>`;
    return;
  }

  const hasMore = items.length > visibleItems.length;
  const streamStatus = state.progressiveEnabled && !state.isFullyLoaded
    ? `<p class="stream-status">正在后台加载剩余内容（${state.items.length}/${state.totalItems}）…</p>`
    : '';

  els.root.innerHTML = `${
    `<div class="cards">${visibleItems.map((item) => `
      <article class="card" style="--card-accent:${scoreColor(item.score)};">
        <div class="card-head">
          <div class="card-title-row">
            <h3><a href="#/article/${esc(item.slug)}">${esc(item.title)}</a></h3>
            <a class="headline-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a>
          </div>
          <div class="meta-row">${renderMetaRow(item)}</div>
        </div>
        <p class="summary">${esc(item.summary)}</p>
        ${renderFactRows(item)}
        ${renderCommentBox(item)}
        ${renderTagRow(item)}
      </article>
    `).join('')}</div>`
  }${hasMore || streamStatus ? `
    <div class="load-more-wrap">
      ${hasMore ? `<button id="load-more" class="load-more-btn" type="button">加载更多（${visibleItems.length}/${items.length}）</button>` : ''}
      ${streamStatus}
    </div>
  ` : ''}`;

  document.querySelector('#load-more')?.addEventListener('click', () => {
    state.visibleCount += PAGE_SIZE;
    renderRoute();
  });
}

function renderArticle(item) {
  const facts = buildDisplayFacts(item);
  renderRouteTitle(item.title, `${item.channel} · 入站 ${fmtDate(getIngestedAt(item))}`, 1, 1);

  els.root.innerHTML = `
    <article class="article" style="border-left:4px solid ${scoreColor(item.score)};">
      <div class="article-head">
        <div class="article-title-row">
          <h2>${esc(item.title)}</h2>
          <a class="headline-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a>
        </div>
        <div class="meta-row">${renderMetaRow(item)}</div>
      </div>

      <div class="tag-row">
        ${(item.tags || []).map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
      </div>

      <div class="article-grid">
        <section class="article-section">
          <h3>摘要</h3>
          <p class="summary">${esc(item.summary)}</p>
        </section>

        <section class="article-section">
          <h3>关键信息</h3>
          <div class="facts-block">
            ${[
              ...(item.channel === '招投标'
                ? [['事项', facts.event], ['节点', facts.time], ['金额', facts.number]]
                : [['事件', facts.event], ['时间', facts.time], ['数字', facts.number]]),
            ].filter(([, value]) => value).map(([label, value]) => `
              <div class="fact-row">
                <span class="fact-key">${esc(label)}</span>
                <div class="fact-value">${esc(value)}</div>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="article-section">
          <h3>点评</h3>
          ${facts.impact ? `<p class="comment-line"><strong>影响：</strong>${esc(facts.impact)}</p>` : ''}
          <p class="comment-line"><strong>点评：</strong>${esc(humanizeComment(item.judgment || ''))}</p>
        </section>

        <section class="article-section">
          <h3>来源</h3>
          <p class="source-line">${esc(item.sourceName)} · ${esc(item.sourceType)}</p>
          <p class="source-line">入站时间 · ${esc(fmtDate(getIngestedAt(item)))}</p>
          <p class="source-line">原始发布时间 · ${esc(fmtDate(item.publishedAt))}</p>
        </section>
      </div>

      <p class="footer-note"><a href="#/channel/${slugifyHash(item.channel)}">← 返回 ${esc(item.channel)}</a></p>
    </article>
  `;
}

function renderRoute() {
  const context = getRouteContext();
  renderChannelChips();
  renderScoreSummary(context.baseItems || state.items);

  if (context.kind === 'article') {
    renderArticle(context.item);
    return;
  }

  if (context.kind === 'missing') {
    renderCards(context.title, context.description, []);
    return;
  }

  renderCards(context.title, context.description, context.items);
}

function scheduleRenderRoute() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSidebarStatic();
    renderRoute();
  });
}

function mergeItems(items = []) {
  let changed = false;
  for (const item of items) {
    if (!item?.id || seenItemIds.has(item.id)) continue;
    seenItemIds.add(item.id);
    state.items.push(item);
    changed = true;
  }

  if (changed) {
    state.items = sortItems(state.items);
    if (state.totalItems && state.items.length >= state.totalItems) {
      state.isFullyLoaded = true;
    }
  }

  return changed;
}

async function fetchJson(url) {
  const response = await fetch(url, DATA_REQUEST_OPTIONS);
  if (!response.ok) throw new Error(`请求失败：${url} (${response.status})`);
  return response.json();
}

async function loadChunk(index) {
  if (!state.manifest) return [];
  if (loadedChunkIds.has(index)) return [];
  if (loadingChunkPromises.has(index)) return loadingChunkPromises.get(index);

  const chunk = state.manifest.chunks[index];
  if (!chunk) return [];

  const promise = fetchJson(chunk.file)
    .then((items) => {
      if (!Array.isArray(items)) throw new Error(`数据分片不是数组：${chunk.file}`);
      loadedChunkIds.add(index);
      mergeItems(items);
      scheduleRenderRoute();
      return items;
    })
    .finally(() => {
      loadingChunkPromises.delete(index);
    });

  loadingChunkPromises.set(index, promise);
  return promise;
}

async function hydrateFromLegacy() {
  if (legacyHydrationPromise) return legacyHydrationPromise;

  legacyHydrationPromise = fetchJson('./data/news.json').then((items) => {
    if (!Array.isArray(items)) throw new Error('data/news.json must be an array');
    state.progressiveEnabled = false;
    state.manifest = null;
    state.backgroundError = '';
    state.totalItems = items.length;
    mergeItems(items);
    state.isFullyLoaded = true;
    renderSidebarStatic();
    renderRoute();
    return items;
  });

  return legacyHydrationPromise;
}

async function ensureRouteData() {
  if (!state.manifest) return;
  const { route, value } = getRouteParts();
  if (route !== 'article' || !value) return;

  const chunkIndex = state.manifest.articleChunkMap?.[value];
  if (Number.isInteger(chunkIndex)) {
    await loadChunk(chunkIndex);
  }
}

async function startBackgroundLoading() {
  if (backgroundLoaderStarted || !state.manifest) return;
  backgroundLoaderStarted = true;

  for (let index = 0; index < state.manifest.chunks.length; index += 1) {
    if (loadedChunkIds.has(index)) continue;

    try {
      await loadChunk(index);
    } catch (error) {
      console.error(error);
      state.backgroundError = error.message || '未知错误';
      await hydrateFromLegacy();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  state.isFullyLoaded = true;
  scheduleRenderRoute();
}

async function bootstrapProgressive() {
  const manifest = await fetchJson('./data/manifest.json');
  if (!manifest || !Array.isArray(manifest.chunks) || !manifest.chunks.length) {
    throw new Error('manifest 格式无效');
  }

  state.manifest = manifest;
  state.progressiveEnabled = true;
  state.totalItems = Number(manifest.totalItems || 0);
  renderSidebarStatic();

  await loadChunk(0);
  await ensureRouteData();
  renderRoute();
  void startBackgroundLoading();
}

function bindSearchInput() {
  els.searchInput?.addEventListener('input', (event) => {
    const nextValue = event.target.value.trim();
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      state.query = nextValue;
      state.visibleCount = PAGE_SIZE;
      renderRoute();
    }, SEARCH_INPUT_DEBOUNCE_MS);
  });
}

function bindRouteChange() {
  window.addEventListener('hashchange', async () => {
    state.visibleCount = PAGE_SIZE;
    try {
      await ensureRouteData();
      renderRoute();
    } catch (error) {
      console.error(error);
      await hydrateFromLegacy();
    }
  });
}

async function bootstrap() {
  initTheme();
  initBackToTop();
  bindSearchInput();
  bindRouteChange();

  try {
    await bootstrapProgressive();
  } catch (error) {
    console.warn('渐进式加载不可用，回退到完整数据加载。', error);
    await hydrateFromLegacy();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  els.root.innerHTML = `<div class="empty"><h3>站点加载失败</h3><p>${esc(error.message)}</p></div>`;
});
