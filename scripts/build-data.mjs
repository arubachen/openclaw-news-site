import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
const sourceFile = path.join(dataDir, 'news.json');
const manifestFile = path.join(dataDir, 'manifest.json');
const chunksDir = path.join(dataDir, 'chunks');
const CHUNK_SIZE = 20;

const raw = fs.readFileSync(sourceFile, 'utf8');
const items = JSON.parse(raw);

if (!Array.isArray(items)) {
  throw new Error('data/news.json must be an array');
}

const channelCounts = new Map();
const dateCounts = new Map();
const tagCounts = new Map();
const articleChunkMap = {};
const scoreBuckets = {
  全部: items.length,
  高匹配: 0,
  中匹配: 0,
};

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
const getDateKey = (item = {}) => String(item.ingestedAt || item.publishedAt || '').slice(0, 10);

fs.rmSync(chunksDir, { recursive: true, force: true });
ensureDir(chunksDir);

const chunks = [];
for (let start = 0; start < items.length; start += CHUNK_SIZE) {
  const index = start / CHUNK_SIZE;
  const slice = items.slice(start, start + CHUNK_SIZE);
  const filename = `chunk-${String(index + 1).padStart(3, '0')}.json`;
  const file = `./data/chunks/${filename}`;

  for (const item of slice) {
    articleChunkMap[item.slug] = index;
    channelCounts.set(item.channel, (channelCounts.get(item.channel) || 0) + 1);

    const day = getDateKey(item);
    if (day) dateCounts.set(day, (dateCounts.get(day) || 0) + 1);

    for (const tag of item.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const score = Number(item.score || 0);
    if (score >= 8) scoreBuckets['高匹配'] += 1;
    else if (score >= 7) scoreBuckets['中匹配'] += 1;
  }

  writeJson(path.join(chunksDir, filename), slice);
  chunks.push({
    id: index,
    file,
    itemCount: slice.length,
  });
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  totalItems: items.length,
  chunkSize: CHUNK_SIZE,
  chunks,
  articleChunkMap,
  summary: {
    channels: [...channelCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([name, count]) => ({ name, count })),
    dates: [...dateCounts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, count]) => ({ day, count })),
    tags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count })),
    scores: [
      { label: '全部', count: scoreBuckets['全部'] },
      { label: '高匹配', count: scoreBuckets['高匹配'] },
      { label: '中匹配', count: scoreBuckets['中匹配'] },
    ],
  },
};

writeJson(manifestFile, manifest);
console.log(`Built ${chunks.length} chunks for ${items.length} items`);
