/** Real browser performance evidence. Credentials stay on the operator's machine.
 * PLAYWRIGHT_MODULE points to installed Playwright, PLATFORM_ACCESS_FILE to local
 * access JSON. PROFILE_OUTPUT is a local directory for screenshots and timings.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const access = JSON.parse(fs.readFileSync(process.env.PLATFORM_ACCESS_FILE, 'utf8'));
  const productionOrigin = new URL(access.url).origin;
  const origin = process.env.PROFILE_WEB_URL || productionOrigin;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(productionOrigin + '/**', route => route.continue({ headers: { ...route.request().headers(), ...access.headers } }));
  if (origin !== productionOrigin) {
    await context.route(origin + '/reference/api/**', async route => {
      const url = new URL(route.request().url());
      try {
        const response = await route.fetch({ url: productionOrigin + url.pathname + url.search, headers: access.headers });
        await route.fulfill({ response });
      } catch (error) {
        // Playwright добавляет заголовки в текст ошибки: наружу только тип.
        if (!page.isClosed()) console.log(JSON.stringify({ requestInterrupted: url.pathname, kind: error.name }));
      }
    });
  }
  // MCP credentials cannot log into browser-only core /me. This optional shell
  // fixture isolates Reference performance; Reference requests still use the
  // real production gateway and its real authorization. No auth acceptance claim.
  if (process.env.PROFILE_SHELL_FIXTURE === '1') {
    const sections = [ ['references', 'Референсы'], ['texts', 'Тексты'], ['prints', 'Принты'] ]
      .map(([code, name]) => ({ code, name, actions: ['view'], functions: [], icon: 'grid', children: [] }));
    await context.route(origin + '/platform/api/core/**', route => {
      const url = new URL(route.request().url());
      const data = url.pathname.endsWith('/sections') ? sections
        : url.pathname.endsWith('/applications') ? [{ code: 'reference', name: 'Референс', icon: 'grid', home: 'references' }]
        : { id: 'performance-fixture', display_name: 'Performance check', email: '', organization: '', external: false, avatar: null };
      return route.fulfill({ json: data });
    });
  }
  const page = await context.newPage();
  const requests = [];
  const requested = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  page.on('requestfinished', request => requests.push({ url: new URL(request.url()).pathname,
    ms: Math.round(request.timing().responseEnd), bytes: request.sizes().catch(() => null) }));
  page.on('requestfailed', request => console.log(JSON.stringify({ failed: new URL(request.url()).pathname, error: request.failure()?.errorText })));
  page.on('response', response => {
    if (response.status() >= 400) console.log(JSON.stringify({ refused: new URL(response.url()).pathname, status: response.status() }));
  });
  const started = Date.now();
  await page.goto(origin + '/reference/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('[data-card-id]').first().waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ cardsMs: Date.now() - started, cards: await page.locator('[data-card]').count() }));
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-card] img')].filter(img => img.getBoundingClientRect().top < innerHeight);
    return images.length && images.every(img => img.complete && img.naturalWidth > 0);
  }, { timeout: 30000 });
  const visibleImagesMs = Date.now() - started;
  console.log(JSON.stringify({ visibleImagesMs }));
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'showcase.png') });
  const initialImages = requested.filter(url => url.includes('/assets/') && url.endsWith('/thumb')).length;
  const hiddenWindowRequests = requested.filter(url => url.endsWith('/colours') || url.endsWith('/prints') || url.includes('/states/'));
  const textsResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/library/texts'));
  await page.getByRole('link', { name: 'Тексты', exact: true }).click();
  const textStarted = Date.now();
  const texts = await textsResponse;
  if (!texts.ok()) throw new Error('Texts API failed: ' + texts.status());
  const textRows = await texts.json();
  if (textRows.length) await page.getByText(textRows[0].text, { exact: true }).first().waitFor();
  await page.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ textsMs: Date.now() - textStarted }));
  await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'texts.png') });
  const listRequestsBeforeReturn = requested.filter(url => /\/references(?:\/page)?$/.test(url)).length;
  await page.getByRole('link', { name: 'Референсы', exact: true }).click();
  await page.locator('[data-card-id]').first().waitFor();
  if (requested.filter(url => /\/references(?:\/page)?$/.test(url)).length !== listRequestsBeforeReturn) {
    throw new Error('Returning to the showcase unnecessarily reloaded the list');
  }
  const lastImage = page.locator('[data-card-id] img').last();
  await lastImage.scrollIntoViewIfNeeded();
  await lastImage.evaluate(img => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('Scrolled image timed out')), 15000);
  }));
  console.log(JSON.stringify({ scrollImageLoaded: true, cachedReturn: true }));
  if (process.env.PROFILE_CHECK_EDITOR === '1') {
    const card = page.locator('[data-card-id]').last();
    let cardId = await card.getAttribute('data-card-id');
    if (process.env.PROFILE_CHECK_PAGE_BOUNDARY === '1') {
      const first = await page.evaluate(() => fetch('/reference/api/references/page?limit=60&season=in').then(response => response.json()));
      if (first.items.length !== 60 || !first.next_cursor) throw new Error('Boundary check needs more than one page');
      cardId = String(first.items[59].id);
    }
    // Окно имеет прямой адрес; семейство цветов проверяется отдельным сценарием.
    await page.evaluate(id => {
      history.pushState({}, '', '/reference/references/' + id + location.search);
      dispatchEvent(new PopStateEvent('popstate'));
    }, cardId);
    const dialog = page.getByRole('dialog', { name: /рабочее окно/ }).first();
    await dialog.waitFor();
    try {
      await dialog.locator('canvas').first().waitFor({ timeout: 15000 });
    } catch (error) {
      await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'editor-error.png') });
      console.log((await dialog.innerText()).slice(0, 800));
      throw error;
    }
    await dialog.evaluate(el => el.dataset.performanceMarker = 'kept');
    if (process.env.PROFILE_CHECK_PAGE_BOUNDARY === '1') {
      const expected = await page.evaluate(async id => {
        const order = await fetch('/reference/api/references/order?season=in').then(response => response.json());
        return order[order.indexOf(Number(id)) + 1];
      }, cardId);
      await page.keyboard.press('d');
      await page.waitForURL(url => url.pathname.endsWith('/references/' + expected));
      await dialog.getByText('№' + expected, { exact: false }).first().waitFor();
      console.log(JSON.stringify({ pageBoundaryNavigation: true, from: cardId, to: expected }));
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const retained = await page.locator('[data-performance-marker="kept"]').count();
    if (retained !== 1) throw new Error('Closing the editor discarded its instance');
    console.log(JSON.stringify({ editorDirectLinkOpened: true, editorClosedByKeyboard: true, editorRetainedOnClose: true }));
  }
  if (process.env.PROFILE_CHECK_FILTERS === '1') {
    const sample = await page.evaluate(async () => {
      const data = await fetch('/reference/api/references/page?limit=60&season=in').then(response => response.json());
      return data.items.find(card => card.drop_ids.length && card.status);
    });
    if (!sample) throw new Error('Filter demonstration needs a reference linked to a drop');
    const filterUrl = origin + '/reference/references?drop=' + sample.drop_ids[0] + '&status=' + sample.status + '&season=in';
    await page.goto(filterUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-card-id]').first().waitFor();
    const linkedId = await page.locator('[data-card-id]').first().getAttribute('data-card-id');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-card-id="' + linkedId + '"]').waitFor();
    if (await page.getByRole('combobox', { name: 'статус', exact: true }).inputValue() !== sample.status) throw new Error('Status lost on linked view');
    if (await page.getByRole('combobox', { name: 'дроп', exact: true }).inputValue() !== String(sample.drop_ids[0])) throw new Error('Drop lost on linked view');
    await page.evaluate(id => {
      history.pushState({}, '', '/reference/references/' + id + location.search);
      dispatchEvent(new PopStateEvent('popstate'));
    }, linkedId);
    const editor = page.getByRole('dialog', { name: /рабочее окно/ }).first();
    await editor.locator('canvas').first().waitFor({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
    if (new URL(page.url()).searchParams.get('drop') !== String(sample.drop_ids[0])) throw new Error('Drop lost after editor close');
    await page.goto(origin + '/reference/references?category=__missing__&mine=1&drafts=1', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'сбросить отбор', exact: true }).click();
    await page.locator('[data-card-id]').first().waitFor();
    const cleared = new URL(page.url()).searchParams;
    if (cleared.has('category') || cleared.get('mine') !== '0' || cleared.get('drafts') !== '0') throw new Error('Empty view reset lost parameters');
    const library = await page.evaluate(() => fetch('/reference/api/assets/library').then(response => response.json()));
    const item = library.find(item => item.drops.length);
    if (!item) throw new Error('Print demonstration needs a print linked to a drop');
    const link = item.drops[0], decision = link.via !== null ? 'approved' : (link.status || 'proposed');
    await page.goto(origin + '/reference/prints?drop=' + link.id + '&decision=' + decision, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-tile="' + item.digest + '"]').waitFor();
    if (await page.getByRole('combobox', { name: 'решение в дропе', exact: true }).inputValue() !== decision) throw new Error('Print decision lost');
    const query = item.tags.find(tag => tag.strong)?.name;
    if (query) {
      await page.getByRole('textbox', { name: 'поиск по картинкам любым словом', exact: true }).fill(query);
      await page.waitForURL(url => url.searchParams.get('q') === query);
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (await page.getByRole('textbox', { name: 'поиск по картинкам любым словом', exact: true }).inputValue() !== query) throw new Error('Print search lost on reload');
    }
    console.log(JSON.stringify({ filterDrop: sample.drop_ids[0], filterStatus: sample.status, linkedViewReloaded: true,
      editorFiltersRetained: true, emptyReset: true, printDecision: decision, printDrop: link.id, printQueryRetained: !!query }));
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'print-filter.png') });
  }
  const result = await Promise.all(requests.map(async item => ({ ...item, bytes: await item.bytes })));
  fs.writeFileSync(path.join(process.env.PROFILE_OUTPUT, 'network.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.filter(item => item.url.includes('/api/') && !item.url.includes('/assets/'))));
  console.log(JSON.stringify({ imageRequests: result.filter(item => item.url.includes('/assets/') && item.url.endsWith('/thumb')).length }));
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
  console.log(JSON.stringify({ initialImages, hiddenWindowRequests }));
  if (process.env.PROFILE_ASSERT === '1') {
    if (initialImages > 80) throw new Error('Offscreen thumbnails exhausted initial request budget: ' + initialImages);
    if (hiddenWindowRequests.length) throw new Error('Closed work window loaded editor assets');
    if (visibleImagesMs > 8000) throw new Error('Visible images exceeded 8 second budget');
  }
})().catch(error => {
  console.error(error.message.replace(/(?:pfb_|pfc_)\S+/g, '[credential]'));
  process.exit(1);
});
