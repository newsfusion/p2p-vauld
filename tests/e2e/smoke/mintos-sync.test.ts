import { test, expect } from '../fixtures/extension.js';

const MINTOS_EMAIL = process.env.MINTOS_EMAIL;
const MINTOS_PASSWORD = process.env.MINTOS_PASSWORD;

test.describe('Mintos smoke test', () => {
  test('full sync imports real data', async ({ dashboardPage }) => {
    test.skip(
      !MINTOS_EMAIL || !MINTOS_PASSWORD,
      'MINTOS_EMAIL and MINTOS_PASSWORD must be set in .env'
    );

    const page = dashboardPage;

    // Step 1: Complete onboarding (invisible key)
    // OnboardingModal shows on first launch — click "Use Invisible Key"
    const invisibleKeyBtn = page.getByText('Use Invisible Key');
    await expect(invisibleKeyBtn).toBeVisible({ timeout: 10_000 });
    await invisibleKeyBtn.click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Wait for onboarding modal to disappear
    await expect(page.locator('.modal-overlay')).toBeHidden({ timeout: 10_000 });

    // Step 2: Navigate to Settings tab
    await page.getByRole('button', { name: 'Settings' }).click();

    // Step 3: Save Mintos credentials
    // Select Mintos in the searchable platform combobox
    const platformCombobox = page.getByRole('combobox', { name: 'Platform' });
    await platformCombobox.fill('Mint');
    await page.getByRole('option', { name: 'Mintos' }).click();

    // Fill email and password
    await page.locator('input[type="email"]').fill(MINTOS_EMAIL!);
    await page.locator('input[type="password"]').fill(MINTOS_PASSWORD!);

    // Click "Connect platform"
    await page.getByRole('button', { name: 'Connect platform' }).click();

    // Wait for success message
    await expect(page.getByText('Credentials saved securely.')).toBeVisible({ timeout: 10_000 });

    // Step 4: Navigate back to Portfolio (Overview) tab
    await page.getByRole('button', { name: 'Portfolio' }).click();

    // Step 5: Trigger sync
    await page.getByRole('button', { name: 'Refresh All' }).click();

    // Step 6: Wait for sync to complete
    // The sync opens a background tab, logs into Mintos, extracts data.
    // This can take up to 90 seconds. We wait for the Mintos row to show real data.
    // Poll for either: a portfolio value > €0, or a 2FA/error state.

    // Wait for either a monetary value or an error state to appear in the Mintos row
    const mintosRow = page.locator('tr', { has: page.getByText('Mintos') });

    // Wait for the "Never" text to disappear (replaced by a timestamp or error)
    await expect(mintosRow.getByText('Never')).toBeHidden({ timeout: 90_000 });

    // Step 7: Check for 2FA / captcha — skip gracefully if detected
    const manualActionRequired = mintosRow.getByText('Manual action required');
    const captchaRequired = mintosRow.getByText('Captcha required');
    const loginFailed = mintosRow.getByText('Login failed');

    if (await manualActionRequired.isVisible().catch(() => false)) {
      test.skip(true, 'Mintos requires 2FA — cannot complete automated sync');
      return;
    }
    if (await captchaRequired.isVisible().catch(() => false)) {
      test.skip(true, 'Mintos requires captcha — cannot complete automated sync');
      return;
    }
    if (await loginFailed.isVisible().catch(() => false)) {
      throw new Error('Mintos login failed — check credentials in .env');
    }

    // Step 8: Assert real data is present
    // The Mintos row should now show a portfolio value (€X,XXX.XX format)
    const valueCell = mintosRow.locator('td').nth(1);
    const valueText = await valueCell.textContent();
    expect(valueText).toBeTruthy();
    expect(valueText).toMatch(/€[\d,.]+/);

    // Extract numeric value and verify > 0
    const numericValue = parseFloat(valueText!.replace(/[€,\s]/g, ''));
    expect(numericValue).toBeGreaterThan(0);

    // Verify last sync timestamp is no longer "Never"
    const lastSyncCell = mintosRow.locator('td').nth(5);
    const lastSyncText = await lastSyncCell.textContent();
    expect(lastSyncText).not.toBe('Never');
    expect(lastSyncText).toBeTruthy();

    // Verify confidence badge exists
    const confidenceBadge = mintosRow.locator('td').nth(4).locator('span');
    await expect(confidenceBadge).toBeVisible();
  });
});
