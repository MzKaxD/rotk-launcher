const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.FAIRPLAY_PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.FAIRPLAY_UI_BASE_URL || 'http://127.0.0.1:5177');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Use a local fixture server.');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.FAIRPLAY_CHROME_PATH ? { executablePath: process.env.FAIRPLAY_CHROME_PATH } : {}) });
  const errors = [], passed = [];
  try {
    for (const locale of ['en', 'fr']) {
      const context = await browser.newContext({ viewport: { width: 1080, height: 660 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
      await page.addInitScript(({ locale }) => {
        localStorage.setItem('rotk.launcher.locale', locale);
        const snapshot = {
          appVersion: '2.0.4', phase: 'ready', selection: { sourceRoot: null, destinationRoot: null, sourceKind: null, sourceDetected: false, destinationRecommended: false },
          installationRoot: 'QA game', updates: [], runtime: { serverId: 'game2', environment: 'production', label: 'ROTK', websiteOrigin: 'https://rotk.app', players: 1, capacity: 150,
            servers: [{ id: 'game2', label: 'ROTK', environment: 'production', websiteOrigin: 'https://rotk.app', players: 1, capacity: 150 }] },
          playerIdentity: { serverId: 'game2', role: 'player', configured: true, keys: { 'game2:player': 'a'.repeat(32), 'game2:admin': null, 'test:player': null, 'test:admin': null } },
          fairPlayTerms: { version: '2026-09-08.1', acceptedAt: null },
          launcherUpdate: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
          assetSync: { enabled: true, status: 'idle', packVersion: null, lastSyncAt: null, progress: null, warning: null },
          integrityCheck: null, progress: null, error: null, gamePid: null, updateRequired: false, canPlay: true,
        };
        let listener = () => {};
        window.__termsQa = { launches: [], links: [] };
        window.rotk = { getSnapshot: async () => snapshot, onSnapshot: callback => { listener = callback; return () => {}; }, setLocale: async () => {},
          play: async version => {
            if (!snapshot.fairPlayTerms.acceptedAt && version !== '2026-09-08.1') throw new Error('No explicit agreement');
            window.__termsQa.launches.push(version || 'remembered');
            snapshot.fairPlayTerms.acceptedAt = '2026-09-08T12:00:00.000Z';
            listener(structuredClone(snapshot)); return { ok: true, value: { pid: 42 } };
          }, openWebsite: async value => { window.__termsQa.links.push(value); return { ok: true }; }, minimizeWindow: async () => {}, closeWindow: async () => {} };
      }, { locale });
      await page.goto(base.href);
      const play = page.getByRole('button', { name: 'PLAY', exact: true });
      await play.click();
      const dialog = page.getByRole('dialog', { name: 'ROTK Anti-Cheat' });
      await dialog.waitFor();
      const accept = dialog.getByRole('button', { name: locale === 'fr' ? 'Accepter et jouer' : 'Accept and play', exact: true });
      assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
      assert.equal(await accept.isDisabled(), true);
      const box = await dialog.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 661);
      const buttonBox = await accept.boundingBox(); assert.ok(buttonBox.y + buttonBox.height <= 661, 'Acceptance controls stay visible');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.__termsQa.launches), []);
      assert.equal(await play.evaluate(element => element === document.activeElement), true);
      await play.click(); await dialog.getByRole('checkbox').check(); assert.equal(await accept.isDisabled(), false);
      if (process.env.FAIRPLAY_UI_OUTPUT_DIR) {
        await require('node:fs/promises').mkdir(process.env.FAIRPLAY_UI_OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.FAIRPLAY_UI_OUTPUT_DIR, `launcher-terms-${locale}.png`) });
      }
      await accept.click(); await dialog.waitFor({ state: 'hidden' });
      await play.click();
      assert.deepEqual(await page.evaluate(() => window.__termsQa.launches), ['2026-09-08.1', 'remembered']);
      await page.getByRole('button', { name: 'ROTK Anti-Cheat', exact: true }).click(); await dialog.waitFor();
      assert.equal(await dialog.getByRole('checkbox').count(), 0);
      await dialog.getByRole('button', { name: locale === 'fr' ? 'Politique de confidentialité complète' : 'Full privacy policy', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__termsQa.links), ['/privacy']);
      await page.keyboard.press('Escape');
      passed.push(`${locale}: unchecked explicit agreement, keyboard cancellation/focus, compact layout, remembered acceptance and review`);
      await context.close();
    }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ passed, pageErrors: errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
