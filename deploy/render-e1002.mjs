import { createRequire } from 'node:module';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [mode, output] = process.argv.slice(2);
if (!['morning', 'evening'].includes(mode) || !output) {
  throw new Error('Usage: node deploy/render-e1002.mjs morning|evening output.png');
}

const source = new URL(process.env.E1002_PAGE || 'https://chungmaruq.github.io/sensecraft/office-hours-live.html');
const data = new URL('status.json', source);
const dot = await readFile(new URL('../sensecraft/office-v2-dot.png', import.meta.url));
const evening = {
  mode: 'daily', display_name: 'Prof. Hyunwoo Kim', state: 'away',
  status_label: 'AFTER HOURS', headline: 'Out of Office',
  detail: '오늘 방문은 마감됐습니다.',
  todays_hours: '09:30-12:00 / 13:00-18:00',
  plan_label: 'URGENT MATTERS', up_next_1_title: '긴급 문의는 534호로\n생약학연구실'
};
let status = evening;
if (mode === 'evening' && (process.env.E1002_TOMORROW_FILE || process.env.E1002_TOMORROW_URL)) {
  const snapshot = process.env.E1002_TOMORROW_FILE;
  let forecast;
  if (snapshot) {
    forecast = JSON.parse(await readFile(snapshot, 'utf8'));
  } else {
    const response = await fetch(process.env.E1002_TOMORROW_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Tomorrow feed HTTP ${response.status}`);
    forecast = await response.json();
  }
  const imageDate = snapshot && output.match(/(\d{4}-\d{2}-\d{2})-evening\.png$/);
  if (snapshot && !imageDate) throw new Error('Expected a dated evening image filename');
  const day = imageDate ? Date.parse(imageDate[1] + 'T00:00:00+09:00') : Date.now();
  const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' })
    .format(new Date(day + 86400000));
  if (forecast.date !== tomorrow) throw new Error('Tomorrow forecast is missing or stale');
  status = { ...evening, detail: ({
    office: '내일 방문은 안내된 시간에 가능합니다.',
    scheduled: '내일은 일정이 있어 방문 전 확인해 주세요.',
    away: '내일은 외부 일정으로 자리를 비웁니다.',
    closed: '내일은 방문 일정이 없습니다.'
  })[forecast.kind] || evening.detail };
}
if (mode === 'morning') {
  const response = await fetch(data, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Calendar feed HTTP ${response.status}`);
  status = await response.json();
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', weekday: 'short', month: 'short', day: 'numeric'
  }).format(new Date());
  if (status.date !== today || !status.headline || status.source !== 'calendar') {
    throw new Error('Calendar feed is not a current Seoul-date calendar status');
  }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 480 }, deviceScaleFactor: 1 });
  await page.route(url => url.pathname === data.pathname, route =>
    route.fulfill({ json: status }));
  source.searchParams.set('data', data.href);
  await page.goto(source.href);
  await page.waitForFunction(expected => document.querySelector('.headline')?.textContent === expected, status.headline);
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.locator('.lab-qr').evaluate(img => img.complete && img.naturalWidth > 0))) {
    throw new Error('Lab QR asset did not load');
  }
  await page.addStyleTag({ content: 'html, body { font-family: Arial, "Noto Sans CJK KR", sans-serif; }' });
  await page.evaluate(async data => {
    await document.fonts.ready;
    applyStatus(normalizeStatus(data));
  }, status);
  await page.evaluate(async png => {
    const icon = new Image();
    icon.alt = '';
    icon.src = 'data:image/png;base64,' + png;
    await icon.decode();
    // The right-column heading starts at y=157. Keep the icon above it.
    icon.style.cssText = 'position:absolute;left:667px;top:81px;width:68px;height:68px;object-fit:contain;pointer-events:none';
    document.querySelector('.canvas').append(icon);
  }, dot.toString('base64'));
  await mkdir(dirname(output), { recursive: true });
  await page.locator('.canvas').screenshot({ path: output + '.tmp', type: 'png' });
  await rename(output + '.tmp', output);
} finally {
  await browser.close();
}
