// Реальные ракурсы PLM → единый холст → локальные версии. Запись только loopback.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const web = process.env.PROFILE_WEB || 'http://127.0.0.1:5184';
  const api = process.env.PROFILE_API || 'http://127.0.0.1:5185/reference/api';
  for (const url of [web, api]) assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Local writes only');
  const output = process.env.PROFILE_OUTPUT;
  assert(output, 'PROFILE_OUTPUT required');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const who = 'qa-common-canvas-' + Date.now();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { 'X-Stand-As': who } });
  await context.addInitScript(value => localStorage.setItem('reference.stand-as', value), who);
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const ids = ['01M3MH7YCT9QSJP0MCWH0CPJB0', '01M3MH7YCNTYGXVK0DFNZ0KASB', '01M3MH7YD5CEHG8T3QCECRX16J'];
  if (process.argv.includes('--failure-only')) ids.splice(0, 2);
  const savedIds = [], results = [], consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  try {
    for (const id of ids) {
      const response = await context.request.get(`${api}/plm/colorways/${id}`);
      assert(response.ok(), 'Real passport unavailable');
      const passport = await response.json();
      const drop = passport.drop_code || 'AW-AUT-APP-08';
      const members = await (await context.request.get(`${api}/plm/colorways?drop=${drop}`)).json();
      assert(members.items.some(row => row.id === id), 'Real drop membership required');
      const row = members.items.find(row => row.id === id);
      const palette = await (await context.request.get(`${api}/colours`)).json();
      const label = row.color || row.base_color || 'WHITE';
      const colour = palette.colors.find(c => c.name === label || c.code === label || label.startsWith(c.code + ' '))?.code || label;
      const code = 'PLM-CANVAS-' + id;
      await page.goto(`${web}/reference/references/new?product=${code}&plm_colorway=${id}&plm_drop=${drop}&colour=${encodeURIComponent(colour)}`);
      const editor = page.getByRole('dialog', { name: /рабочее окно/ }).first();
      await editor.locator('[data-stage] canvas').first().waitFor();
      const adapter = await page.evaluate(async code => {
        const { fetchProduct } = await import('/reference/src/shared/api/products.ts');
        const product = await fetchProduct(code);
        return { space: product.coordinate_space, article: product.display_name,
          states: product.states.map(s => ({ code: s.code, width: s.frame.width, height: s.frame.height, key: s.frame.sha256, src: s.frame.src.slice(0, 30) })) };
      }, code);
      assert.equal(adapter.space, 'canvas');
      assert(adapter.states.every(s => s.width === 1024 && s.height === 1024 && s.src.startsWith('data:image/png;')));
      assert(!adapter.states.some(s => /GeneratedColoredImage/i.test(s.key)));
      await editor.getByRole('button', { name: '+ надпись', exact: true }).click();
      const placement = editor.getByLabel('настройки выбранного');
      const x = placement.getByLabel(/^от центра вбок/);
      await x.fill('7');
      await x.press('Tab');
      await placement.getByLabel(/^ширина/).fill('24');
      await placement.getByLabel(/^ширина/).press('Tab');
      assert.equal(await editor.getByRole('heading', { name: 'Размер', exact: true }).count(), 0);
      assert.equal(await editor.getByRole('heading', { name: 'Градация', exact: true }).count(), 0);
      assert.equal(await editor.getByRole('button', { name: 'лист на фабрику', exact: true }).count(), 0);
      const save = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/reference/api/references');
      await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
      const saved = await save;
      assert(saved.ok(), `Local save HTTP ${saved.status()}: ${(await saved.text()).slice(0, 200)}`);
      const cardId = (await saved.json()).id;
      savedIds.push(cardId);
      const full = await (await context.request.get(`${api}/references/${cardId}`)).json();
      assert.equal(full.work.version, 3);
      assert.equal(full.work.coordinateSpace, 'canvas');
      assert.equal(full.work.plm.colorwayId, id);
      assert.equal(full.work.colourCode, colour);
      assert(!JSON.stringify(full.work.composition).match(/Cm|BySize/));
      assert.equal(full.work.composition.elements[0].placement.x, 7);
      assert.equal(full.work.composition.elements[0].placement.width, 24);
      await page.goto(`${web}/reference/references/${cardId}`);
      await editor.getByText('версия 1 из 1', { exact: true }).waitFor();
      await editor.locator('[data-stage] canvas').first().waitFor();
      await editor.getByRole('button', { name: '«ЗИМА 2026»', exact: false }).first().click();
      assert.equal(await placement.getByLabel(/^от центра вбок/).inputValue(), '7');
      assert.equal(await placement.getByLabel(/^ширина/).inputValue(), '24');
      const frameCounts = await editor.locator('button[title]').evaluateAll(buttons => buttons.filter(b => /^(Перед|Спина|Слева|Справа|Ракурс)/.test(b.title)).length);
      await editor.getByLabel('виды изделия').locator('button[title^="Спина"]').click();
      await editor.getByRole('button', { name: '+ надпись', exact: true }).click();
      const nextVersion = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/reference/api/references/${cardId}/versions`);
      await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
      assert((await nextVersion).ok(), 'Back view version save');
      const second = await (await context.request.get(`${api}/references/${cardId}`)).json();
      assert.deepEqual(second.work.composition.elements.map(e => e.placement.side), ['front', 'back']);
      const first = await (await context.request.get(`${api}/references/${cardId}/versions/1`)).json();
      assert.deepEqual(first.work, full.work, 'First version must remain immutable');
      if (id === '01M3MH7YCT9QSJP0MCWH0CPJB0') {
        // Настоящий файл через пользовательский drop; исходники остаются в локальном S3.
        const file = path.join(__dirname, '../../infra/stand/files/prints/anime-chibi-squirrel.png');
        const bytes = fs.readFileSync(file).toString('base64');
        await editor.locator('[data-stage]').evaluate((element, base64) => {
          const data = new DataTransfer();
          data.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'canvas-print.png', { type: 'image/png' }));
          element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
        }, bytes);
        await editor.getByLabel('настройки выбранного').getByText('canvas-print.png', { exact: true }).waitFor();
        const imageVersion = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/reference/api/references/${cardId}/versions`);
        await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
        assert((await imageVersion).ok(), 'Raster print version save');
        const withImage = await (await context.request.get(`${api}/references/${cardId}`)).json();
        assert(withImage.work.composition.elements.some(e => e.kind === 'image' && e.src.includes('/preview')));
      }
      await page.screenshot({ path: path.join(output, `${id}.png`) });
      if (id === ids[ids.length - 1]) {
        const before = await (await context.request.get(`${api}/references/${cardId}`)).json();
        const passportUrl = `${web}/reference/api/plm/colorways/${id}`;
        await context.route(passportUrl, route => route.fulfill({ status: 503, json: { detail: 'Проверочный отказ PLM' } }));
        await page.goto(`${web}/reference/references/${cardId}`);
        await editor.getByRole('alert').filter({ hasText: 'Изделие не загрузилось' }).waitFor();
        await context.unroute(passportUrl);
        await editor.getByRole('button', { name: 'повторить загрузку', exact: true }).click();
        await editor.locator('[data-stage] canvas').first().waitFor();
        const after = await (await context.request.get(`${api}/references/${cardId}`)).json();
        assert.deepEqual(after.work, before.work, 'PLM failure and retry must preserve saved work');
      }
      results.push({ article: passport.article, id: cardId, sourceId: id, frames: adapter.states.length, fixedCanvas: true, savedPlacement: full.work.composition.elements[0].placement, frameCounts });
    }
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    console.log(JSON.stringify({ localWritesOnly: true, realPlmReads: true, results }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'error.png') });
    throw error;
  } finally {
    for (const id of savedIds) await context.request.post(`${api}/references/${id}/trash`);
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exit(1); });
