import { createRequire } from 'node:module';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dotSpeech } from './e1002-dot-speech.mjs';

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
let forecastKind;
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
  forecastKind = forecast.kind;
  status = { ...evening, detail: ({
    office: '내일 방문은 안내된 시간에 가능합니다.',
    scheduled: '내일은 일정이 있어 방문 전 확인해 주세요.',
    away: '내일은 외부 일정으로 자리를 비웁니다.',
    closed: '내일은 방문 일정이 없습니다.'
  })[forecast.kind] || evening.detail };
  if (forecast.kind === 'scheduled') {
    const labels = new Map([['busy', '일정'], ['meeting', '회의'], ['teaching', '수업'], ['away', '외출'], ['lunch', '점심']]);
    const time = '(?:[01]\\d|2[0-3]):[0-5]\\d';
    const range = new RegExp('^' + time + '-' + time + '$');
    const agenda = (Array.isArray(forecast.agenda) ? forecast.agenda : [])
      .filter(item => item && labels.has(item.type) && typeof item.time === 'string' && range.test(item.time))
      .slice(0, 2);
    if (agenda.length) {
      status.plan_label = "Tomorrow's Plan";
      status.detail = '내일 일정과 방문 가능 시간을 확인해 주세요.';
      agenda.forEach((item, index) => {
        const prefix = `up_next_${index + 1}`;
        status[prefix + '_time'] = item.time;
        status[prefix + '_title'] = labels.get(item.type);
        status[prefix + '_type'] = item.type;
      });
    }
    if (typeof forecast.visit_after === 'string' && new RegExp('^' + time + '$').test(forecast.visit_after)) {
      status.next_label = 'TOMORROW';
      status.next_available = forecast.visit_after;
    } else if (typeof forecast.visit_before === 'string' && new RegExp('^' + time + '$').test(forecast.visit_before)) {
      status.next_label = 'TOMORROW UNTIL';
      status.next_available = forecast.visit_before;
      status.dot_guidance = { kind: 'before', time: forecast.visit_before };
    }
  }
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
  await page.addStyleTag({ content: `
    .canvas::after { box-shadow: inset 0 0 0 2px var(--accent); }
    .battery-gauge { display: none !important; }
    .next.no-time { border-left: 0; }
    .next.no-time .label, .next.no-time .next-label-bitmap, .next.no-time .next-time { display: none; }
    .render-dot { position: absolute; left: 318px; top: 82px; width: 285px; height: 65px; display: flex; align-items: center; justify-content: flex-end; gap: 7px; pointer-events: none; }
    .render-dot.is-right { left: 629px; width: 149px; }
    .render-dot img { flex: none; width: 52px; height: 58px; object-fit: contain; }
    .render-dot-speech { position: relative; max-width: 226px; padding: 5px 7px; border: 2px solid var(--accent); border-radius: 6px; background: #fff; color: #000; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; line-height: 1.2; }
    .render-dot.is-right .render-dot-speech { min-width: 0; white-space: normal; word-break: keep-all; padding-inline: 4px; }
    .render-dot.is-right.is-evening { top: 90px; height: 116px; flex-direction: column; justify-content: flex-start; gap: 5px; }
    .render-dot.is-right.is-evening .render-dot-speech { white-space: nowrap; font-size: 13px; padding-inline: 6px; }
    .render-dot-speech::after { content: ''; position: absolute; right: -5px; top: calc(50% - 4px); width: 7px; height: 7px; border: solid var(--accent); border-width: 2px 2px 0 0; background: #fff; transform: rotate(45deg); }
    .render-dot.is-right.is-evening .render-dot-speech::after { right: calc(50% - 4px); top: auto; bottom: -5px; border-width: 0 2px 2px 0; }
  ` });
  const speech = dotSpeech(status, mode, forecastKind);
  const weekend = /^(Sat|Sun),\s/.test(status.date || '');
  await page.evaluate(async ({ png, speech, weekend, evening }) => {
    const next = document.querySelector('.next');
    const hasTime = Boolean(next.querySelector('.next-time').textContent.trim());
    next.classList.toggle('no-time', !hasTime);
    const icon = new Image();
    icon.alt = '';
    icon.src = 'data:image/png;base64,' + png;
    await icon.decode();
    const note = document.createElement('div');
    note.className = 'render-dot';
    note.classList.toggle('is-right', weekend || !hasTime);
    note.classList.toggle('is-evening', evening);
    const bubble = document.createElement('span');
    bubble.className = 'render-dot-speech';
    bubble.textContent = speech;
    if (speech) note.append(bubble);
    note.append(icon);
    document.querySelector('.canvas').append(note);
  }, { png: dot.toString('base64'), speech, weekend, evening: mode === 'evening' });
  await mkdir(dirname(output), { recursive: true });
  await page.locator('.canvas').screenshot({ path: output + '.tmp', type: 'png' });
  await rename(output + '.tmp', output);
} finally {
  await browser.close();
}
