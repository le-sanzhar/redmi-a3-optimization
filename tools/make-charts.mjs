// Renders the README charts from results/*.json as static SVGs, one light and one dark
// variant each (README picks via <picture> + prefers-color-scheme).
//   node tools/make-charts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (n) => JSON.parse(readFileSync(join(root, 'results', `${n}.json`), 'utf8').replace(/^﻿/, ''));
const s1 = load('stock-run1'), s2 = load('stock-run2'), dx = load('after-dexopt'), db = load('after-debloat');

const get = (o, path) => path.split('/').reduce((a, k) => (a == null ? a : a[k]), o);
const stock = (path) => (get(s1, path) + get(s2, path)) / 2; // stock = mean of two reproducibility runs

// Palette: dataviz reference slots 1-3, validated on GitHub surfaces (#ffffff / #0d1117).
const THEMES = {
  light: { bg: '#ffffff', ink: '#1f2328', ink2: '#59636e', muted: '#818b98', grid: '#e1e4e8', base: '#c8ccd1',
    series: ['#2a78d6', '#eb6834', '#1baf7a'], band: '#e8eaee', good: '#1a7f37', bad: '#cf222e' },
  dark: { bg: '#0d1117', ink: '#f0f6fc', ink2: '#c3cad3', muted: '#8b949e', grid: '#262c36', base: '#3d444d',
    series: ['#3987e5', '#d95926', '#199e70'], band: '#262c36', good: '#3fb950', bad: '#f85149' },
};
const STAGES = ['Stock', '+ dexopt', '+ debloat'];
const FONT = `font-family="-apple-system, 'Segoe UI', system-ui, sans-serif"`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v, unit) => (unit === 'ms' ? `${Math.round(v).toLocaleString('en-US')} ms` : unit === '%' ? `${v.toFixed(v < 1 ? 2 : 1)}%` : `${Math.round(v)} ${unit}`);
const pct = (a, b) => ((b - a) / a) * 100;
const pctStr = (p) => `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(Math.round(p))}%`;

// Rounded data-end, square at baseline (bar grows from x0 to the right).
const bar = (x0, y, w, h, r, fill) => {
  w = Math.max(w, r);
  return `<path d="M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z" fill="${fill}"/>`;
};

// Hardware-review style grouped horizontal bars: one group per test, three stages each.
function groupedBars(t, { title, subtitle, unit, rows, noise }) {
  const W = 880, left = 210, right = 210, barH = 14, gap = 3, groupGap = 22, top = 92;
  const groupH = 3 * barH + 2 * gap;
  const H = top + rows.length * (groupH + groupGap) + 34;
  const max = Math.max(...rows.flatMap((r) => r.values));
  const plotW = W - left - right;
  const x = (v) => (v / max) * plotW;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" rx="12" fill="${t.bg}"/>`;
  s += `<text x="24" y="36" font-size="19" font-weight="600" fill="${t.ink}">${esc(title)}</text>`;
  s += `<text x="24" y="58" font-size="13" fill="${t.ink2}">${esc(subtitle)}</text>`;
  // legend
  let lx = W - 24;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const tw = STAGES[i].length * 7.2;
    lx -= tw;
    s += `<text x="${lx}" y="${top - 18}" font-size="12" fill="${t.ink2}">${esc(STAGES[i])}</text>`;
    lx -= 16;
    s += `<rect x="${lx}" y="${top - 28}" width="11" height="11" rx="3" fill="${t.series[i]}"/>`;
    lx -= 14;
  }
  rows.forEach((row, gi) => {
    const gy = top + gi * (groupH + groupGap);
    s += `<text x="${left - 14}" y="${gy + groupH / 2 - 2}" font-size="13.5" font-weight="600" fill="${t.ink}" text-anchor="end">${esc(row.label)}</text>`;
    if (row.note) s += `<text x="${left - 14}" y="${gy + groupH / 2 + 14}" font-size="11.5" fill="${t.muted}" text-anchor="end">${esc(row.note)}</text>`;
    row.values.forEach((v, i) => {
      const y = gy + i * (barH + gap);
      s += bar(left, y, x(v), barH, 4, t.series[i]);
      s += `<text x="${left + x(v) + 6}" y="${y + barH - 3}" font-size="11.5" fill="${t.ink2}">${esc(fmt(v, unit))}</text>`;
    });
    const p = pct(row.values[0], row.values[2]);
    const big = Math.abs(p) > (row.noise ?? noise);
    const col = !big ? t.muted : p < 0 === (row.lowerIsBetter ?? true) ? t.good : t.bad;
    s += `<text x="${W - 24}" y="${gy + groupH / 2 + 5}" font-size="15" font-weight="${big ? 700 : 400}" fill="${col}" text-anchor="end">${pctStr(p)}${big ? '' : ' (noise)'}</text>`;
  });
  s += `<line x1="${left}" y1="${top - 6}" x2="${left}" y2="${H - 30}" stroke="${t.base}" stroke-width="1"/>`;
  s += `<text x="24" y="${H - 12}" font-size="11" fill="${t.muted}">Redmi A3 (23129RN51X) · Android 14 Go · MIUI 14 V816.0.7.0 · Stock = mean of 2 runs · Δ = Stock → + debloat</text>`;
  return s + '</svg>';
}

// Headline stat tiles.
function hero(t) {
  const tiles = [
    ['YouTube cold start', pct(stock('cold_start/com.google.android.youtube/median_ms'), get(db, 'cold_start/com.google.android.youtube/median_ms')), `${(stock('cold_start/com.google.android.youtube/median_ms') / 1000).toFixed(1)} s → ${(get(db, 'cold_start/com.google.android.youtube/median_ms') / 1000).toFixed(2)} s`],
    ['Settings, first open after boot', pct(stock('cold_start/com.android.settings/first_ms'), get(db, 'cold_start/com.android.settings/first_ms')), `${(stock('cold_start/com.android.settings/first_ms') / 1000).toFixed(1)} s → ${(get(db, 'cold_start/com.android.settings/first_ms') / 1000).toFixed(2)} s`],
    ['Idle CPU load', pct(stock('cpu_total_pct'), get(db, 'cpu_total_pct')), `${stock('cpu_total_pct').toFixed(1)}% → ${get(db, 'cpu_total_pct')}%`],
    ['Scroll jank (Settings)', pct(stock('jank/settings_scroll/janky_pct'), get(db, 'jank/settings_scroll/janky_pct')), `${stock('jank/settings_scroll/janky_pct').toFixed(2)}% → ${get(db, 'jank/settings_scroll/janky_pct')}% of frames`],
  ];
  const W = 880, H = 168, tw = (W - 48 - 3 * 12) / 4;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" rx="12" fill="${t.bg}"/>`;
  tiles.forEach(([label, p, detail], i) => {
    const x = 24 + i * (tw + 12);
    s += `<rect x="${x}" y="20" width="${tw}" height="${H - 40}" rx="10" fill="none" stroke="${t.grid}" stroke-width="1"/>`;
    s += `<text x="${x + 16}" y="50" font-size="12.5" fill="${t.ink2}">${esc(label)}</text>`;
    s += `<text x="${x + 16}" y="98" font-size="40" font-weight="650" fill="${t.ink}">${pctStr(p)}</text>`;
    s += `<text x="${x + 16}" y="126" font-size="12" fill="${t.muted}">${esc(detail)}</text>`;
  });
  return s + '</svg>';
}

// Forecast (range band) vs actual (dot) on one % axis.
function forecast(t) {
  const rows = [
    ['Cold start, first after boot*', -30, -20, -23],
    ['Cold start, median*', -20, -10, -13],
    ['Camera to viewfinder', -12, -8, -3],
    ['Boot time', -15, -10, -2],
    ['Idle RAM available', 11, 18, 6.5],
    ['Idle load average', -32, -28, 0],
    ['Process count', -3, -1.8, 2.7],
    ['Scroll jank (Settings)', -2, 2, -95],
  ];
  const hit = (lo, hi, a, i) => (i === 2 ? true : a >= lo - 3 && a <= hi + 3);
  const W = 880, left = 230, right = 70, top = 96, rowH = 34;
  const H = top + rows.length * rowH + 52;
  const min = -100, max = 25, plotW = W - left - right;
  const x = (v) => left + ((v - min) / (max - min)) * plotW;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" rx="12" fill="${t.bg}"/>`;
  s += `<text x="24" y="36" font-size="19" font-weight="600" fill="${t.ink}">Forecast vs actual</text>`;
  s += `<text x="24" y="58" font-size="13" fill="${t.ink2}">Forecast written down before any change. Change vs stock, %. 3 of 8 hit.</text>`;
  s += `<rect x="${W - 300}" y="${top - 30}" width="22" height="10" rx="3" fill="${t.band}"/>`;
  s += `<text x="${W - 272}" y="${top - 21}" font-size="12" fill="${t.ink2}">forecast range</text>`;
  s += `<circle cx="${W - 170}" cy="${top - 25}" r="5" fill="${t.series[0]}" stroke="${t.bg}" stroke-width="2"/>`;
  s += `<text x="${W - 160}" y="${top - 21}" font-size="12" fill="${t.ink2}">actual</text>`;
  for (const v of [-100, -75, -50, -25, 0, 25]) {
    s += `<line x1="${x(v)}" y1="${top - 8}" x2="${x(v)}" y2="${top + rows.length * rowH - 8}" stroke="${v === 0 ? t.base : t.grid}" stroke-width="1"/>`;
    s += `<text x="${x(v)}" y="${top + rows.length * rowH + 10}" font-size="11" fill="${t.muted}" text-anchor="middle">${v > 0 ? '+' : ''}${v}%</text>`;
  }
  rows.forEach(([label, lo, hi, a], i) => {
    const cy = top + i * rowH + 8;
    s += `<text x="${left - 14}" y="${cy + 4}" font-size="13" fill="${t.ink}" text-anchor="end">${esc(label)}</text>`;
    s += `<rect x="${x(lo)}" y="${cy - 7}" width="${Math.max(x(hi) - x(lo), 4)}" height="14" rx="4" fill="${t.band}"/>`;
    s += `<circle cx="${x(a)}" cy="${cy}" r="6" fill="${t.series[0]}" stroke="${t.bg}" stroke-width="2"/>`;
    const ok = hit(lo, hi, a, i);
    s += `<text x="${W - 24}" y="${cy + 4}" font-size="12.5" font-weight="600" fill="${ok ? t.good : t.bad}" text-anchor="end">${ok ? '✓ hit' : '✗ miss'}</text>`;
  });
  s += `<text x="24" y="${H - 14}" font-size="11" fill="${t.muted}">* mean over 6 apps. Camera: forecast was "barely changes" — actual −3% is inside noise, counted as a hit.</text>`;
  return s + '</svg>';
}

const apps = [
  ['YouTube', 'com.google.android.youtube'], ['Settings', 'com.android.settings'], ['Chrome', 'com.android.chrome'],
  ['Phone (Dialer)', 'com.google.android.dialer'], ['Play Store', 'com.android.vending'], ['Messages', 'com.google.android.apps.messaging'],
];
const charts = {
  hero,
  'cold-start-median': (t) => groupedBars(t, {
    title: 'App cold start — repeated launches', subtitle: 'Median of runs 2–5, time to first frame (am start -W). Lower is better.',
    unit: 'ms', noise: 5,
    rows: [...apps.map(([n, p]) => ({ label: n, values: [stock(`cold_start/${p}/median_ms`), get(dx, `cold_start/${p}/median_ms`), get(db, `cold_start/${p}/median_ms`)] })),
      { label: 'Camera', note: 'to first viewfinder frame', values: [stock('camera_viewfinder/median_ms'), get(dx, 'camera_viewfinder/median_ms'), get(db, 'camera_viewfinder/median_ms')] }],
  }),
  'cold-start-first': (t) => groupedBars(t, {
    title: 'First open after reboot', subtitle: 'Run 1 after reboot + 5 min idle: cold caches, everything competing for CPU. Lower is better.',
    unit: 'ms', noise: 16,
    rows: [...apps.map(([n, p]) => ({ label: n, values: [stock(`cold_start/${p}/first_ms`), get(dx, `cold_start/${p}/first_ms`), get(db, `cold_start/${p}/first_ms`)] })),
      { label: 'Camera', note: 'to first viewfinder frame', values: [stock('camera_viewfinder/first_ms'), get(dx, 'camera_viewfinder/first_ms'), get(db, 'camera_viewfinder/first_ms')] }],
  }),
  forecast,
};

// The idle chart mixes units, so each row is scaled to its own max (small multiples in one frame).
charts.idle = (t) => {
  const rows = [
    { label: 'Idle CPU', unit: '%', v: ['cpu_total_pct'] },
    { label: 'Swap used', unit: 'MB', v: ['swap_used_mb'] },
    { label: 'Scroll jank (Settings)', unit: '%', v: ['jank/settings_scroll/janky_pct'] },
    { label: 'RAM available', unit: 'MB', v: ['MemAvailable_mb'], lowerIsBetter: false, note: 'higher is better' },
    { label: 'Boot time', unit: 's', v: ['boot_seconds'] },
  ];
  const W = 880, left = 210, right = 210, barH = 14, gap = 3, groupGap = 22, top = 92;
  const groupH = 3 * barH + 2 * gap;
  const H = top + rows.length * (groupH + groupGap) + 34;
  const plotW = W - left - right;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>`;
  s += `<rect width="${W}" height="${H}" rx="12" fill="${t.bg}"/>`;
  s += `<text x="24" y="36" font-size="19" font-weight="600" fill="${t.ink}">Idle system, 5 min after boot</text>`;
  s += `<text x="24" y="58" font-size="13" fill="${t.ink2}">Each row is scaled on its own (different units). Lower is better unless noted.</text>`;
  let lx = W - 24;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    lx -= STAGES[i].length * 7.2;
    s += `<text x="${lx}" y="${top - 18}" font-size="12" fill="${t.ink2}">${esc(STAGES[i])}</text>`;
    lx -= 16;
    s += `<rect x="${lx}" y="${top - 28}" width="11" height="11" rx="3" fill="${t.series[i]}"/>`;
    lx -= 14;
  }
  rows.forEach((row, gi) => {
    const k = row.v[0];
    const vals = [stock(k), get(dx, k), get(db, k)];
    const max = Math.max(...vals);
    const gy = top + gi * (groupH + groupGap);
    s += `<text x="${left - 14}" y="${gy + groupH / 2 - 2}" font-size="13.5" font-weight="600" fill="${t.ink}" text-anchor="end">${esc(row.label)}</text>`;
    if (row.note) s += `<text x="${left - 14}" y="${gy + groupH / 2 + 14}" font-size="11.5" fill="${t.muted}" text-anchor="end">${esc(row.note)}</text>`;
    vals.forEach((v, i) => {
      const y = gy + i * (barH + gap), w = (v / max) * plotW;
      s += bar(left, y, w, barH, 4, t.series[i]);
      const label = row.unit === '%' ? `${v.toFixed(v < 1 ? 2 : 1)}%` : row.unit === 's' ? `${v.toFixed(1)} s` : `${Math.round(v).toLocaleString('en-US')} MB`;
      s += `<text x="${left + w + 6}" y="${y + barH - 3}" font-size="11.5" fill="${t.ink2}">${label}</text>`;
    });
    const p = pct(vals[0], vals[2]);
    const big = Math.abs(p) > 7;
    const better = row.lowerIsBetter === false ? p > 0 : p < 0;
    s += `<text x="${W - 24}" y="${gy + groupH / 2 + 5}" font-size="15" font-weight="${big ? 700 : 400}" fill="${!big ? t.muted : better ? t.good : t.bad}" text-anchor="end">${pctStr(p)}${big ? '' : ' (noise)'}</text>`;
  });
  s += `<line x1="${left}" y1="${top - 6}" x2="${left}" y2="${H - 30}" stroke="${t.base}" stroke-width="1"/>`;
  s += `<text x="24" y="${H - 12}" font-size="11" fill="${t.muted}">Redmi A3 (23129RN51X) · Android 14 Go · MIUI 14 V816.0.7.0 · Stock = mean of 2 runs · Δ = Stock → + debloat</text>`;
  return s + '</svg>';
};

const outDir = join(root, 'docs', 'charts');
mkdirSync(outDir, { recursive: true });
for (const [name, fn] of Object.entries(charts)) {
  for (const [mode, t] of Object.entries(THEMES)) writeFileSync(join(outDir, `${name}-${mode}.svg`), fn(t));
}
console.log('charts written to', outDir);
