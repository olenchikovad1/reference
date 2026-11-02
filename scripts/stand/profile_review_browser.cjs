/** Локальная демонстрация брака с настоящим API/БД/S3. Production запрещён. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const web = process.env.PROFILE_WEB_URL || 'http://127.0.0.1:5184';
  const api = process.env.PROFILE_API_URL || 'http://127.0.0.1:5185/reference/api';
  for (const value of [web, api]) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Local endpoints only');
  }
  const who = 'qa-review-' + Date.now();
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'X-Stand-As': who } });
  await context.addInitScript(id => localStorage.setItem('reference.stand-as', id), who);
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  const call = async (method, suffix, data) => {
    const response = await context.request[method](api + suffix, data === undefined ? {} : { data });
    if (!response.ok()) throw new Error(`${method} ${suffix}: ${response.status()} ${(await response.text()).slice(0, 400)}`);
    return response.status() === 204 ? null : response.json();
  };
  let id, page;
  try {
    await call('put', '/people/' + who, { full_name: 'QA Review', role: 'chief' });
    const upload = await context.request.post(api + '/assets', { multipart: { files: {
      name: 'qa-review.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(__dirname, '../../infra/stand/files/prints/rocket.png')),
    } } });
    if (!upload.ok()) throw new Error('Local upload failed: ' + upload.status());
    const digest = (await upload.json())[0].digest;
    const body = { name: 'QA Review ' + who, sheet_digest: digest, image_digests: [digest], texts: [], views: { front: digest, back: digest } };
    id = (await call('post', '/references', body)).id;
    await call('post', `/references/${id}/versions`, { ...body, name: body.name + ' v2' });
    const before = await call('get', '/references/' + id);
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(web + '/reference/references', { waitUntil: 'domcontentloaded' });
    const tile = page.locator(`[data-card-id="${id}"]`);
    await tile.waitFor();
    await tile.hover();
    await page.getByRole('button', { name: 'забраковать №' + id, exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Забраковать референс?', exact: true });
    await modal.waitFor();
    if (!await modal.getByRole('button', { name: 'забраковать', exact: true }).isDisabled()) throw new Error('Missing reason accepted');
    const reason = 'QA: брак с витрины';
    await modal.getByRole('textbox', { name: 'почему бракуете', exact: true }).fill(reason);
    // Только один сетевой отказ подменён; следующий POST идёт настоящему API.
    let fail = true;
    await page.route(`**/reference/api/references/${id}/reject`, route => {
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { detail: 'Проверочный сетевой отказ' } }); }
      return route.continue();
    });
    await modal.getByRole('button', { name: 'забраковать', exact: true }).click();
    await modal.getByRole('alert').waitFor();
    if (await modal.getByRole('textbox').inputValue() !== reason) throw new Error('Reason lost on failure');
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'reject-retry.png') });
    await modal.getByRole('button', { name: 'забраковать', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await tile.waitFor({ state: 'detached' });
    let saved = await call('get', '/references/' + id);
    if (saved.status !== 'rejected' || saved.versions.length !== before.versions.length) throw new Error('Gallery rejection changed versions');
    if ((await call('get', '/references/trash')).some(card => card.id === id)) throw new Error('Rejected card entered trash');
    await page.goto(web + '/reference/rejects', { waitUntil: 'domcontentloaded' });
    const row = page.getByRole('row').filter({ hasText: '№' + id });
    await row.getByText(reason, { exact: true }).waitFor();
    await call('put', '/people/' + who, { full_name: 'QA Review', role: 'editor' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await row.waitFor();
    if (await row.getByRole('button', { name: 'вернуть в работу', exact: true }).count()) throw new Error('Editor has revive control');
    const refused = await context.request.post(api + `/references/${id}/revive`, { data: { comment: 'QA: запрещённый возврат' } });
    if (refused.status() !== 403) throw new Error('Editor revived directly: ' + refused.status());
    await call('put', '/people/' + who, { full_name: 'QA Review', role: 'chief' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await row.getByRole('button', { name: 'вернуть в работу', exact: true }).click();
    const revive = page.getByRole('dialog', { name: 'Вернуть в работу?', exact: true });
    await revive.getByRole('textbox', { name: 'почему возвращаете', exact: true }).fill('QA: возврат с сохранением истории');
    await revive.getByRole('textbox').press('Enter');
    await revive.waitFor({ state: 'hidden' });
    await row.waitFor({ state: 'detached' });
    await page.goto(web + '/reference/references', { waitUntil: 'domcontentloaded' });
    await tile.waitFor();
    await page.evaluate(cardId => {
      history.pushState({}, '', '/reference/references/' + cardId + location.search);
      dispatchEvent(new PopStateEvent('popstate'));
    }, id);
    const editor = page.getByRole('dialog', { name: /рабочее окно/ }).first();
    await editor.locator('canvas').first().waitFor();
    await editor.locator('[data-status-toggle]').click();
    await editor.getByRole('button', { name: 'забраковать', exact: true }).click();
    await editor.getByRole('textbox', { name: 'почему бракуете', exact: true }).fill('QA: брак из рабочего окна');
    await Promise.all([
      page.waitForResponse(response => response.url().includes(`/references/${id}/reject`) && response.status() === 200),
      editor.getByRole('button', { name: 'забраковать', exact: true }).click(),
    ]);
    saved = await call('get', '/references/' + id);
    if (saved.status !== 'rejected' || saved.versions.length < before.versions.length) throw new Error('Window rejection lost history');
    if (!saved.status_events.some(event => event.comment === reason) || !saved.status_events.some(event => event.comment === 'QA: брак из рабочего окна')) throw new Error('Rejection reasons missing from history');
    await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'window-rejected.png') });
    console.log(JSON.stringify({ localOnly: true, id, galleryReject: true, reasonRetainedOnFailure: true, chiefRevive: true,
      editorRefused: true, windowReject: true, historyRetained: true, versionsBefore: before.versions.length, versionsAfter: saved.versions.length }));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(process.env.PROFILE_OUTPUT, 'review-error.png') });
    throw error;
  } finally {
    try { if (id) await call('post', `/references/${id}/trash`); }
    catch (error) { console.error(JSON.stringify({ cleanupFailed: id, error: error.message })); process.exitCode = 1; }
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
