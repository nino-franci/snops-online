const { test, expect } = require('@playwright/test');

async function createRoom(page, name = 'Ana') {
  await page.goto('/');
  await page.getByLabel('Tvoje ime').fill(name);
  await page.getByRole('button', { name: 'Ustvari sobo' }).click();
  await expect(page.getByText(/Igralci\s+1\/4/)).toBeVisible();
}

test('mobile landing and invitation visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile visual baseline');
  await page.goto('/');
  await expect(page).toHaveScreenshot('landing-create-mobile.png', { fullPage: true });
  await page.getByRole('button', { name: 'Pridruži se', exact: true }).click();
  await expect(page).toHaveScreenshot('landing-join-mobile.png', { fullPage: true });
  await page.goto('/?room=ABCDE');
  await expect(page.getByText('Povabljen si v sobo')).toBeVisible();
  await expect(page.getByLabel('Tvoje ime')).toBeFocused();
  await expect(page).toHaveScreenshot('landing-invitation-mobile.png', { fullPage: true });
});

test('lobby and searchable rules visual baselines', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile visual baseline');
  await createRoom(page);
  await expect(page).toHaveScreenshot('lobby-host-mobile.png', { fullPage: true });
  await page.getByRole('button', { name: 'Odpri pravila' }).click();
  await page.getByLabel('Poišči pravilo').fill('kontra');
  await expect(page.locator('#rulesList details:not(.hidden)')).toHaveCount(1);
  await expect(page).toHaveScreenshot('rules-search-mobile.png', { fullPage: true });
});

test('controls remain usable with 200 percent text', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.getByLabel('Tvoje ime')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ustvari sobo' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('landmarks and controls expose screen-reader names', async ({ page }) => {
  await page.goto('/?room=ABCDE');
  await expect(page.getByRole('heading', { name: 'Nimate kart? Ni problema.' })).toBeVisible();
  await expect(page.locator('[role="group"][aria-label="Način vstopa"]')).toBeAttached();
  await expect(page.locator('[data-landing-mode="join"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Povabljen si v sobo' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeAttached();
});

test('landscape and reduced viewport emulate an open keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?room=ABCDE');
  const name = page.getByLabel('Tvoje ime');
  await name.fill('Ana');
  await page.setViewportSize({ width: 844, height: 260 });
  await name.focus();
  await expect(name).toBeFocused();
  await expect.poll(async () => {
    const box = await name.boundingBox();
    return box.y >= 0 && box.y + box.height <= 260;
  }).toBe(true);
  await expect(page.getByRole('button', { name: /Vstopi v sobo ABCDE/ })).toBeAttached();
});

test('measure the create-room user flow', async ({ page }, testInfo) => {
  const startedAt = Date.now();
  await page.goto('/');
  const landingReadyMs = Date.now() - startedAt;
  await page.getByLabel('Tvoje ime').fill('Meritev');
  const actionAt = Date.now();
  await page.getByRole('button', { name: 'Ustvari sobo' }).click();
  await expect(page.getByText(/Igralci\s+1\/4/)).toBeVisible();
  const metrics = { landingReadyMs, createRoomMs: Date.now() - actionAt, totalFlowMs: Date.now() - startedAt };
  expect(metrics.landingReadyMs).toBeLessThan(5_000);
  expect(metrics.createRoomMs).toBeLessThan(5_000);
  console.log(`[flow-metrics:${testInfo.project.name}] ${JSON.stringify(metrics)}`);
  await testInfo.attach('flow-metrics.json', { body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: 'application/json' });
});
