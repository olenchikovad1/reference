/** Короткая локальная демонстрация паспорта с настоящими read-only ответами PLM.
 * Карточка семейства — явная браузерная фикстура сохранённой work.plm; записей нет.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const web = process.env.PROFILE_WEB_URL || 'http://127.0.0.1:5184';
  assert(['localhost', '127.0.0.1'].includes(new URL(web).hostname), 'Local browser only');
  const access = JSON.parse(fs.readFileSync(process.env.PLATFORM_ACCESS_FILE, 'utf8').replace(/^\uFEFF/, ''));
  const origin = new URL(access.url).origin;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  let page;
  try {
    const source = async suffix => {
      try {
        const response = await context.request.get(origin + '/reference/api/' + suffix, { headers: access.headers, timeout: 20000 });
        if (!response.ok()) throw new Error('HTTP ' + response.status());
        return await response.json();
      } catch { throw new Error('Source read failed: ' + suffix.split('?')[0]); }
    };
    const audited = JSON.parse(fs.readFileSync(process.env.PLM_AUDIT_FILE, 'utf8').replace(/^\uFEFF/, ''));
    const model = audited.working_sample[0];
    const passport = await source('plm/colorways/' + model.id);
    const status = await source('plm/status');
    const feed = await source('references/page?limit=1');
    const card = feed.items[0];
    assert(card, 'No reference for read-only fixture');
    const saved = await source('references/' + card.id);
    // Только представление локальной страницы: исходная production-карточка не меняется.
    const fixture = { ...saved, work: { ...(saved.work || {}), plm: { colorwayId: model.id } } };
    let reads = 0, fail = false, refresh = false;
    await context.route(web + '/reference/api/**', async route => {
      assert.equal(route.request().method(), 'GET', 'No mutation in this demonstration');
      const suffix = new URL(route.request().url()).pathname.replace('/reference/api/', '');
      let json;
      if (suffix === 'plm/status') json = status;
      else if (suffix === 'plm/colorways') json = { items: [model] };
      else if (suffix === 'plm/colorways/' + model.id) {
        reads++;
        if (fail) return route.fulfill({ status: 503, json: { detail: { message: 'Паспорт временно недоступен' } } });
        json = refresh ? { ...passport, brand: 'Локальная проверка обновления', readiness: { ...passport.readiness, patterns: undefined } } : passport;
      } else if (suffix === 'references/page') json = { ...feed, items: [{ ...card, views: {} }], total: 1, next_cursor: null };
      else if (suffix === 'references/order') json = [card.id];
      else if (suffix === 'references/' + card.id) json = fixture;
      else if (suffix === 'references/' + card.id + '/family') json = [];
      else if (suffix === 'colours') json = { source: 'plm', colors: [] };
      else if (suffix === 'plm/drops') json = { items: [] };
      else if (suffix === 'people') json = [];
      else if (suffix === 'people/me') json = { subject_id: 'local', full_name: 'Local', role: 'chief' };
      else if (suffix === 'catalogue' || suffix === 'drops') json = [];
      else return route.fulfill({ status: 404, json: { detail: 'Local passport fixture: endpoint unavailable' } });
      return route.fulfill({ json });
    });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto(web + '/reference/products', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'паспорт модели PLM', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Паспорт модели PLM', exact: true });
    await modal.getByLabel('Модель, артикул или цвет', { exact: true }).fill(model.style_code);
    const choose = modal.getByRole('button', { name: new RegExp(model.article) });
    await choose.focus(); await page.keyboard.press('Enter');
    const panel = modal.getByRole('region', { name: 'Паспорт PLM', exact: true });
    await panel.getByText(passport.size_range, { exact: true }).waitFor();
    await panel.getByText('список файлов не получен', { exact: false }).first().waitFor();
    const target = await panel.getByRole('link', { name: 'открыть в PLM' }).getAttribute('href');
    assert(target.endsWith(passport.plm_path));
    refresh = true;
    await panel.getByRole('button', { name: 'обновить паспорт', exact: true }).click();
    await panel.getByText('Локальная проверка обновления', { exact: true }).waitFor();
    await panel.getByText('не передано', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-passport-products.png') });
    fail = true;
    await panel.getByRole('button', { name: 'обновить паспорт', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    fail = false;
    await panel.getByRole('button', { name: 'обновить паспорт', exact: true }).click();
    await panel.getByText('Локальная проверка обновления', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
    await page.goto(web + '/reference/references?family=' + card.id, { waitUntil: 'domcontentloaded' });
    const family = page.getByRole('dialog', { name: /Семейство/ });
    await family.getByRole('button', { name: 'паспорт PLM', exact: true }).click();
    await family.getByRole('region', { name: 'Паспорт PLM', exact: true }).getByText(model.style_code + ' · ' + model.article, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-passport-family.png') });
    await page.keyboard.press('Escape'); await family.waitFor({ state: 'hidden' });
    console.log(JSON.stringify({ realPlmReads: true, localSavedReferenceFixture: true, writes: 0,
      colorway: model.id, productsPassport: true, familyPassport: true, refreshed: true, unavailableMarkVisible: true, retryAfter503: true, keyboard: true, passportReads: reads }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-passport-error.png') });
    throw error;
  } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close(); }
})().catch(error => { console.error(error.message); process.exit(1); });
