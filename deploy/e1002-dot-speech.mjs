const morning = new Map([
  ['welcome', '오늘은 방문 가능해요!'],
  ['busy', '오늘은 일정이 있어요.'],
  ['teaching', '오늘 수업이 있어요.'],
  ['meeting', '오늘 회의가 있어요.'],
  ['away', '오늘은 방문이 어려워요.'],
  ['closed', '평일에 다시 만나요!'],
  ['check', '']
]);
const evening = new Map([
  ['office', '내일 와 주세요!'],
  ['scheduled', '내일은 일정이 있어요.'],
  ['away', '내일은 부재중이에요.'],
  ['closed', '다음 방문일에 만나요!']
]);

export function dotSpeech(status, mode, forecastKind) {
  if (mode === 'evening') return evening.get(forecastKind) || '다음에 만나요!';
  const fallback = { available: 'welcome', lunch: 'busy', busy: 'busy', meeting: 'meeting', teaching: 'teaching', away: 'away', closed: 'closed' };
  const known = status.headline === 'No Office Hours' ? 'closed' : fallback[status.state];
  const hint = morning.has(status.dot_hint) ? status.dot_hint : known || 'check';
  if (['busy', 'teaching', 'meeting'].includes(hint)) {
    const guidance = status.dot_guidance;
    if (guidance?.kind === 'morning' && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(status.next_available || '')) {
      return '오전 중에 오시는 게 좋아요!';
    }
    if (guidance?.time && guidance.time === status.next_available) {
      const at = koreanTime(guidance.time);
      if (at && guidance.kind === 'before') return `오늘은 ${at} 전에 와 주세요.`;
      if (at && guidance.kind === 'from') return `${at} 이후가 좋아요!`;
    }
  }
  if (hint === 'meeting' || hint === 'busy') {
    const type = hint === 'meeting' ? 'meeting' : 'away';
    const periods = agendaPeriods(status, type);
    if (periods) return `${periods}에 ${type === 'meeting' ? '회의가' : '외출 일정이'} 있어요.`;
  }
  return morning.get(hint);
}

function koreanTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const h = Number(match[1]), m = Number(match[2]);
  if (h > 23 || m > 59) return '';
  return `${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}시${m === 30 ? ' 반' : m ? ` ${m}분` : ''}`;
}

function agendaPeriods(status, type) {
  let am = false;
  let pm = false;
  for (let i = 1; i <= 3; i++) {
    if (status[`up_next_${i}_type`] !== type) continue;
    // No date prefix or "All Day": only a confirmed same-day time range qualifies.
    const match = /^(\d{2}):(\d{2})\s*[-–]\s*(\d{2}):(\d{2})$/.exec(status[`up_next_${i}_time`] || '');
    if (!match) continue;
    const [sh, sm, eh, em] = match.slice(1).map(Number);
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) continue;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start) continue;
    am ||= start < 720;
    pm ||= end > 720;
  }
  return am && pm ? '오전·오후' : am ? '오전' : pm ? '오후' : '';
}
