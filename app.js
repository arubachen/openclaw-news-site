const state = {
  items: [],
  query: '',
  activeChannel: '全部',
};

const els = {
  root: document.querySelector('#content-root'),
  heroStats: document.querySelector('#hero-stats'),
  chips: document.querySelector('#channel-chips'),
  routeTitle: document.querySelector('#route-title'),
  dateLinks: document.querySelector('#date-links'),
  tagCloud: document.querySelector('#tag-cloud'),
  channelSummary: document.querySelector('#channel-summary'),
  searchInput: document.querySelector('#search-input'),
};

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
const scorePill = (score = 0) => `${scoreTone(score)} · ${Number(score).toFixed(1)}`;

function summarize() {
  const items = state.items;
  const channels = new Set(items.map((item) => item.channel));
  const tags = new Set(items.flatMap((item) => item.tags));
  const last24h = items.filter((item) => (Date.now() - new Date(item.publishedAt).getTime()) <= 24 * 60 * 60 * 1000);
  const highScore = items.filter((item) => Number(item.score || 0) >= 8);
  const latest = items[0];

  els.heroStats.innerHTML = [
    { label: '总条数', value: items.length, note: '当前站点可检索资讯总量' },
    { label: '24h新增', value: last24h.length, note: '最近 24 小时入库内容' },
    { label: '高分条目', value: highScore.length, note: '评分 ≥ 8.0' },
    { label: '频道数', value: channels.size, note: `${tags.size} 个标签可检索` },
    { label: '最近更新', value: latest ? latest.channel : '—', note: latest ? fmtDate(latest.publishedAt) : '暂无数据' },
  ].map((item) => `
    <div class="stat-box">
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

function renderSidebar() {
  const channelCounts = new Map();
  state.items.forEach((item) => channelCounts.set(item.channel, (channelCounts.get(item.channel) || 0) + 1));
  els.channelSummary.innerHTML = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([channel, count]) => `<a class="channel-row" href="#/channel/${slugifyHash(channel)}"><strong>${esc(channel)}</strong><span>${count} 条</span></a>`)
    .join('');

  const dates = [...new Set(state.items.map((item) => item.publishedAt.slice(0, 10)))].sort().reverse();
  els.dateLinks.innerHTML = dates.map((day) => `<a href="#/date/${day}">${day}<span>${state.items.filter((item) => item.publishedAt.startsWith(day)).length} 条</span></a>`).join('');

  const tagCounts = new Map();
  state.items.flatMap((item) => item.tags).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
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

function filteredItems(extraFilter = () => true) {
  return state.items
    .filter((item) => state.activeChannel === '全部' || item.channel === state.activeChannel)
    .filter((item) => matchesQuery(item, state.query))
    .filter(extraFilter)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function renderRouteTitle(title, subtitle = '') {
  els.routeTitle.innerHTML = `<strong>${esc(title)}</strong>${subtitle ? `<span class="route-subtitle">${esc(subtitle)}</span>` : ''}`;
}

function renderFactList(facts = []) {
  return `<div class="fact-list">${facts.map((fact) => `
    <div class="fact-item">
      <span class="fact-label">${esc(fact.label)}</span>
      <div class="fact-value">${esc(fact.value)}</div>
    </div>
  `).join('')}</div>`;
}

function renderCards(title, description, items) {
  renderRouteTitle(title, `${description} · 共 ${items.length} 条`);
  if (!items.length) {
    els.root.innerHTML = `<div class="empty"><h3>没有匹配内容</h3><p>可以换个分类或关键词再试。</p></div>`;
    return;
  }

  els.root.innerHTML = `<div class="cards">${items.map((item) => `
    <article class="card" style="--card-accent:${scoreColor(item.score)};">
      <div class="card-head">
        <div>
          <div class="meta-row">
            <span class="channel-badge">${esc(item.channel)}</span>
            <span class="meta-pill">${fmtDate(item.publishedAt)}</span>
            <span class="meta-pill">${esc(item.sourceName)} · ${esc(item.sourceType)}</span>
          </div>
          <h3><a href="#/article/${esc(item.slug)}">${esc(item.title)}</a></h3>
        </div>
        <div class="score-badge">${esc(scorePill(item.score))}</div>
      </div>
      <p class="summary">${esc(item.summary)}</p>
      ${renderFactList(item.facts || [])}
      <div class="judgment-box">
        <h4>判断</h4>
        <p class="summary">${esc(item.judgment)}</p>
      </div>
      <div class="footer-row">
        <div class="tag-row">
          ${(item.tags || []).map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
        </div>
        <p class="footer-note">${esc(item.sourceName)} - ${esc(item.sourceType)} - <a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a></p>
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
  renderRouteTitle(item.title, `${item.channel} · ${fmtDate(item.publishedAt)}`);
  els.root.innerHTML = `
    <article class="article" style="--card-accent:${scoreColor(item.score)}; border-left:4px solid ${scoreColor(item.score)};">
      <div class="article-head">
        <div>
          <div class="meta-row">
            <span class="channel-badge">${esc(item.channel)}</span>
            <span class="meta-pill">${fmtDate(item.publishedAt)}</span>
            <span class="meta-pill">${esc(item.sourceName)} · ${esc(item.sourceType)}</span>
          </div>
          <h2>${esc(item.title)}</h2>
        </div>
        <div class="score-badge">${esc(scorePill(item.score))}</div>
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
          <h3>关键细节</h3>
          ${renderFactList(item.facts || [])}
        </section>

        <section class="article-section">
          <h3>判断</h3>
          <p class="summary">${esc(item.judgment)}</p>
        </section>

        <section class="article-section">
          <h3>来源</h3>
          <p class="source-line">${esc(item.sourceName)} - ${esc(item.sourceType)} - <a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a></p>
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
  const response = await fetch('./data/news.json');
  state.items = await response.json();
  summarize();
  renderSidebar();
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
