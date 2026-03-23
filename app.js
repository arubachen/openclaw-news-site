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
  searchInput: document.querySelector('#search-input'),
};

const fmtDate = (value) => new Date(value).toLocaleString('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const scoreTone = (score = 0) => score >= 8 ? '高价值' : score >= 7 ? '中价值' : '一般';
const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const slugifyHash = (text) => encodeURIComponent(text);
const readHash = () => (window.location.hash || '#/').replace(/^#/, '');

function summarize() {
  const items = state.items;
  const channels = new Set(items.map((item) => item.channel));
  const tags = new Set(items.flatMap((item) => item.tags));
  const dates = new Set(items.map((item) => item.publishedAt.slice(0, 10)));
  els.heroStats.innerHTML = [
    ['资讯总数', items.length],
    ['频道数', channels.size],
    ['标签数', tags.size],
    ['归档日', dates.size],
  ].map(([label, value]) => `<div class="stat-box"><strong>${value}</strong><span>${label}</span></div>`).join('');
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
  const dates = [...new Set(state.items.map((item) => item.publishedAt.slice(0, 10)))].sort().reverse();
  els.dateLinks.innerHTML = dates.map((day) => `<a href="#/date/${day}">${day}</a>`).join('');

  const tagCounts = new Map();
  state.items.flatMap((item) => item.tags).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
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

function renderCards(title, description, items) {
  els.routeTitle.innerHTML = `${esc(title)}${description ? ` · ${esc(description)}` : ''}`;
  if (!items.length) {
    els.root.innerHTML = `<div class="empty"><h3>没有匹配内容</h3><p>可以换个分类或关键词再试。</p></div>`;
    return;
  }

  els.root.innerHTML = `<div class="cards">${items.map((item) => `
    <article class="card">
      <div class="card-head">
        <div>
          <div class="meta-line">${esc(item.channel)} · ${fmtDate(item.publishedAt)}</div>
          <h3><a href="#/article/${esc(item.slug)}">${esc(item.title)}</a></h3>
        </div>
        <div class="score-badge">${esc(scoreTone(item.score))} · ${item.score}</div>
      </div>
      <p class="summary">${esc(item.summary)}</p>
      <div class="fact-grid">
        ${(item.facts || []).slice(0, 4).map((fact) => `
          <div class="fact-card">
            <span class="fact-label">${esc(fact.label)}</span>
            <p>${esc(fact.value)}</p>
          </div>
        `).join('')}
      </div>
      <p class="summary">${esc(item.judgment)}</p>
      <div class="tag-row">
        ${(item.tags || []).map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
      </div>
      <p class="footer-note">${esc(item.sourceName)} - ${esc(item.sourceType)} - <a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a></p>
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
  els.routeTitle.innerHTML = `${esc(item.channel)} · ${fmtDate(item.publishedAt)}`;
  els.root.innerHTML = `
    <article class="article">
      <div class="article-head">
        <div>
          <div class="article-meta">${fmtDate(item.publishedAt)}</div>
          <h2>${esc(item.title)}</h2>
        </div>
        <div class="score-badge">${esc(scoreTone(item.score))} · ${item.score}</div>
      </div>
      <div class="tag-row">
        <span class="article-pill">${esc(item.channel)}</span>
        ${(item.tags || []).map((tag) => `<a class="chip" href="#/tag/${slugifyHash(tag)}">#${esc(tag)}</a>`).join('')}
      </div>
      <section>
        <p class="summary">${esc(item.summary)}</p>
      </section>
      <section>
        <h3>关键细节</h3>
        <div class="fact-grid">
          ${(item.facts || []).map((fact) => `
            <div class="fact-card">
              <span class="fact-label">${esc(fact.label)}</span>
              <p>${esc(fact.value)}</p>
            </div>
          `).join('')}
        </div>
      </section>
      <section>
        <h3>判断</h3>
        <p class="summary">${esc(item.judgment)}</p>
      </section>
      <section>
        <h3>来源</h3>
        <p class="source-line">${esc(item.sourceName)} - ${esc(item.sourceType)} - <a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">原文↗</a></p>
      </section>
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
