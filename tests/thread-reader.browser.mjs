// Requires Playwright. PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_EXECUTABLE_PATH can select a bundled runtime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const project = fileURLToPath(new URL('..', import.meta.url));
let server;
let browser;
try {
  let origin = process.env.READER_TEST_URL;
  if (!origin) {
    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    server = spawn(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
      '--host', '127.0.0.1', '--port', String(port)], { cwd: project, stdio: 'ignore', windowsHide: true });
    origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(origin)).ok; } catch { /* server is starting */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Vite did not start');
  }
  const { browserHash } = JSON.parse(await readFile(join(project, 'node_modules/.vite/deps/_metadata.json'), 'utf8'));
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  let unreadFetches = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/unread-source-image.png', route => { unreadFetches++; return route.abort(); });
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => 1, unregisterCallback() {} };
  });
  await page.route('**/__reader_virtual_test__', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html lang="zh-CN"><head></head><body style="margin:0"><div id="fixture" style="position:relative;width:100vw;height:100vh"></div></body></html>' }));
  await page.route('http://media.localhost/**', async route => {
    await delay(80);
    if (route.request().url().includes('wallpaper')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="blue"/></svg>' });
      return;
    }
    if (route.request().url().includes('reading-card')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" rx="24" fill="#26343e"/><rect x="32" y="50" width="536" height="70" rx="12" fill="#385462"/><text x="62" y="95" font-family="sans-serif" font-size="28" fill="#eef4f1">READING JOURNAL</text>'
        + Array.from({ length: 10 }, (_, i) => `<rect x="${i % 2 ? 180 : 40}" y="${160 + i * 75}" width="${i % 2 ? 370 : 340}" height="52" rx="10" fill="${i % 2 ? '#536e79' : '#354956'}"/>`).join('')
        + '<rect x="210" y="950" width="180" height="7" rx="4" fill="#91a5ac"/></svg>' });
      return;
    }
    await route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1600"><rect width="300" height="1600" fill="#5588aa"/></svg>' });
  });
  await page.goto(`${origin}/__reader_virtual_test__`);
  await page.evaluate(async hash => {
    const vue = await import(`/node_modules/.vite/deps/vue.js?v=${hash}`);
    const { createPinia } = await import(`/node_modules/.vite/deps/pinia.js?v=${hash}`);
    const { default: Reader } = await import('/src/components/thread/ThreadReader.vue');
    const { default: FloorIndex } = await import('/src/components/thread/ThreadFloorIndex.vue');
    await import('/src/styles/global.css');
    await import('/node_modules/@fontsource/material-symbols-outlined/400.css');
    const reads = new Set();
    let accesses = 0;
    const posts = Array.from({ length: 50000 }, (_, i) => {
      const content = [{ type: 0, text: (`第${i + 1}楼，这是大量楼层中的正文。\n`).repeat(4) }];
      return { id: i + 1, author_id: i % 2 + 1, floor: i + 1,
        get content() { reads.add(i); accesses++; return content; } };
    });
    const state = vue.reactive({ posts, loading: false, hasMore: true, error: '', onlyAuthor: false });
    const reader = vue.ref();
    const positions = [];
    const app = vue.createApp({ render: () => vue.h(Reader, { ...state, title: state.title || '按需排版性能验证',
      initialPostId: '1', ref: reader, onPosition: id => positions.push(id),
      onJump: () => { window.fixture.jumps++; }, onOnlyAuthor: () => { state.onlyAuthor = !state.onlyAuthor; },
      onLoadMore: () => { window.fixture.loads++; window.fixture.handler?.(); } }, {
        outline: ({ close }) => vue.h(FloorIndex, { panel: true,
          entries: state.posts.map(post => ({ id: String(post.id), floor: post.floor, avatar: '', preview: 'Index preview' })),
          currentId: positions.at(-1) || '1', readingIndex: 0, readingPage: 1, busy: state.loading,
          hasMore: state.hasMore, error: state.error,
          onLoadMore: () => { window.fixture.outlineLoads++; window.fixture.outlineHandler?.(); },
          favourite: false, favouriteHere: false, onlyAuthor: state.onlyAuthor, onClose: close,
          onNavigate: id => { reader.value.navigateToFloor(id); close(); },
        }),
      }) });
    app.use(createPinia());
    app.mount('#fixture');
    window.fixture = { state, reader, reads, positions, loads: 0, outlineLoads: 0, jumps: 0, accesses: () => accesses };
  }, browserHash);
  const idle = async () => {
    await page.waitForFunction(() => document.querySelector('.reader-screen:not([inert]) .reader-paper') && !document.querySelector('.reader-measure')
      && !document.querySelector('.reader-progress')?.textContent.includes('排版'));
    await delay(30);
  };
  const snapshot = () => page.evaluate(() => ({
    screens: document.querySelectorAll('.reader-screen').length,
    bodies: document.querySelectorAll('.reader-post').length,
    dom: document.querySelectorAll('.thread-reader *').length,
    reads: window.fixture.reads.size, accesses: window.fixture.accesses(), loads: window.fixture.loads,
    first: window.fixture.positions.at(-1),
    range: document.querySelector('.reader-range').textContent.trim(),
    parts: [...document.querySelectorAll('.reader-screen:not([inert]) .reader-post')].map(element => ({
      id: element.dataset.postId, from: +element.dataset.from, to: +element.dataset.to, text: element.textContent,
    })),
  }));
  await idle();
  let state = await snapshot();
  await page.evaluate(() => {
    window.readerMotion = { running: true, shifts: [] };
    const sample = () => {
      const paper = document.querySelector('.reader-screen:not([inert]) .reader-paper');
      const viewport = document.querySelector('.reader-viewport');
      if (paper && viewport) {
        const p = paper.getBoundingClientRect(); const v = viewport.getBoundingClientRect();
        if (!window.readerMotion.dragging && Math.abs(p.width - v.width) < 1 && Math.abs(p.left - v.left) > 1 && window.readerMotion.shifts.length < 40)
          window.readerMotion.shifts.push({ left: p.left - v.left, scroll: viewport.scrollLeft, width: p.width });
      }
      if (window.readerMotion.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  assert.match(state.range, /^第 \d+ 楼 - 第 \d+ 楼$/);
  assert.equal(await page.locator('.reader-page').count(), 0, 'unstable book-page counters must not be displayed');
  if (process.env.READER_SCREENSHOT_DIR) console.log('Reader font:', await page.locator('.reader-paper').first().evaluate(element => getComputedStyle(element).fontFamily));
  assert.ok(state.screens <= 3 && state.dom < 1000);
  assert.ok(state.reads < 30 && state.accesses < 200, 'initial layout must not parse all floors');
  assert.equal(state.loads, 0);
  await page.evaluate(() => {
    window.readerButtonChanges = [];
    window.readerButtonObserver = new MutationObserver(records => window.readerButtonChanges.push(...records.map(r => r.target.getAttribute('aria-label'))));
    [...document.querySelectorAll('.reader-controls button')].slice(1, 4).forEach(button =>
      window.readerButtonObserver.observe(button, { attributes: true, attributeFilter: ['disabled'] }));
  });
  for (let i = 0; i < 35; i++) {
    await page.locator('.thread-reader').focus();
    await page.keyboard.press('ArrowRight');
    await idle();
    state = await snapshot();
    assert.ok(state.screens <= 3 && state.dom < 1000, 'old screen DOM must be evicted');
  }
  assert.ok(state.reads < 400 && state.accesses < 10000);
  assert.deepEqual(await page.evaluate(() => {
    const pending = window.readerButtonObserver.takeRecords().map(r => r.target.getAttribute('aria-label'));
    window.readerButtonObserver.disconnect(); return [...window.readerButtonChanges, ...pending];
  }), [], 'transient pagination work must not toggle the disabled styling of toolbar buttons');
  console.log(`50,000 floors, after 35 screens: ${state.screens} screens, ${state.bodies} body fragments, ${state.dom} DOM elements`);
  await page.evaluate(() => window.fixture.reader.value.navigateToFloor('40000'));
  await idle();
  state = await snapshot();
  assert.equal(state.first, '40000');
  assert.ok(state.reads < 430 && state.dom < 1000, 'jumping must not paginate preceding floors');
  await page.evaluate(() => { window.fixture.state.hasMore = false; });

  const trackGeometry = await page.locator('.reader-viewport').evaluate(e => ({ width: e.clientWidth, track: e.scrollWidth, scroll: e.scrollLeft }));
  assert.equal(trackGeometry.track, 3 * trackGeometry.width, 'the virtual track must keep three fixed slots');
  assert.equal(trackGeometry.scroll, trackGeometry.width, 'the active screen must remain in the middle slot');
  const beforeSwipe = (await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to }));
  await page.evaluate(() => { window.readerMotion.dragging = true; });
  await page.locator('.reader-viewport').evaluate(e => { e.scrollLeft = 2 * e.clientWidth; });
  await delay(220); await idle();
  assert.notDeepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), beforeSwipe, 'horizontal swiping must still turn a page');
  await page.locator('.reader-viewport').evaluate(e => { e.scrollLeft = 0; });
  await delay(220); await idle();
  assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), beforeSwipe, 'horizontal swiping back must recover the same page');
  // Native dragging intentionally exposes intermediate offsets; only inspect programmatic flips/rebuilds above and below.
  await page.evaluate(() => { window.readerMotion.dragging = false; });

  const horizontalWheel = async (deltas, options = {}) => page.locator('.reader-viewport').evaluate(async (element, { deltas, options }) => {
    for (const deltaX of deltas) {
      element.dispatchEvent(new WheelEvent('wheel', { deltaX, bubbles: true, cancelable: true, ...options }));
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  }, { deltas, options });
  await horizontalWheel(Array(6).fill(8)); await idle();
  const afterShortSwipe = (await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to }));
  assert.notDeepEqual(afterShortSwipe, beforeSwipe, 'a short 48px trackpad swipe must turn a page on wide screens');
  await horizontalWheel(Array(20).fill(8)); await idle();
  assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), afterShortSwipe, 'momentum must not turn additional pages');
  await delay(220);
  await horizontalWheel(Array(6).fill(-8)); await idle();
  assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), beforeSwipe, 'a short reverse swipe must return to the same page');
  await delay(220);
  await horizontalWheel([2, 2, 2]); await idle();
  assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), beforeSwipe, 'tiny horizontal noise must not turn pages');
  await horizontalWheel([100], { ctrlKey: true }); await idle();
  assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), beforeSwipe, 'pinch/zoom modifiers must be left alone');
  assert.ok(await page.locator('.reader-viewport').evaluate(element => {
    const input = document.createElement('input'); element.appendChild(input);
    const event = new WheelEvent('wheel', { deltaX: 100, bubbles: true, cancelable: true });
    input.dispatchEvent(event); input.remove(); return !event.defaultPrevented;
  }), 'input controls must retain their own wheel behavior');

  await page.mouse.move(600, 780);
  await page.evaluate(() => { window.fixture.state.loading = true; });
  const jumpWhileLoading = page.getByRole('button', { name: '跳页', exact: true });
  assert.equal(await jumpWhileLoading.getAttribute('aria-disabled'), 'true');
  assert.equal(await jumpWhileLoading.evaluate(e => getComputedStyle(e).opacity), '1', 'loading must not dim the buttons');
  await jumpWhileLoading.evaluate(e => e.click());
  assert.equal(await page.evaluate(() => window.fixture.jumps), 0, 'loading still guards against repeated actions');
  await page.evaluate(() => { window.fixture.state.loading = false; });
  await page.getByRole('button', { name: '跳页', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixture.jumps), 1);
  await page.getByRole('button', { name: '只看楼主', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看全部回复', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '查看全部回复', exact: true }).click();
  const paperBeforeHover = await page.locator('.reader-screen:not([inert]) .reader-paper').boundingBox();
  const controls = await page.locator('.reader-controls').boundingBox();
  assert.ok(paperBeforeHover.y + paperBeforeHover.height <= controls.y, 'toolbar must have its own space below the paper');
  await page.mouse.move(600, 200); await delay(220);
  assert.deepEqual(await page.locator('.reader-screen:not([inert]) .reader-paper').boundingBox(), paperBeforeHover, 'hover visibility cannot move the paper');
  await page.mouse.move(600, 780);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  const outline = page.getByRole('dialog', { name: '大纲', exact: true });
  await outline.waitFor(); await delay(80);
  assert.ok(await outline.locator('.floor-entry').count() <= 64, 'the entire thread index must not be mounted');
  assert.ok((await outline.boundingBox()).height >= 799, 'outline must fill the pane height');
  assert.ok(await outline.locator('.floor-entry.current').count() === 1, 'outline must scroll to the current floor');
  await outline.locator('.floor-entries').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await delay(80);
  await outline.getByRole('button', { name: '跳转到第 50000 楼', exact: true }).click();
  await idle();
  assert.equal((await snapshot()).first, '50000');
  assert.equal(await outline.count(), 0);
  await page.mouse.move(600, 780);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await page.keyboard.press('Escape');
  await outline.waitFor({ state: 'detached' });
  assert.equal(await outline.count(), 0, 'Escape must close the outline before leaving the reader');
  assert.equal(await page.locator('.thread-reader').count(), 1);
  // Browsing the outline loads only its next API batch and preserves the browsing position.
  await page.evaluate(async () => {
    await window.fixture.reader.value.navigateToFloor('40000');
    window.fixture.state.hasMore = true;
    window.fixture.outlineHandler = () => {
      const f = window.fixture;
      f.state.loading = true;
      setTimeout(() => {
        f.state.posts.push(...Array.from({ length: 30 }, (_, i) => ({ id: 50001 + i, floor: 50001 + i,
          author_id: 1, content: [{ type: 0, text: 'Appended through outline' }] })));
        f.state.loading = false;
      }, 100);
    };
  });
  await idle();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(600, 780);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await outline.waitFor();
  assert.ok(await outline.evaluate(e => getComputedStyle(e).backdropFilter.includes('blur')), 'outline must use a blurred background');
  assert.ok(await outline.evaluate(e => getComputedStyle(e.parentElement).transitionDuration !== '0s'), 'drawer must animate when motion is enabled');
  await delay(270);
  const oldScroll = await outline.locator('.floor-entries').evaluate(e => { e.scrollTop = e.scrollHeight; return e.scrollTop; });
  await page.waitForFunction(() => window.fixture.outlineLoads === 1);
  await outline.locator('.floor-entries').evaluate(e => { for (let i = 0; i < 8; i++) e.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => window.fixture.state.posts.length === 50030 && !window.fixture.state.loading);
  await delay(100);
  assert.equal(await page.evaluate(() => window.fixture.outlineLoads), 1, 'bottom scroll events must not duplicate the request');
  assert.ok(Math.abs(await outline.locator('.floor-entries').evaluate(e => e.scrollTop) - oldScroll) < 1, 'appending entries must not scroll back to the reading floor');
  assert.equal((await snapshot()).first, '40000', 'outline pagination must preserve the reading anchor');
  assert.ok(await outline.locator('.floor-entry').count() <= 64);
  await page.keyboard.press('Escape');
  await outline.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { window.fixture.state.hasMore = false; });
  console.log('Passed: toolbar clearance/visibility, jump/filter controls, bounded full-height outline and floor navigation.');

  // An ordinary text spread must keep flowing into both columns, not stop after a short prefix.
  await page.evaluate(() => {
    const f = window.fixture;
    f.state.title = '晚风里的阅读手记';
    const paragraph = '到了晚上，整理作业时才发现，今天留下来的记录还有很多。阅读应该顺着段落自然展开，标点不挤到行首，表情🙂也应和正文在同一行。';
    f.state.posts = Array.from({ length: 30 }, (_, i) => ({ id: 92000 + i, author_id: i < 12 ? 1 : 2,
      floor: i + 1, author: { name_show: i < 12 ? '晚风' : '拾光' }, content: [
        { type: 0, text: (paragraph + '\n').repeat(5) },
        { type: 1, text: '文中的链接也能保持正确的换行', link: 'https://example.com/reading' },
        { type: 0, text: '\n' + paragraph },
      ] }));
    f.state.hasMore = false;
  });
  await idle();
  const inspectSpread = () => page.evaluate(() => {
    const paper = document.querySelector('.reader-screen:not([inert]) .reader-paper');
    const bounds = paper.getBoundingClientRect();
    const count = Number(paper.dataset.columns);
    const bottoms = Array.from({ length: count }, () => 0);
    let overflow = 0;
    let badStarts = 0;
    for (const line of paper.querySelectorAll('.reader-line')) {
      const rect = line.getBoundingClientRect();
      bottoms[Number(line.dataset.column)] = Math.max(bottoms[Number(line.dataset.column)], rect.bottom - bounds.top);
      if (/^[，。！？；：、）》】」』]/u.test(line.textContent.trimStart())) badStarts++;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const length = node.textContent.trimEnd().length;
        if (!length) continue;
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, length);
        for (const fragment of range.getClientRects()) {
          overflow = Math.max(overflow, fragment.right - rect.right, rect.left - fragment.left);
        }
      }
    }
    return { bottoms, height: bounds.height, overflow, badStarts };
  });
  const checkpoints = [];
  for (let i = 0; i < 7; i++) {
    const spread = await inspectSpread();
    assert.ok(spread.bottoms.every(bottom => spread.height - 28 - bottom < 80), `underfilled text column: ${JSON.stringify(spread)}`);
    assert.ok(spread.overflow < 1.5, `text exceeds its column: ${JSON.stringify(spread)}`);
    assert.equal(spread.badStarts, 0, 'Chinese closing punctuation cannot start a wrapped line');
    checkpoints.push((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })));
    if (i === 0 && process.env.READER_SCREENSHOT_DIR) {
      await mkdir(process.env.READER_SCREENSHOT_DIR, { recursive: true });
      await page.mouse.move(600, 780);
      await page.screenshot({ path: join(process.env.READER_SCREENSHOT_DIR, 'reader-text.png') });
    }
    if (i < 6) { await page.locator('.thread-reader').focus(); await page.keyboard.press('ArrowRight'); await idle(); }
  }
  for (let i = 5; i >= 0; i--) {
    await page.keyboard.press('ArrowLeft'); await idle();
    assert.deepEqual((await snapshot()).parts.map(({ id, from, to }) => ({ id, from, to })), checkpoints[i], 'evicted pages must recover exactly the same boundary');
  }
  console.log('Passed: full text columns, CJK punctuation, rich links and stable bidirectional page boundaries.');

  await page.evaluate(() => {
    const f = window.fixture;
    document.documentElement.classList.add('dark');
    const paragraph = '翻到这里，文字沿着两栏继续向前。长段落可以自然跨页，短段落仍留有恰当的呼吸；表情、链接和图片也应该各在其位，不打断阅读的节奏。';
    f.state.posts = [{ id: 92500, author_id: 1, floor: 1, author: { name_show: '晚风' }, content: [
      { type: 0, text: '读到夜深时，仍然想把这一段故事接着读完。\n' },
      { type: 3, bigCdnSrc: 'https://fixture.test/reading-card.svg', width: 600, height: 1000 },
      { type: 0, text: '\n' + paragraph.repeat(3) }, { type: 2, text: 'b01', c: '微笑' },
      { type: 0, text: '\n' + (paragraph + '\n').repeat(15) },
    ] }];
  });
  await idle(); await delay(250); await idle();
  const figure = await page.locator('.reader-screen:not([inert]) .reader-media').first().boundingBox();
  assert.ok(figure.width > 0 && figure.width <= 180 && figure.height <= 120, 'reader images must stay thumbnail-sized');
  assert.ok(await page.locator('.reader-screen:not([inert]) .emoticon').count() > 0, 'custom emoticons participate in inline layout');
  const mixed = await inspectSpread();
  assert.ok(mixed.overflow < 1.5, 'inline image boxes and styled text must remain inside their lines');
  if (process.env.READER_SCREENSHOT_DIR) {
    await page.mouse.move(600, 780);
    await page.screenshot({ path: join(process.env.READER_SCREENSHOT_DIR, 'reader-media.png') });
  }

  // Adjacent grid images followed by a new author's text (thread 4465225729).
  for (const imageGrid of [true, false]) {
    await page.evaluate(async imageGrid => {
      const { useSettingsStore } = await import('/src/stores/settings.ts');
      useSettingsStore().imageGrid = imageGrid;
      const f = window.fixture;
      f.state.hasMore = false;
      f.state.posts = [
        { id: 92600, author_id: 1, floor: 1, content: [
          ...Array.from({ length: 7 }, () => ({ type: 3, bigCdnSrc: 'https://fixture.test/wallpaper.svg', width: 1920, height: 1080 })),
        ] },
        { id: 92601, author_id: 2, floor: 2, author: { name_show: 'Longhorn4093' }, content: [{ type: 0, text: '名字取得不好，应该叫 Blackcomb&Vienna史' }] },
        { id: 92602, author_id: 3, floor: 3, author: { name_show: 'VistaWithSP2' }, content: [{ type: 0, text: '本层为目录，各版本所在楼层请看本层回复' }] },
      ];
    }, imageGrid);
    await idle(); await delay(250); await idle();
    const overflow = await page.locator('.reader-screen').evaluateAll(screens => screens.flatMap(screen =>
      [...screen.querySelectorAll('.reader-media img')].map(img => {
        const box = img.closest('.reader-media').getBoundingClientRect();
        const actual = img.getBoundingClientRect();
        return { html: img.parentElement.outerHTML, box: { top: box.top, bottom: box.bottom, width: box.width, height: box.height },
          actual: { top: actual.top, bottom: actual.bottom, width: actual.width, height: actual.height },
          overflow: Math.max(0, actual.bottom - box.bottom, box.top - actual.top, actual.right - box.right, box.left - actual.left) };
      })));
    const collisions = await page.locator('.reader-screen').evaluateAll(screens => screens.flatMap(screen => {
      const media = [...screen.querySelectorAll('.reader-media')].map(e => e.getBoundingClientRect());
      return [...screen.querySelectorAll('.reader-line, .reader-author-heading')].flatMap(e => {
        const r = e.getBoundingClientRect();
        return media.filter(m => Math.min(m.right,r.right)-Math.max(m.left,r.left)>1 && Math.min(m.bottom,r.bottom)-Math.max(m.top,r.top)>1).map(m=>({text:e.textContent, top:r.top, mediaBottom:m.bottom}));
      });
    }));
    assert.deepEqual(collisions, [], 'media must not overlap following text or author headings');
    assert.ok(overflow.length > 0);
    assert.ok(overflow.every(item => item.overflow < 1), JSON.stringify({ imageGrid, overflow }));
    const rows = await page.locator('.reader-screen:not([inert]) .reader-media').evaluateAll(elements => elements.map(e => {
      const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    assert.equal(rows.length, 7, 'all adjacent images must remain present');
    assert.ok(Math.abs(rows[0].top - rows[1].top) < 1 && rows[0].right < rows[1].left, 'adjacent thumbnails must share a row without overlap');
    assert.ok(rows.at(-1).top > rows[0].top, 'a full thumbnail row must wrap');
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      assert.ok(Math.min(rows[i].right, rows[j].right) - Math.max(rows[i].left, rows[j].left) <= 1
        || Math.min(rows[i].bottom, rows[j].bottom) - Math.max(rows[i].top, rows[j].top) <= 1, 'thumbnail rows must not overlap');
    }
  }

  // Actual browser ink, not just arithmetic page heights, must fit at reference-size and narrow viewports.
  await page.evaluate(async () => {
    const f = window.fixture;
    const { ReaderSource } = await import('/src/utils/reader-source.ts');
    const { processContentElements } = await import('/src/utils/helper.ts');
    const content = [
      { type: 0, text: ('中文混排 English words and links，<strong>加粗的字句</strong>、<span style="font-weight:bold">另一段加粗</span>以及 <em>italic words</em>。👨‍👩‍👧‍👦 🇨🇳 á é 都应该完整保留。\n').repeat(18) },
      { type: 4, uid: '123', text: '@晚风' }, { type: 2, text: 'b01', c: '微笑' },
      { type: 1, text: 'https://example.com/a-very-long-address-with-many-segments/reading-notes', link: 'https://example.com/reading' },
      { type: 0, text: '\n' + '标点与字形应当保持清楚，分页不能丢字，也不能把同一句话重复展示。'.repeat(30) },
    ];
    f.state.posts = Array.from({ length: 10 }, (_, i) => ({ id: 92700 + i, author_id: 1, floor: i + 1, content }));
    f.expected = new ReaderSource(processContentElements(content));
  });
  await idle();
  for (const size of [{ width: 1944, height: 1176 }, { width: 1000, height: 720 }, { width: 720, height: 800 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(size); await idle();
    await delay(50);
    assert.ok(await page.evaluate(() => document.querySelector('.reader-viewport').getBoundingClientRect().bottom
      <= document.querySelector('.reader-controls').getBoundingClientRect().top), 'wrapped toolbar must stay below the reading area');
    await page.evaluate(() => window.fixture.reader.value.navigateToFloor('92700')); await idle();
    for (let turn = 0; turn < 3; turn++) {
      const ink = await inspectSpread();
      assert.ok(ink.overflow < 1.5, `rich inline ink exceeds its column at ${size.width}px: ${JSON.stringify(ink)}`);
      assert.ok(ink.bottoms.every(bottom => ink.height - 28 - bottom < 80), `rich text underfills a column at ${size.width}px`);
      const mismatch = await page.evaluate(() => {
        const f = window.fixture;
        for (const part of document.querySelectorAll('.reader-screen:not([inert]) .reader-post')) {
          const container = document.createElement('div');
          container.innerHTML = f.expected.html(+part.dataset.from, +part.dataset.to);
          if (container.textContent !== part.textContent) return { from: part.dataset.from, to: part.dataset.to };
        }
        return null;
      });
      assert.equal(mismatch, null, `source text changed at ${size.width}px`);
      if (turn === 0 && size.width === 1944 && process.env.READER_SCREENSHOT_DIR) {
        await page.mouse.move(900, 1150);
        await page.screenshot({ path: join(process.env.READER_SCREENSHOT_DIR, 'reader-reference-size.png') });
      }
      await page.locator('.thread-reader').focus(); await page.keyboard.press('ArrowRight'); await idle();
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 }); await idle();
  console.log('Passed: reference-size/two-column/single-column/mobile layouts, mixed font weights, mentions, custom/ZWJ emoji, source-text fidelity.');

  // Refill the old, partially laid-out API tail, including an already-cached next page.
  await page.evaluate(() => {
    const f = window.fixture;
    f.state.posts = [{ id: 93000, author_id: 1, floor: 1, content: [{ type: 0, text: '后续楼层应该继续填入当前书页，而不是保留空白。'.repeat(60) }] }];
    f.state.hasMore = false;
  });
  await idle();
  await page.evaluate(() => window.fixture.state.posts.push({ id: 93001, author_id: 1, floor: 2,
    content: [{ type: 0, text: '这一段是后来加载的内容，应该自然接在尚未排满的页面里。'.repeat(180) }] }));
  await idle(); await page.locator('.thread-reader').focus(); await page.keyboard.press('ArrowRight'); await idle();
  const refilled = await inspectSpread();
  assert.ok(refilled.bottoms.every(bottom => refilled.height - 28 - bottom < 80), 'appended content must refill a provisional tail-page checkpoint');
  assert.ok((await snapshot()).parts.some(part => part.id === '93001'));

  await page.evaluate(() => {
    const f = window.fixture;
    f.longText = Array.from({ length: 30000 }, (_, i) => String(i).padStart(5, '0') + '，').join('');
    f.state.posts = [{ id: 70001, author_id: 1, floor: 1, content: [{ type: 0, text: f.longText }] }];
    f.state.hasMore = false;
  });
  await idle();
  let end = (await snapshot()).parts[0].to;
  for (let i = 0; i < 12; i++) {
    await page.locator('.thread-reader').focus();
    await page.keyboard.press('ArrowRight');
    await idle();
    state = await snapshot();
    const part = state.parts[0];
    assert.equal(part.from, end, 'no missing or repeated characters across screens');
    assert.equal(part.text, await page.evaluate(({ from, to }) => window.fixture.longText.slice(from, to), part));
    end = part.to;
    assert.ok(state.dom < 200);
  }
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowLeft'); await idle(); }
  state = await snapshot();
  const from = state.parts[0].from;
  assert.ok(await page.locator('.reader-viewport').evaluate(element => element.textContent.length) < 15000);
  await page.setViewportSize({ width: 600, height: 800 });
  await idle();
  assert.equal((await snapshot()).parts[0].from, from, 'resize retains a source character anchor');
  assert.equal(await page.locator('.reader-screen:not([inert]) .reader-paper').getAttribute('data-columns'), '1');

  await page.evaluate(async () => {
    const { ReaderSource } = await import('/src/utils/reader-source.ts');
    const source = new ReaderSource('<a href="https://example.com"><strong>abcdef</strong></a>');
    const html = source.html(2, 5);
    if (!html.includes('<strong>cde</strong>') || !html.includes('<a ')) throw Error('slicing lost link or formatting');
    const media = new ReaderSource('<img src="https://fixture.test/unread-source-image.png">');
    if (!media.html(0, 1).includes('src=')) throw Error('source serialization lost media');
    const unicode = new ReaderSource('a😀b');
    if (unicode.safeOffset(2) !== 1 || unicode.safeOffset(2, true) !== 3) throw Error('split surrogate pair');
    const cluster = new ReaderSource('a👨‍👩‍👧‍👦b');
    if (cluster.safeOffset(4) !== 1 || cluster.safeOffset(4, true) !== 12) throw Error('split emoji grapheme cluster');
    const { ReaderPaginator, readerGeometry } = await import('/src/utils/reader-layout.ts');
    const posts = [{ id: 0, author_id: 1 }, { id: 1, author_id: 1 }];
    const font = getComputedStyle(document.documentElement).fontFamily;
    const g = { ...readerGeometry(200, 120, font), columns: 1, top: 0, bottom: 0, inset: 0, gutter: 0,
      columnWidth: 200, fontSize: 20, lineHeight: 30 };
    const orphan = new ReaderSource('一'.repeat(30) + '\n' + '二'.repeat(20));
    const orphanLayout = new ReaderPaginator(() => posts, () => orphan, () => undefined);
    const first = orphanLayout.page({ post: 1, offset: 0 }, g, '');
    if (first.end.offset !== 31) throw Error('a two-line paragraph was split into one-line orphans');
    const widow = new ReaderSource('一'.repeat(50));
    const widowLayout = new ReaderPaginator(() => posts, () => widow, () => undefined);
    const page = widowLayout.page({ post: 1, offset: 0 }, g, '');
    if (page.end.offset !== 30) throw Error('a one-line paragraph widow escaped onto the next page');
    const recovered = widowLayout.page(page.start, g, '', page.end);
    if (recovered.parts[0].html !== page.parts[0].html) throw Error('checkpoint changed the rendered lines or justification');
  });
  await page.evaluate(() => {
    const f = window.fixture;
    f.loads = 0;
    f.handler = () => {
      f.state.loading = true;
      setTimeout(() => {
        f.state.posts.push({ id: 90000 + f.loads, author_id: 1, floor: f.loads + 1, content: [{ type: 0, text: '新增短楼' }] });
        f.state.loading = false;
      }, 50);
    };
    f.state.posts = [{ id: 90000, author_id: 1, floor: 1, content: [{ type: 0, text: '首楼' }] }];
    f.state.hasMore = true;
  });
  await idle(); await delay(350); await idle();
  assert.equal((await snapshot()).loads, 1, 'appending a short API page must not recursively prefetch');
  await delay(350);
  assert.equal((await snapshot()).loads, 1);
  await page.evaluate(() => {
    const f = window.fixture;
    f.state.hasMore = false;
    f.state.posts = [{ id: 91000, author_id: 1, floor: 1, content: [
      { type: 0, text: '图片之前\n' }, { type: 3, bigCdnSrc: 'https://fixture.test/tall.svg' }, { type: 0, text: '\n图片之后' },
    ] }];
  });
  await idle(); await delay(250); await idle();
  // A tall image may move to the next screen once its real aspect ratio is known.
  const image = page.locator('.reader-screen img').first();
  assert.ok(await image.evaluate(element => element.complete && element.getBoundingClientRect().height <= 736));
  if (!await page.locator('.reader-screen:not([inert]) img').count()) {
    await page.locator('.thread-reader').focus(); await page.keyboard.press('ArrowRight'); await idle();
  }
  assert.equal(await page.locator('.reader-screen:not([inert]) img').count(), 1);
  assert.ok((await snapshot()).screens <= 3);
  assert.equal(unreadFetches, 0, 'inert source preparation and serialization must not download unread images');
  await page.setViewportSize({ width: 1200, height: 800 }); await idle();
  await page.evaluate(() => {
    const f = window.fixture;
    f.state.hasMore = false;
    f.state.posts = [{ id: 95000, author_id: 1, floor: 1, content: [
      { type: 3, bigCdnSrc: 'https://fixture.test/reading-card.svg', width: 600, height: 1000 },
      { type: 0, text: ('正文与 <strong>加粗文字</strong>、<span style="font-weight:500">中等粗细</span>、<em>italic</em> 应当正确换行。\n').repeat(100) },
      { type: 1, text: '链接文字', link: 'https://example.com' },
    ] }];
  });
  await idle(); await delay(180);
  const originalImage = await page.locator('.reader-screen:not([inert]) .reader-media').first().boundingBox();
  await page.mouse.move(600, 780);
  await page.getByRole('button', { name: '大小', exact: true }).click();
  const sizePanel = page.getByRole('region', { name: '阅读大小', exact: true });
  await sizePanel.waitFor();
  assert.equal(await sizePanel.locator('.range-track').count(), 3, 'size options must reuse the custom drawn sliders');
  const setSlider = async (name, value) => {
    await sizePanel.getByRole('slider', { name, exact: true }).evaluate((element, value) => {
      element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await delay(80); await idle();
  };
  await setSlider('图片大小', 200);
  const largerImage = await page.locator('.reader-screen:not([inert]) .reader-media').first().boundingBox();
  assert.ok(Math.abs(largerImage.height - originalImage.height * 2) < 1 && Math.abs(largerImage.width - originalImage.width * 2) < 1,
    'image size must update both rendering and pagination boxes');
  await setSlider('字体大小', 28);
  await setSlider('字体粗细', 600);
  const weights = await page.locator('.reader-screen:not([inert]) .reader-paper').evaluate(element => ({
    size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight,
    strong: getComputedStyle(element.querySelector('strong')).fontWeight,
    styled: getComputedStyle(element.querySelector('.reader-line span[style*="font-weight"]')).fontWeight,
  }));
  assert.deepEqual(weights, { size: '28px', weight: '600', strong: '900', styled: '700' });
  assert.ok((await inspectSpread()).overflow < 1.5, 'changed font metrics must match actual rich-text rendering');
  await sizePanel.getByRole('slider', { name: '字体大小', exact: true }).evaluate(element => {
    for (let size = 14; size <= 32; size++) { element.value = String(size); element.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await delay(100); await idle();
  assert.equal(await page.locator('.reader-screen:not([inert]) .reader-paper').evaluate(e => getComputedStyle(e).fontSize), '32px');
  assert.ok((await inspectSpread()).overflow < 1.5);
  await sizePanel.getByRole('slider', { name: '字体大小', exact: true }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await sizePanel.count(), 0, 'Escape closes size options before exiting the reader');
  assert.equal(await page.locator('.thread-reader').count(), 1);
  await page.locator('.thread-reader').focus(); await page.keyboard.press('ArrowRight'); await idle();
  const sizeAnchor = (await snapshot()).parts[0].from;
  assert.ok(sizeAnchor > 0);
  await page.mouse.move(600, 780);
  await page.getByRole('button', { name: '大小', exact: true }).click();
  await setSlider('字体大小', 20); await setSlider('字体粗细', 400); await setSlider('图片大小', 100);
  assert.equal((await snapshot()).parts[0].from, sizeAnchor, 'size changes must retain the source-character reading anchor');
  await page.setViewportSize({ width: 390, height: 720 }); await idle(); await delay(60);
  const popupBox = await sizePanel.boundingBox();
  assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= 390 && popupBox.y >= 0,
    'size popup must fit a narrow pane');
  await sizePanel.getByRole('slider', { name: '字体大小', exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await delay(80); await idle();
  assert.equal(await page.locator('.reader-screen:not([inert]) .reader-paper').evaluate(e => getComputedStyle(e).fontSize), '21px');
  assert.equal((await snapshot()).parts[0].from, sizeAnchor, 'slider arrow keys must not turn reading pages');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1200, height: 800 }); await idle();
  console.log('Passed: custom size sliders, matching font weights/measurement, image scaling, rapid updates, anchored reflow and narrow panes.');
  assert.deepEqual(errors, []);
  const motion = await page.evaluate(() => { window.readerMotion.running = false; return window.readerMotion.shifts; });
  assert.deepEqual(motion, [], 'pagination and rebuilding must not expose horizontal jumps between frames');
  console.log('Passed: bounded initial parsing/DOM, distant jump, long-floor continuity, backward regeneration, resize, safe HTML slicing, capped prefetch, delayed media.');
} finally {
  await browser?.close();
  server?.kill();
}
