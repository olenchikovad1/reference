/** Изолированная локальная семья с живым чтением PLM; production только GET. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const web = 'http://127.0.0.1:5184', api = 'http://127.0.0.1:5185/reference/api';
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const who = 'qa-family-' + Date.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'X-Stand-As': who } });
  await context.addInitScript(id => localStorage.setItem('reference.stand-as', id), who);
  const created = [];
  const request = async (method, url, data) => {
    const r = await context.request[method](url, { data, timeout: 15000 });
    assert(r.ok(), `${method} ${new URL(url).pathname}: ${r.status()} ${(await r.text()).slice(0, 150)}`);
    return r.status() === 204 ? null : r.json();
  };
  const call = (method, suffix, data) => request(method, api + suffix, data);
  try {
    const snapshotAt = process.argv.indexOf('--snapshot-reference');
    if (snapshotAt >= 0) {
      const ref = Number(process.argv[snapshotAt + 1]); assert(Number.isInteger(ref) && ref > 0);
      const page = await context.newPage();
      await page.goto(web + '/reference/references?family=' + ref, { waitUntil: 'domcontentloaded' });
      await page.getByRole('dialog', { name: /Семейство/ }).locator('[data-family-colour]').first().waitFor();
      await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-family-dialog.png') });
      return;
    }
    // Тонкая связь берётся из реально выпущенного каталога; фикстура не придумывает соответствия.
    const audit = JSON.parse(fs.readFileSync(path.join(process.env.PROFILE_OUTPUT, 'plm-audit.json'), 'utf8').replace(/^\uFEFF/, ''));
    const source = audit.working_sample;
    const links = new Map(source.map(c => [c.style_code, c.product_code]));
    for (const [style_code, product_code] of links) await call('put', '/plm/product-links', { style_code, product_code });
    const drops = (await call('get', '/plm/drops')).items;
    const sourceFile = path.join(process.env.PROFILE_OUTPUT, 'plm-family-source.json');
    const previous = fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : null;
    // Само создание/чтение семьи заново проверяет членство через живой PLM.
    let selected = process.argv.includes('--refresh-source') ? null : previous?.selected;
    const checked = [];
    for (const drop of drops) {
      if (selected) break;
      let rows;
      try { rows = (await call('get', '/plm/colorways?drop=' + encodeURIComponent(drop.code))).items; }
      catch (error) {
        checked.push({ drop: drop.code, error: error.message });
        if (checked.filter(item => item.error).length >= 2) break;
        continue;
      }
      const working = rows.filter(c => c.can_work);
      checked.push({ drop: drop.code, total: rows.length, working: working.length });
      const candidate = working.find(c => working.filter(other => other.style_id === c.style_id).length >= 2);
      if (candidate) { selected = { drop: drop.code, anchor: candidate, rows: working.filter(c => c.style_id === candidate.style_id) }; break; }
    }
    const output = { sourceSample: source.length, checked, selected: selected || null };
    fs.writeFileSync(path.join(process.env.PROFILE_OUTPUT, 'plm-family-source.json'), JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ sourceSample: source.length, checked, selected: selected ? { drop: selected.drop, model: selected.anchor.style_code, colours: selected.rows.length } : null }));
    if (process.argv.includes('--inspect')) return;
    assert(selected, 'No calibrated model with at least two colours found in the real drop catalogue');
    await call('put', '/people/' + who, { full_name: 'QA Family', role: 'chief' });
    const palette = (await call('get', '/colours')).colors;
    const label = selected.anchor.color || selected.anchor.base_color || '';
    const pantone = palette.find(c => label === c.code || label === c.name || label.startsWith(c.code + ' '));
    const work = { version: 2, stateCode: 'front', colourCode: pantone?.code || label, size: null,
      plm: { colorwayId: selected.anchor.id, productCode: selected.anchor.product_code, dropCode: selected.drop },
      composition: { elements: [], selectedId: null } };
    const ref = (await call('post', '/references', { name: 'QA shared family', sheet_digest: 'f'.repeat(64), image_digests: [], texts: [], work })).id;
    created.push(ref);
    const before = await call('get', '/references/' + ref);
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    await page.goto(web + '/reference/references?family=' + ref, { waitUntil: 'domcontentloaded' });
    const family = page.getByRole('dialog', { name: /Семейство/ });
    const tiles = family.locator('[data-family-colour]');
    await tiles.nth(1).waitFor();
    await family.getByRole('button', { name: 'исключить цвет', exact: true }).first().click();
    await family.getByRole('button', { name: 'вернуть цвет', exact: true }).first().waitFor();
    await family.getByRole('button', { name: 'вернуть цвет', exact: true }).first().click();
    await family.getByRole('button', { name: 'вернуть цвет', exact: true }).waitFor({ state: 'hidden' });
    await tiles.first().focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    const editor = page.getByRole('dialog', { name: /рабочее окно/ }).first();
    await editor.locator('canvas').first().waitFor();
    await editor.getByRole('button', { name: '+ надпись', exact: true }).click();
    const versionSaved = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/references/${ref}/versions`) && r.request().method() === 'POST', { timeout: 30000 });
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert((await versionSaved).ok(), 'Shared save failed');
    const after = await call('get', '/references/' + ref);
    assert.equal(after.versions.length, before.versions.length + 1);
    assert.equal(after.work.composition.elements.length, 1);
    // HTTP завершился раньше keep(): горячая клавиша во время saving верно игнорируется.
    await editor.getByText(`версия ${after.number} из ${after.number}`, { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Сохранить' && !b.disabled));
    const copied = page.waitForResponse(r => new URL(r.url()).pathname === '/reference/api/references' && r.request().method() === 'POST', { timeout: 30000 });
    await page.keyboard.press('Control+Shift+S');
    const forkResponse = await copied; assert(forkResponse.ok(), 'Save as failed');
    const fork = (await forkResponse.json()).id; created.push(fork);
    assert.notEqual(fork, ref);
    const forked = await call('get', '/references/' + fork);
    assert.equal(forked.versions.length, 1);
    assert.equal(forked.forked_from.reference_id, ref);
    assert.equal((await call('get', '/references/' + ref)).versions.length, after.versions.length);
    await page.goto(web + '/reference/references?family=' + ref, { waitUntil: 'domcontentloaded' });
    await family.locator('[data-family-colour]').first().click();
    await editor.getByText(`версия ${after.number} из ${after.number}`, { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await family.waitFor();
    await page.keyboard.press('Escape'); await family.waitFor({ state: 'hidden' });
    assert(!new URL(page.url()).searchParams.has('family'));
    await call('post', `/references/${ref}/reject`, { comment: 'QA: whole family' });
    assert.equal((await call('get', '/references/' + ref)).status, 'rejected');
    await call('post', `/references/${ref}/revive`, { comment: 'QA: keep versions' });
    const restored = await call('get', '/references/' + ref);
    assert.notEqual(restored.status, 'rejected');
    assert.equal(restored.versions.length, after.versions.length);
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'plm-family-local.png') });
    console.log(JSON.stringify({ realPlmReads: true, localWritesOnly: true, sharedReference: ref, variant: fork,
      colours: selected.rows.length, excludedAndRestored: true, sharedEdit: true, saveAs: true, keyboard: true, rejectedAndRevived: true }));
  } finally {
    for (const id of created) {
      try { await call('post', `/references/${id}/trash`); }
      catch { console.error('Local fixture cleanup failed: ' + id); process.exitCode = 1; }
    }
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
