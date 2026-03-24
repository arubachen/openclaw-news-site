const THEME_KEY = 'openclaw-news-site-theme-mode';
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
};

const els = {
  root: document.querySelector('#content-root'),
  routeTitle: document.querySelector('#route-title'),
  chips: document.querySelector('#channel-chips'),
  scoreChips: document.querySelector('#score-chips'),
  overviewSummary: document.querySelector('#overview-summary'),
  channelSummary: document.querySelector('#channel-summary'),
  dateLinks: document.querySelector('#date-links'),
  tagCloud: document.querySelector('#tag-cloud'),
  searchInput: document.querySelector('#search-input'),
  themeToggle: document.querySelector('#theme-toggle'),
};

const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

const fmtDate = (value) => new Date(value).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const slugifyHash = (text) => encodeURIComponent(text);
const readHash = () => (window.location.hash || '#/').replace(/^#/, '');
const scoreTone = (score = 0) => score >= 8 ? '高价值' : score >= 7 ? '中价值' : '一般';
const scoreColor = (score = 0) => score >= 8 ? 'var(--high)' : score >= 7 ? 'var(--warn)' : 'var(--good)';
const scoreClass = (score = 0) => score >= 8 ? 'score-high' : score >= 7 ? 'score-mid' : 'score-low';
const stripCommentPrefix = (value = '') => String(value).replace(/^\*\*评：\*\*\s*/u, '').replace(/^评：\s*/u, '').trim();

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

function buildDisplayFacts(item) {
  const facts = Array.isArray(item.facts) ? item.facts : [];
  const valuesByLabel = new Map(facts.map((fact) => [String(fact.label || '').trim(), String(fact.value || '').trim()]));
  const eventParts = [];

  for (const label of ['主', '动', '落']) {
    const value = valuesByLabel.get(label);
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
    time: valuesByLabel.get('时') || '',
    number: valuesByLabel.get('数') || '',
    impact: valuesByLabel.get('影') || '',
  };
}

function summarize() {
  const items = state.items;
  const channelCount = new Set(items.map((item) => item.channel)).size;
  const tagsCount = new Set(items.flatMap((item) => item.tags)).size;
  const last24h = items.filter((item) => Date.now() - new Date(item.publishedAt).getTime() <= 24 * 60 * 60 * 1000).length;
  const highScore = items.filter((item) => Number(item.score || 0) >= 8).length;

  els.overviewSummary.innerHTML = [
    { label: '总条数', value: items.length, note: '当前可检索资讯' },
    { label: '24h新增', value: last24h, note: '最近 24 小时' },
    { label: '高分', value: highScore, note: '评分 ≥ 8.0' },
    { label: '频道/标签', value: `${channelCount}/${tagsCount}`, note: '频道数 / 标签数' },
  ].map((item) => `
    <div class="mini-stat">
      <strong>${esc(item.value)}</strong>
      <span>${esc(item.label)}</span>
      <em>${esc(item.note)}</em>
    </div>
  `).join('');
}

function renderChips() {
  const channels = ['全部', ...new Set(state.items.map((item) => item.channel))];
  els.chips.innerHTML = channels.map((channel) => `
    <button class="chip ${state.activeChannel === channel ? 'active' : ''}" data-channel="${esc(channel)}">${esc(channel)}</button>
  `).join('');

  els.chips.querySelectorAll('[data-channel]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeChannel = button.dataset.channel;
      window.location.hash = state.activeChannel === '全部'
        ? '#/all'
        : `#/channel/${slugifyHash(state.activeChannel)}`;
    });
  });
}

function renderScoreChips() {
  const options = ['全部', '高价值', '中价值', '一般'];
  els.scoreChips.innerHTML = options.map((option) => `
    <button class="chip ${state.scoreFilter === option ? 'active' : ''}" data-score-filter="${esc(option)}">${esc(option)}</button>
  `).join('');

  els.scoreChips.querySelectorAll('[data-score-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.scoreFilter = button.dataset.scoreFilter;
      renderScoreChips();
      renderRoute();
    });
  });
}

function renderSidebar() {
  const channelCounts = new Map();
  state.items.forEach((item) => channelCounts.set(item.channel, (channelCounts.get(item.channel) || 0) + 1));
  els.channelSummary.innerHTML = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([channel, count]) => `
      <a class="channel-row" href="#/channel/${slugifyHash(channel)}">
        <strong>${esc(channel)}</strong>
        <span>${count} 条</span>
      </a>
    `).join('');

  const dates = [...new Set(state.items.map((item) => item.publishedAt.slice(0, 10)))].sort().reverse();
  els.dateLinks.innerHTML = dates.map((day) => `
    <a href="#/date/${day}">
      <span>${day}</span>
      <span>${state.items.filter((item) => item.publishedAt.startsWith(day)).length} 条</span>
    </a>
  `).join('');

  const tagCounts = new Map();
  state.items.flatMap((item) => item.tags).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  els.tagCloud.innerHTML = tags.map(([tag, count]) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)} · ${count}</a>`).join('');
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

function matchesScore(item) {
  const score = Number(item.score || 0);
  if (state.scoreFilter === '高价值') return score >= 8;
  if (state.scoreFilter === '中价值') return score >= 7 && score < 8;
  if (state.scoreFilter === '一般') return score < 7;
  return true;
}

function filteredItems(extraFilter = () => true) {
  return state.items
    .filter((item) => state.activeChannel === '全部' || item.channel === state.activeChannel)
    .filter((item) => matchesQuery(item, state.query))
    .filter(matchesScore)
    .filter(extraFilter)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function renderRouteTitle(title, description = '', items = []) {
  const chips = [];
  if (state.scoreFilter !== '全部') chips.push(`价值：${state.scoreFilter}`);
  if (state.query) chips.push(`检索：${state.query}`);
  const suffix = [description, chips.join(' · '), `${items.length} 条`].filter(Boolean).join(' · ');
  els.routeTitle.innerHTML = `<strong>${esc(title)}</strong>${suffix ? `<span class="route-subtitle">${esc(suffix)}</span>` : ''}`;
}

function renderFactRows(item) {
  const facts = buildDisplayFacts(item);
  const rows = [
    ['事件', facts.event],
    ['时间', facts.time],
    ['数字', facts.number],
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
  const judgment = stripCommentPrefix(item.judgment || '');
  const lines = [];
  if (facts.impact) lines.push(`<p class="comment-line"><strong>影响：</strong>${esc(facts.impact)}</p>`);
  if (judgment) lines.push(`<p class="comment-line"><strong>点评：</strong>${esc(judgment)}</p>`);
  return `<div class="comment-box">${lines.join('')}</div>`;
}

function renderScorePill(item) {
  return `<span class="meta-pill score-pill ${scoreClass(item.score)}">${esc(scoreTone(item.score))} ${Number(item.score || 0).toFixed(1)}</span>`;
}

function renderCards(title, description, items) {
  renderRouteTitle(title, description, items);
  if (!items.length) {
    els.root.innerHTML = `<div class="empty"><h3>没有匹配内容</h3><p>可以换个分类、价值筛选或关键词再试。</p></div>`;
    return;
  }

  els.root.innerHTML = `<div class="cards">${items.map((item) => `
    <article class="card" style="--card-accent:${scoreColor(item.score)};">
      <div class="card-head">
        <div>
          <div class="meta-row">
            <span class="meta-pill primary">${esc(item.channel)}</span>
            <span class="meta-pill">${fmtDate(item.publishedAt)}</span>
            <span class="meta-pill">${esc(item.sourceName)} · ${esc(item.sourceType)}</span>
            ${renderScorePill(item)}
          </div>
          <h3><a href="#/article/${esc(item.slug)}">${esc(item.title)}</a></h3>
        </div>
      </div>
      <p class="summary">${esc(item.summary)}</p>
      ${renderFactRows(item)}
      ${renderCommentBox(item)}
      <div class="footer-row">
        <div class="tag-row">
          ${(item.tags || []).map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
        </div>
        <a class="footer-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a>
      </div>
    </article>
  `).join('')}</div>`;
}

function renderArticle(slug) {
  const item = state.items.find((entry) => entry.slug === slug);
  if (!item) {
    renderCards('文章不存在', '请返回列表重新选择', []);
    return;
  }

  state.activeChannel = item.channel;
  renderChips();
  const facts = buildDisplayFacts(item);
  renderRouteTitle(item.title, `${item.channel} · ${fmtDate(item.publishedAt)}`, [item]);

  els.root.innerHTML = `
    <article class="article" style="border-left:4px solid ${scoreColor(item.score)};">
      <div class="article-head">
        <div>
          <div class="meta-row">
            <span class="article-pill">${esc(item.channel)}</span>
            <span class="meta-pill">${fmtDate(item.publishedAt)}</span>
            <span class="meta-pill">${esc(item.sourceName)} · ${esc(item.sourceType)}</span>
            ${renderScorePill(item)}
          </div>
          <h2>${esc(item.title)}</h2>
        </div>
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
              ['事件', facts.event],
              ['时间', facts.time],
              ['数字', facts.number],
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
          <p class="comment-line"><strong>点评：</strong>${esc(stripCommentPrefix(item.judgment || ''))}</p>
        </section>

        <section class="article-section">
          <h3>来源</h3>
          <p class="source-line">${esc(item.sourceName)} · ${esc(item.sourceType)} · <a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a></p>
        </section>
      </div>

      <p class="footer-note"><a href="#/channel/${slugifyHash(item.channel)}">← 返回 ${esc(item.channel)}</a></p>
    </article>
  `;
}

function renderRoute() {
  const raw = readHash();
  const [_, route = 'all', value = ''] = raw.split('/');

  if (route === 'article' && value) {
    renderArticle(decodeURIComponent(value));
    return;
  }

  if (route === 'channel' && value) {
    state.activeChannel = decodeURIComponent(value);
    renderChips();
    renderCards(`频道：${state.activeChannel}`, '按频道查看', filteredItems((item) => item.channel === state.activeChannel));
    return;
  }

  if (route === 'tag' && value) {
    const tag = decodeURIComponent(value);
    state.activeChannel = '全部';
    renderChips();
    renderCards(`标签：#${tag}`, '按标签查看', filteredItems((item) => item.tags.includes(tag)));
    return;
  }

  if (route === 'date' && value) {
    const day = decodeURIComponent(value);
    state.activeChannel = '全部';
    renderChips();
    renderCards(`归档：${day}`, '按日期查看', filteredItems((item) => item.publishedAt.startsWith(day)));
    return;
  }

  state.activeChannel = '全部';
  renderChips();
  renderCards('最新资讯', '默认按发布时间倒序', filteredItems());
}

async function bootstrap() {
  initTheme();
  const response = await fetch('./data/news.json');
  state.items = await response.json();
  summarize();
  renderSidebar();
  renderChips();
  renderScoreChips();
  renderRoute();

  els.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    renderRoute();
  });

  window.addEventListener('hashchange', renderRoute);
}

bootstrap().catch((error) => {
  console.error(error);
  els.root.innerHTML = `<div class="empty"><h3>站点加载失败</h3><p>${esc(error.message)}</p></div>`;
});
