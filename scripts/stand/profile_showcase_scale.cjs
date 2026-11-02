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
  await context.route(origin + '/reference/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/references')) {
      await new Promise(resolve => setTimeout(resolve, 600));
      return route.fulfill({ json: cards });
    }
    if (url.pathname.endsWith('/references/find')) return route.fulfill({ json: [{ id: 104999, reasons: ['Scale 5000'] }] });
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
  console.log(JSON.stringify({ syntheticCards: count, mounted, imageRequests }));
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
  // Полная высота сохраняется без тысяч невидимых DOM-элементов.
  await page.locator('[data-card-id]').first().evaluate(el => {
    let scroller = el.parentElement;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.locator('[data-card-id="104999"]').waitFor();
  if (await page.locator('[data-card-id]').count() > 80) throw new Error('DOM grew after scrolling');
  const last = page.locator('[data-card-id="104999"]');
  await last.focus();
  await last.press('ArrowUp');
  await page.waitForFunction(() => {
    const id = document.activeElement?.getAttribute('data-card-id'); return id && id !== '104999';
  }, null, { timeout: 2000 });
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'scale-end.png') });
  console.log(JSON.stringify({ lastCardReachable: true, keyboard: true, mountedAtEnd: await page.locator('[data-card-id]').count(), imageRequests }));
  await page.getByRole('combobox', { name: 'статус', exact: true }).selectOption('approved');
  await page.locator('[data-card-id="104999"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-card-id]').length === 1);
  await page.getByRole('combobox', { name: 'статус', exact: true }).selectOption('');
  await page.getByRole('textbox', { name: 'поиск по картинкам и надписям референсов' }).fill('Scale 5000');
  await page.waitForFunction(() => document.querySelectorAll('[data-card-id]').length === 1);
  if (!await page.locator('[data-card-id="104999"]').count()) throw new Error('Search lost offscreen record');
  console.log(JSON.stringify({ filtersSeeLastCard: true, searchSeesLastCard: true }));
  await page.getByRole('link', { name: 'Тексты', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Получаем надписи' }).waitFor();
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'texts-spinner.png') });
  await page.getByText('Надписей пока нет:', { exact: false }).waitFor();
  console.log(JSON.stringify({ textsSpinner: true }));
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
})().catch(error => { console.error(error.message.replace(/(?:pfb_|pfc_)\S+/g, '[credential]')); process.exit(1); });
