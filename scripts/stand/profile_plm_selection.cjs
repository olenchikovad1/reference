/** Локальная работа с живым чтением PLM. Все записи — только loopback API. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const web = process.env.PROFILE_WEB_URL || 'http://127.0.0.1:5184';
  const api = process.env.PROFILE_API_URL || 'http://127.0.0.1:5185/reference/api';
  for (const endpoint of [web, api]) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local writes only');
  }
  const access = JSON.parse(fs.readFileSync(process.env.PLATFORM_ACCESS_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const source = new URL(access.url).origin;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page, id;
  const readSource = async suffix => {
    // Удалённый источник только читается; заголовки не передаются локальному API.
    try {
      const response = await context.request.get(source + '/reference/api/plm/' + suffix, { headers: access.headers, timeout: 20000 });
      if (!response.ok()) throw new Error('Source HTTP ' + response.status());
      return response;
    } catch (error) { throw new Error('PLM source read failed: ' + (error.message.startsWith('Source HTTP ') ? error.message : error.name)); }
  };
  try {
    const audited = process.env.PLM_AUDIT_FILE ? JSON.parse(fs.readFileSync(process.env.PLM_AUDIT_FILE, 'utf8').replace(/^\uFEFF/, '')) : null;
    const catalogue = audited ? [...audited.working_sample, ...audited.sample_colorways]
      : (await (await readSource('colorways')).json()).items;
    const working = catalogue.find(c => c.can_work && c.style_code === '2027');
    const pictured = catalogue.find(c => c.id === '01M3MH7YCT9QSJP0MCWH0CPJB0');
    assert(working && pictured, 'Real demonstration models absent');
    const passport = await (await readSource('colorways/' + working.id)).json();
    const drops = (await (await readSource('drops')).json()).items;
    const drop = passport.drop_code || drops[0].code;
    let refuseCatalogue = false;
    const imagePaths = [];
    let sourcePalette;
    await context.route(web + '/reference/api/colours', async route => {
      try {
        const response = await context.request.get(source + '/reference/api/colours', { headers: access.headers, timeout: 15000 });
        sourcePalette = await response.json();
        await route.fulfill({ response });
      } catch { await route.fulfill({ status: 503, json: { detail: 'Палитра PLM не ответила' } }); }
    });
    await context.route(web + '/reference/api/plm/**', async route => {
      const request = route.request();
      if (request.method() !== 'GET') throw new Error('Source writes forbidden');
      const url = new URL(request.url());
      const suffix = url.pathname.split('/reference/api/plm/')[1] + url.search;
      if (suffix.startsWith('colorways?')) {
        // Ограничиваем локальный показ двумя настоящими ЦМ, каталог в БД не копируем.
        return route.fulfill(refuseCatalogue ? { status: 503, json: { detail: 'Проверочный отказ PLM' } }
          : { json: { items: [pictured, working] } });
      }
      if (suffix.startsWith('images/')) imagePaths.push(suffix);
      try { await route.fulfill({ response: await readSource(suffix) }); }
      catch { if (!page?.isClosed()) await route.fulfill({ status: 503, json: { detail: 'PLM не ответил' } }); }
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(web + '/reference/references', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /новый референс/ }).first().click();
    const chooser = page.getByRole('dialog', { name: 'Новый референс', exact: true });
    await chooser.getByLabel('дроп plm', { exact: true }).selectOption(drop);
    const picture = chooser.getByRole('img', { name: pictured.style_code + ' · ' + pictured.article, exact: true });
    await chooser.getByText('PLM не передал изображение', { exact: true }).first().waitFor();
    const modelImage = await picture.count() > 0;
    assert(imagePaths.every(p => /\/(thumb|preview)$/.test(p)), 'Image preset boundary');
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-models.png') });
    await chooser.getByRole('button', { name: new RegExp(working.article) }).click();
    const editor = page.getByRole('dialog', { name: /рабочее окно/ }).first();
    await editor.locator('canvas').first().waitFor();
    await editor.getByRole('button', { name: '+ надпись', exact: true }).click();
    const saved = page.waitForResponse(r => r.url() === api.replace(':5185', ':5184') + '/references' && r.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await saved;
    assert(response.ok(), 'Local editor save failed');
    id = (await response.json()).id;
    const full = await (await context.request.get(api + '/references/' + id)).json();
    assert.deepStrictEqual(full.work.plm, { colorwayId: working.id, productCode: working.product_code, dropCode: drop });
    assert.equal(full.work.colourCode, sourcePalette.colors.find(c => c.name === working.color).code);
    // Голая ссылка не содержит PLM-параметров: связь обязана прийти из версии.
    await page.goto(web + '/reference/references/' + id, { waitUntil: 'domcontentloaded' });
    await editor.getByText('версия 1 из 1', { exact: true }).waitFor();
    // Рисунок холста уже виден раньше, чем отдельный alpha-hit-test готов.
    await page.evaluate(async code => {
      const frame = new Image();
      frame.src = `/reference/api/products/${code}/states/front/frame`;
      await frame.decode();
      await new Promise(requestAnimationFrame);
    }, working.product_code);
    const canvas = editor.locator('[data-stage] svg').first();
    const bounds = await canvas.boundingBox();
    await canvas.click({ position: { x: bounds.width * 0.45, y: bounds.height * 0.58 } });
    await editor.getByText('Паспорт PLM', { exact: true }).waitFor();
    await editor.getByText(working.style_code + ' · ' + working.article, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-restored.png') });
    refuseCatalogue = true;
    await page.goto(web + '/reference/references', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /новый референс/ }).first().click();
    await chooser.getByRole('alert').waitFor();
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-failure.png') });
    await page.keyboard.press('Escape');
    await chooser.waitFor({ state: 'hidden' });
    await page.locator(`[data-card-id="${id}"]`).click();
    await page.getByRole('button', { name: 'открыть сохранённую работу', exact: true }).click();
    await editor.getByText('версия 1 из 1', { exact: true }).waitFor();
    console.log(JSON.stringify({ localWritesOnly: true, realPlmReads: true, id, originalRequested: false,
      modelImage, imageContractIncomplete: !modelImage, savedExternalId: working.id, restoredFromBareLink: true,
      savedPantoneCode: full.work.colourCode, sourceFailureVisible: true, savedReferenceOpensDuringFailure: true, imagePaths }));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-error.png') });
    throw error;
  } finally {
    try { if (id) await context.request.post(api + '/references/' + id + '/trash'); }
    finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close(); }
  }
})().catch(error => { console.error(error.message); process.exit(1); });
