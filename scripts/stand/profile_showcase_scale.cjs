/** Синтетический каталог: 5000 карточек, медленные миниатюры, без записи на сервер. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const access = JSON.parse(fs.readFileSync(process.env.PLATFORM_ACCESS_FILE, 'utf8'));
  const production = new URL(access.url).origin;
  const origin = process.env.PROFILE_WEB_URL || production;
  const count = 5000;
  const digest = n => n.toString(16).padStart(64, '0');
  const cards = Array.from({ length: count }, (_, i) => ({
    id: 100000 + i, name: `Scale ${i + 1}`, number: 1, saved_at: '2026-11-02T10:00:00Z',
    views: { front: digest(i * 2 + 1), back: digest(i * 2 + 2) },
    drops: [], drop_ids: [], audience: 'boys', category: 'Худи', status: i === count - 1 ? 'approved' : 'draft',
    others_drafts: [], agenda: [], mine: false, my_draft: false, executor: null,
  }));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(production + '/**', route => route.continue({ headers: { ...route.request().headers(), ...access.headers } }));
  await context.route(origin + '/platform/api/core/**', route => route.fulfill({ json:
    route.request().url().includes('/sections') ? ['references', 'texts'].map(code => ({ code, name: code === 'texts' ? 'Тексты' : 'Референсы', actions: ['view'], functions: [], children: [] }))
      : route.request().url().includes('/applications') ? [{ code: 'reference', name: 'Референс', home: 'references' }]
      : { id: 'scale-fixture', display_name: 'Scale fixture', external: false }
  }));
  let imageRequests = 0;
  let pageRequests = 0, legacyRequests = 0, orderReads = 0;
  let failNext = true;
  let ownIds = cards.map(card => card.id);
  const writes = [];
  await context.route(origin + '/reference/api/**', async route => {
    const url = new URL(route.request().url());
    const filtered = () => {
      let result = url.searchParams.get('sort') === 'own' ? ownIds.map(id => cards[id - 100000]) : cards;
      if (url.searchParams.has('status')) result = result.filter(card => card.status === url.searchParams.get('status'));
      if (url.searchParams.has('q')) result = result.filter(card => card.name === url.searchParams.get('q'));
      if (url.searchParams.get('only_mine') === 'true') result = [];
      return result.map(card => ({ ...card, my_position: ownIds.indexOf(card.id), reasons: ['Scale 5000'] }));
    };
    if (url.pathname.endsWith('/references/page')) {
      pageRequests++;
      const offset = Number(url.searchParams.get('cursor') || 0);
      if (offset && failNext) return route.fulfill({ status: 503, json: { detail: 'Synthetic failure' } });
      await new Promise(resolve => setTimeout(resolve, offset ? 80 : 600));
      const result = filtered(), end = offset + Number(url.searchParams.get('limit'));
      return route.fulfill({ json: { items: result.slice(offset, end), total: result.length, next_cursor: end < result.length ? String(end) : null } });
    }
    if (url.pathname.endsWith('/references/order')) {
      if (route.request().method() === 'PUT') {
        ownIds = route.request().postDataJSON().ids;
        writes.push([...ownIds]);
        return route.fulfill({ status: 204 });
      }
      orderReads++;
      return route.fulfill({ json: filtered().map(card => card.id) });
    }
    if (url.pathname.endsWith('/references')) { legacyRequests++; return route.fulfill({ status: 500 }); }
    if (url.pathname.endsWith('/library/texts')) {
      await new Promise(resolve => setTimeout(resolve, 900));
      return route.fulfill({ json: [] });
    }
    if (url.pathname.includes('/assets/')) {
      imageRequests++;
      const key = url.pathname.split('/').at(-2);
      await new Promise(resolve => setTimeout(resolve, parseInt(key.slice(-2), 16) % 2 ? 250 : 1600));
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="20" y="5" width="60" height="90" fill="silver"/></svg>' });
    }
    return route.fulfill({ json: url.pathname.endsWith('/plm/status') ? { configured: false, reachable: false } : [] });
  });
  const page = await context.newPage();
  await page.goto(origin + '/reference/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('status').filter({ hasText: 'Получаем список референсов' }).waitFor();
  await page.locator('[data-card-id]').first().waitFor();
  const mounted = await page.locator('[data-card-id]').count();
  await page.getByText('Загружено 60 из 5000', { exact: true }).waitFor();
  if (pageRequests !== 1 || orderReads || legacyRequests) throw new Error('First screen read the full catalogue');
  console.log(JSON.stringify({ syntheticCards: count, firstPage: 60, mounted, imageRequests, pageRequests, orderReads, legacyRequests }));
  if (mounted > 80) throw new Error('Thousands of cards mounted in DOM: ' + mounted);
  await page.getByRole('progressbar', { name: 'Миниатюры на экране' }).waitFor();
  await page.waitForFunction(() => {
    const value = Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'));
    return value > 0 && value < 100;
  });
  console.log(JSON.stringify({ partialProgress: await page.getByRole('progressbar').getAttribute('aria-valuenow') }));
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'scale-loading.png') });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-card-id] img')].filter(img => {
    const r = img.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;
  }).every(img => img.complete && img.naturalWidth > 0));
  // Следующая порция падает: прежние карточки остаются, повтор явный.
  await page.locator('[data-card-id="100000"]').click({ modifiers: ['Control'] });
  await page.locator('[data-card-id]').first().evaluate(el => {
    let scroller = el.parentElement;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.getByRole('button', { name: 'повторить дозагрузку', exact: true }).waitFor();
  await page.getByText('Загружено 60 из 5000', { exact: true }).waitFor();
  failNext = false;
  await page.getByRole('button', { name: 'повторить дозагрузку', exact: true }).click();
  await page.getByText('Загружено 120 из 5000', { exact: true }).waitFor();
  if (await page.locator('[data-card-id]').count() > 80) throw new Error('DOM grew after scrolling');
  const last = page.locator('[data-card-id]').last();
  const lastId = await last.getAttribute('data-card-id');
  await last.focus();
  await last.press('ArrowUp');
  await page.waitForFunction(before => {
    const id = document.activeElement?.getAttribute('data-card-id'); return id && id !== before;
  }, lastId, { timeout: 2000 });
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'scale-end.png') });
  await page.getByRole('button', { name: 'снять выделение', exact: true }).waitFor();
  console.log(JSON.stringify({ secondPage: 120, failedPageRetained: true, retry: true, keyboard: true, mountedAfterPaging: await page.locator('[data-card-id]').count(), imageRequests }));
  await page.getByRole('combobox', { name: 'статус', exact: true }).selectOption('approved');
  await page.locator('[data-card-id="104999"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-card-id]').length === 1);
  await page.getByRole('combobox', { name: 'статус', exact: true }).selectOption('');
  await page.getByRole('textbox', { name: 'поиск по картинкам и надписям референсов' }).fill('Scale 5000');
  await page.waitForFunction(() => document.querySelectorAll('[data-card-id]').length === 1);
  if (!await page.locator('[data-card-id="104999"]').count()) throw new Error('Search lost offscreen record');
  console.log(JSON.stringify({ filtersSeeLastCard: true, searchSeesLastCard: true }));
  // Один явный перенос запрашивает номера всего каталога, не его содержимое.
  await page.getByRole('textbox', { name: 'поиск по картинкам и надписям референсов' }).fill('');
  await page.getByText('Загружено 120 из 5000', { exact: true }).waitFor();
  await page.evaluate(() => { const main = document.querySelector('main'); for (let el = main; el; el = el.parentElement) el.scrollTop = 0; window.scrollTo(0, 0); });
  await page.getByRole('button', { name: 'переместить №100000', exact: true }).click();
  await page.getByRole('button', { name: 'в конец', exact: true }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'own');
  await page.getByText('Загружено 60 из 5000', { exact: true }).waitFor();
  if (writes.length !== 1 || writes[0].length !== count || writes[0].at(-1) !== 100000 || new Set(writes[0]).size !== count) throw new Error('Move lost unloaded cards');
  await page.locator('main').last().click({ position: { x: 5, y: 5 } });
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/references/order')),
    page.keyboard.press('Control+z'),
  ]);
  if (writes.length !== 2 || writes[1][0] !== 100000 || writes[1].length !== count) throw new Error('Undo lost full order');
  console.log(JSON.stringify({ globalMove: true, undo: true, orderReads, fullOrderCount: writes[0].length }));
  await page.getByRole('link', { name: 'Тексты', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Получаем надписи' }).waitFor();
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'texts-spinner.png') });
  await page.getByText('Надписей пока нет:', { exact: false }).waitFor();
  console.log(JSON.stringify({ textsSpinner: true }));
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
})().catch(error => { console.error(error.message.replace(/(?:pfb_|pfc_)\S+/g, '[credential]')); process.exit(1); });
