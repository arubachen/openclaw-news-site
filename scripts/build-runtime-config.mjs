import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function resolveBuildId() {
  const envBuildId = String(process.env.SITE_BUILD_ID || '').trim();
  if (envBuildId) return envBuildId;

  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  }
}

const outputFile = path.resolve('runtime-config.js');
const config = {
  buildId: resolveBuildId(),
  cloudflareWebAnalyticsToken: String(process.env.CF_WEB_ANALYTICS_TOKEN || 'ada8c7e49f9c46bd97e3dd02ed2f3900').trim(),
  cloudflareWebAnalyticsSpa: false,
};

const contents = `window.__SITE_CONFIG__ = Object.freeze(${JSON.stringify(config, null, 2)});\n`;
fs.writeFileSync(outputFile, contents, 'utf8');
console.log(`Built runtime config at ${outputFile}`);
