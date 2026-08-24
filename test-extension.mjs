import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, 'dist');
const screenshotDir = path.resolve(__dirname, 'screenshots');

fs.mkdirSync(screenshotDir, { recursive: true });

// Collect console errors from all pages
const consoleErrors = [];

async function run() {
  console.log('Launching Chromium with extension from:', distPath);

  // Create a temporary user data dir
  const userDataDir = path.resolve(__dirname, '.test-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,  // Extensions require headed mode in Chromium
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  // Listen for console errors on all pages
  context.on('page', (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({ url: page.url(), text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push({ url: page.url(), text: err.message });
    });
  });

  // Wait for the service worker to be registered
  console.log('Waiting for service worker...');

  // Log existing service workers
  console.log('Existing service workers:', context.serviceWorkers().map(sw => sw.url()));

  let serviceWorker;
  // The service worker might already be available or we need to wait
  if (context.serviceWorkers().length > 0) {
    serviceWorker = context.serviceWorkers()[0];
  } else {
    // Try navigating to a page first to trigger extension load
    const initPage = context.pages()[0] || await context.newPage();
    await initPage.goto('about:blank');
    await initPage.waitForTimeout(2000);

    console.log('Service workers after wait:', context.serviceWorkers().map(sw => sw.url()));

    if (context.serviceWorkers().length > 0) {
      serviceWorker = context.serviceWorkers()[0];
    } else {
      // Try waiting a bit more
      try {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
      } catch (e) {
        console.log('No service worker found. Trying to find extension ID via chrome://extensions...');

        // Try to get the extension ID by listing background targets
        // Or try a known pattern - navigate to chrome-extension pages
        // As a fallback, check the user data dir for extension info
        const extensionsDir = path.join(userDataDir, 'Default', 'Extensions');
        if (fs.existsSync(extensionsDir)) {
          const extDirs = fs.readdirSync(extensionsDir);
          console.log('Extensions in profile:', extDirs);
        }

        // Try loading chrome://extensions to check for errors
        await initPage.goto('chrome://extensions', { timeout: 10000 }).catch(() => {});
        await initPage.waitForTimeout(2000);
        const extScreenshot = path.join(screenshotDir, 'extensions-page.png');
        await initPage.screenshot({ path: extScreenshot, fullPage: true });
        console.log('Extensions page screenshot saved to:', extScreenshot);

        throw new Error('Service worker did not load. The extension may have errors. Check extensions-page.png');
      }
    }
  }

  // Extract extension ID from the service worker URL
  // Service worker URL looks like: chrome-extension://[extensionId]/src/background/index.js
  const swUrl = serviceWorker.url();
  console.log('Service worker URL:', swUrl);
  const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
  if (!extensionId) {
    throw new Error('Could not extract extension ID from service worker URL: ' + swUrl);
  }
  console.log('Extension ID:', extensionId);

  // --- Test Popup ---
  console.log('\n--- Testing Popup ---');
  const popupPage = await context.newPage();
  popupPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: popupPage.url(), text: msg.text() });
    }
  });
  popupPage.on('pageerror', (err) => {
    consoleErrors.push({ url: popupPage.url(), text: err.message });
  });

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  console.log('Navigating to:', popupUrl);
  await popupPage.goto(popupUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await popupPage.waitForTimeout(1000); // Give React time to render

  // Set a fixed viewport for popup (typical extension popup size)
  await popupPage.setViewportSize({ width: 400, height: 600 });
  await popupPage.waitForTimeout(500);

  const popupScreenshot = path.join(screenshotDir, 'popup.png');
  await popupPage.screenshot({ path: popupScreenshot, fullPage: true });
  console.log('Popup screenshot saved to:', popupScreenshot);

  // Log popup content
  const popupTitle = await popupPage.title();
  const popupBodyText = await popupPage.locator('body').innerText().catch(() => '(empty)');
  console.log('Popup title:', popupTitle);
  console.log('Popup body text (first 500 chars):', popupBodyText.slice(0, 500));

  // --- Test Dashboard ---
  console.log('\n--- Testing Dashboard ---');
  const dashboardPage = await context.newPage();
  dashboardPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: dashboardPage.url(), text: msg.text() });
    }
  });
  dashboardPage.on('pageerror', (err) => {
    consoleErrors.push({ url: dashboardPage.url(), text: err.message });
  });

  const dashboardUrl = `chrome-extension://${extensionId}/dashboard.html`;
  console.log('Navigating to:', dashboardUrl);
  await dashboardPage.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await dashboardPage.waitForTimeout(1000); // Give React time to render

  await dashboardPage.setViewportSize({ width: 1280, height: 900 });
  await dashboardPage.waitForTimeout(500);

  const dashboardScreenshot = path.join(screenshotDir, 'dashboard.png');
  await dashboardPage.screenshot({ path: dashboardScreenshot, fullPage: true });
  console.log('Dashboard screenshot saved to:', dashboardScreenshot);

  // Log dashboard content
  const dashTitle = await dashboardPage.title();
  const dashBodyText = await dashboardPage.locator('body').innerText().catch(() => '(empty)');
  console.log('Dashboard title:', dashTitle);
  console.log('Dashboard body text (first 500 chars):', dashBodyText.slice(0, 500));

  // --- Report console errors ---
  console.log('\n--- Console Errors ---');
  if (consoleErrors.length === 0) {
    console.log('No console errors detected.');
  } else {
    console.log(`Found ${consoleErrors.length} console error(s):`);
    for (const err of consoleErrors) {
      console.log(`  [${err.url}] ${err.text}`);
    }
  }

  // Cleanup
  await context.close();

  // Remove temp user data dir
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('\nDone! Screenshots saved to:', screenshotDir);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
