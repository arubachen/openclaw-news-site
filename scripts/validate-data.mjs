import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('data/news.json');
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);

if (!Array.isArray(data)) {
  throw new Error('data/news.json must be an array');
}

const required = ['id', 'slug', 'channel', 'title', 'publishedAt', 'summary', 'judgment', 'tags', 'sourceName', 'sourceType', 'sourceUrl'];
for (const [index, item] of data.entries()) {
  for (const field of required) {
    if (!(field in item)) {
      throw new Error(`Item #${index + 1} is missing required field: ${field}`);
    }
  }
  if (!Array.isArray(item.tags)) {
    throw new Error(`Item #${index + 1} tags must be an array`);
  }
  if (!Array.isArray(item.facts)) {
    throw new Error(`Item #${index + 1} facts must be an array`);
  }
}

console.log(`Validated ${data.length} news items from ${file}`);
