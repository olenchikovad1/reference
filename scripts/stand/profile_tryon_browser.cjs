/** Принты → живая примерка PLM → одна карточка. Записи только в локальный стенд. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const api = 'http://127.0.0.1:5185/reference/api';
  const output = process.env.PROFILE_OUTPUT;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const who = 'qa-tryon-' + Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'X-Stand-As': who } });
  await context.addInitScript(id => localStorage.setItem('reference.stand-as', id), who);
  const created = [];
  const call = async (method, suffix, data) => {
    let r = await context.request[method](api + suffix, { data, timeout: 15000 });
    if (method === 'get' && r.status() === 503) {
      console.log('Read-only source retry after 503: ' + suffix);
      r = await context.request.get(api + suffix, { timeout: 15000 });
    }
    assert(r.ok(), `${method} ${suffix}: ${r.status()} ${(await r.text()).slice(0, 180)}`);
    return r.status() === 204 ? null : r.json();
  };
  try {
    const selected = JSON.parse(fs.readFileSync(path.join(output, 'plm-family-source.json'), 'utf8')).selected;
    assert(selected?.anchor?.product_code, 'Run the real catalogue audit first');
    await call('put', '/people/' + who, { full_name: 'QA TryOn', role: 'chief' });
    await call('put', '/plm/product-links', { style_code: selected.anchor.style_code, product_code: selected.anchor.product_code });
    // Тестовое S3 сменное: восстанавливаем известный принт штатной загрузкой,
    // не доверяя старой метаинформации базы о наличии байтов.
    const fixtureName = 'teddy-bear-toy.png';
    const uploaded = await context.request.post(api + '/assets', { multipart: {
      files: { name: fixtureName, mimeType: 'image/png', buffer: fs.readFileSync(path.join(__dirname, '../../infra/stand/files/prints', fixtureName)) },
    } });
    assert(uploaded.ok(), 'Local print fixture upload: ' + uploaded.status());
    const uploadedAsset = (await uploaded.json())[0];
    const library = await call('get', '/assets/library');
    const item = library.find(i => i.digest === uploadedAsset.digest);
    assert(item, 'The isolated local library must contain at least one print');
    const original = await context.request.get(api + `/assets/${item.digest}/preview`);
    assert(original.ok(), 'Selected local print preview is unavailable');
    const imageBytes = await original.body();
    const before = await call('get', '/references/page?limit=1');
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    let failFrame = true;
    await page.route('**/products/*/states/front/frame', route => {
      if (failFrame) { failFrame = false; return route.fulfill({ status: 503, body: 'fixture frame failure' }); }
      return route.continue();
    });
    let posts = 0;
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/reference/api/references') posts++; });
    await page.goto('http://127.0.0.1:5184/reference/prints', { waitUntil: 'domcontentloaded' });
    const tile = page.locator(`button:has(img[src*="${item.digest}/thumb"])`);
    await tile.first().click();
    const viewer = page.getByRole('dialog', { name: 'картинка ' + (item.name?.name || item.file_name), exact: true });
    let firstTry = true;
    const openTryOn = async () => {
      await viewer.getByRole('button', { name: 'примерить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Примерить принт', exact: true });
      await dialog.getByLabel('дроп примерки').selectOption(selected.drop);
      const choice = dialog.getByRole('button', { name: new RegExp('^примерить ' + selected.anchor.article.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ·') }).first();
      await choice.click();
      const retry = dialog.getByRole('button', { name: 'повторить кадр', exact: true });
      if (firstTry) {
        await retry.waitFor();
        assert(await dialog.getByRole('button', { name: 'сделать референс', exact: true }).isDisabled());
        await retry.click();
        firstTry = false;
      }
      await dialog.getByRole('button', { name: 'сделать референс', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'сделать референс' && !b.disabled));
      await dialog.locator('canvas').first().waitFor();
      return dialog;
    };
    let dialog = await openTryOn();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await viewer.waitFor();
    await page.unroute('**/products/*/states/front/frame');
    assert.equal(posts, 0, 'Preview must not create references');
    assert.equal((await call('get', '/references/page?limit=1')).total, before.total);
    dialog = await openTryOn();
    await page.screenshot({ path: path.join(output, 'tryon-before-save.png') });
    const savedResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/reference/api/references');
    await dialog.getByRole('button', { name: 'сделать референс', exact: true }).click();
    const response = await savedResponse;
    assert(response.ok(), 'Explicit save failed: ' + response.status());
    const saved = await response.json(); created.push(saved.id);
    await page.getByRole('dialog', { name: /рабочее окно/ }).first().locator('canvas').first().waitFor();
    assert.equal(posts, 1);
    const detail = await call('get', '/references/' + saved.id);
    const work = detail.work;
    assert.equal(work.plm.colorwayId, selected.anchor.id);
    assert.equal(work.plm.dropCode, selected.drop);
    assert.equal(work.plm.productCode, selected.anchor.product_code);
    const product = await call('get', '/products/' + selected.anchor.product_code);
    assert.equal(work.size, product.size_grid?.base ?? product.rendered_size ?? product.rendered_size_assumed ?? null);
    const element = work.composition.elements[0];
    assert.equal(element.placement.widthCm, 18); assert.equal(element.placement.dyCm, 12); assert.equal(element.placement.anchor, 'neck');
    assert.equal(element.src.includes(item.digest), true);
    const preview = uploadedAsset.derivatives.find(d => d.name === 'preview');
    assert.equal(element.aspect, preview.width / preview.height);
    assert.equal((await call('get', '/references/page?limit=1')).total, before.total + 1);
    assert(detail.executor_id === who || detail.executor?.id === who, 'Creator must be assigned as executor');
    const family = await call('get', `/references/${saved.id}/plm-family`);
    assert.equal(family.drop_code, selected.drop);
    const afterItem = (await call('get', '/assets/library')).find(i => i.digest === item.digest);
    for (const field of ['file_name', 'name', 'kind', 'tags', 'defect']) assert.deepEqual(afterItem[field], item[field]);
    const afterImage = await context.request.get(api + `/assets/${item.digest}/preview`);
    assert.deepEqual(await afterImage.body(), imageBytes);
    await page.screenshot({ path: path.join(output, 'tryon-saved-work.png') });
    console.log(JSON.stringify({ localWritesOnly: true, livePlm: true, previewPosts: 0, explicitSavePosts: posts, reference: saved.id, print: item.file_name, baseSize: work.size, placementCm: element.placement, aspect: element.aspect, sourceUnchanged: true }));
  } finally {
    for (const id of created) {
      try { await call('post', `/references/${id}/trash`); }
      catch (e) { console.error('Local cleanup: ' + id + ' ' + e.message); process.exitCode = 1; }
    }
    await browser.close();
  }
})().catch(e => { console.error(e.stack); process.exit(1); });
