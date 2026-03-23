# 情报站（GitHub Pages 静态版）

这是一个可以直接部署到 **GitHub Pages** 的静态资讯站骨架，目标是把现有的：

- 运营商动态
- 市场快讯
- 竞品情报
- 软通动态
- 招投标

统一收口成一个可浏览、可检索、可归档的网页站点。

## 现在已经有的能力

- 首页资讯流
- 按频道筛选
- 按日期筛选
- 按标签筛选
- 关键词搜索
- 详情页（Hash 路由，天然兼容 GitHub Pages）
- GitHub Pages Actions 部署工作流

## 目录结构

```text
news-site/
├─ .github/workflows/pages.yml   # GitHub Pages 发布
├─ data/news.json                # 资讯数据源
├─ scripts/validate-data.mjs     # 数据校验脚本
├─ index.html                    # 站点入口
├─ app.js                        # 前端逻辑
├─ styles.css                    # 样式
└─ README.md
```

## 本地预览

```bash
cd /Users/arubachen/.openclaw/workspace/news-site
npm run serve
# 打开 http://localhost:4173
```

## 校验数据

```bash
cd /Users/arubachen/.openclaw/workspace/news-site
npm run validate
```

## GitHub Pages 发布

### 推荐方式

把 `news-site/` 作为一个独立仓库根目录使用，然后直接推到 GitHub。

仓库需要开启：
- **Settings → Pages → Build and deployment → GitHub Actions**

工作流已经放在：
```text
.github/workflows/pages.yml
```

## 数据格式

所有内容来自：
```text
data/news.json
```

每条资讯示例：

```json
{
  "id": "2026-03-23-market-001",
  "slug": "national-compute-network-plan",
  "channel": "市场快讯",
  "title": "全国一体化算力网建设纳入十五五规划",
  "score": 8.6,
  "publishedAt": "2026-03-23T09:30:00+08:00",
  "summary": "...",
  "facts": [
    { "label": "主", "value": "..." },
    { "label": "时", "value": "..." },
    { "label": "数", "value": "..." },
    { "label": "影", "value": "..." }
  ],
  "judgment": "...",
  "tags": ["算力", "政策"],
  "sourceName": "国家数据局",
  "sourceType": "政策公告",
  "sourceUrl": "https://example.com/article"
}
```

## 让 cron 自动写进站点

已经准备好的写入脚本：

```bash
python3 /Users/arubachen/.openclaw/workspace/news-site/scripts/upsert_news.py \
  --input /Users/arubachen/.openclaw/workspace/news-site/scripts/sample-import.json
```

脚本会：
- 读取一个 JSON object / array
- 自动补 `id` / `slug`
- 按 `id` / `sourceUrl` / `channel+title` 去重更新
- 加文件锁，避免多个 cron 同时写坏 `data/news.json`
- 自动按 `publishedAt` 倒序整理

当前已经把这些 cron 接入站点同步：
- 运营商动态简报（晨报 / 午报 / 晚报）
- 市场/科技/政策快讯（2小时）
- 竞品情报扫描（4小时）
- 软通动态（4小时）
- 招投标监测（1小时）

它们会在**成功发送 Discord 卡片后**，再把本轮实际发送的条目批量写入：
```text
/Users/arubachen/.openclaw/workspace/news-site/data/news.json
```

## 下一步最值得做的事

1. 增加 `feed.json` / RSS
2. 增加“置顶观察主题”页
3. 增加“只看高分 / 只看某频道”预设视图
4. 如果后面要做权限控制，再迁去 Cloudflare Pages / Access

## 备注

当前实现采用 **Hash 路由**（例如 `#/article/slug`），是为了：
- 兼容 GitHub Pages
- 不需要额外 404 rewrite
- 后续迁移也方便
