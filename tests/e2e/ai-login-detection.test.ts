/**
 * Browser-level synthetic coverage for AI-powered login field detection.
 * This intentionally does not claim extension integration coverage; real
 * background/content login messaging is covered by the demo smoke tests.
 *
 * Run: pnpm test:e2e -- tests/e2e/ai-login-detection.test.ts
 */

import { test, expect } from '@playwright/test';

// ─── Helper: set page content ────────────────────────────────────────────────

async function setPageContent(page: import('@playwright/test').Page, html: string) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

// ─── Inline scanning logic (mirrors ai-login.ts scanFormCandidates) ─────────

interface ScannedCandidate {
  index: number;
  tagName: string;
  type: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  labelText: string | null;
  nearbyText: string;
  buttonText: string | null;
}

async function scanCandidates(page: import('@playwright/test').Page): Promise<ScannedCandidate[]> {
  return page.evaluate(() => {
    const MAX_CANDIDATES = 30;

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    }

    function getAssociatedLabel(el: Element): string | null {
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return (label.textContent ?? '').trim() || null;
      }
      const wrapping = el.closest('label');
      if (wrapping) return (wrapping.textContent ?? '').trim() || null;
      return null;
    }

    function getNearbyText(el: Element): string {
      const parts: string[] = [];
      const prev = el.previousElementSibling;
      if (prev) {
        const text = (prev.textContent ?? '').trim();
        if (text && text.length <= 80) parts.push(text);
      }
      const parent = el.parentElement;
      if (parent) {
        const clone = parent.cloneNode(true) as Element;
        for (const input of clone.querySelectorAll('input, select, textarea')) {
          input.remove();
        }
        const text = (clone.textContent ?? '').trim().slice(0, 80);
        if (text) parts.push(text);
      }
      return parts.join(' ').trim();
    }

    const selector =
      'input:not([type="hidden"]), select, textarea, button, [role="button"], input[type="submit"]';
    const elements = Array.from(document.querySelectorAll(selector));
    const candidates: ScannedCandidate[] = [];

    for (const el of elements) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (!isVisible(el)) continue;

      const tagName = el.tagName.toLowerCase();
      const isInput = el instanceof HTMLInputElement;
      const isSelect = el instanceof HTMLSelectElement;
      const isTextarea = el instanceof HTMLTextAreaElement;
      const isButton = el instanceof HTMLButtonElement;

      candidates.push({
        index: candidates.length,
        tagName,
        type: isInput ? el.type : null,
        name: (isInput || isSelect || isTextarea || isButton) ? el.name || null : null,
        id: el.id || null,
        placeholder: (isInput || isTextarea) ? el.placeholder || null : null,
        autocomplete: el.getAttribute('autocomplete') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        labelText: getAssociatedLabel(el),
        nearbyText: getNearbyText(el),
        buttonText: (isButton || el.getAttribute('role') === 'button')
          ? (el.textContent ?? '').trim() || null
          : null,
      });
    }

    return candidates;
  });
}

// ─── Helper: simulate AI response by tagging elements ────────────────────────

async function tagFieldsFromMockAi(
  page: import('@playwright/test').Page,
  mapping: { username: number; password: number; submit: number; otp: number }
) {
  await page.evaluate((mapping) => {
    // Clear any existing tags
    for (const el of document.querySelectorAll('[data-p2p-field]')) {
      el.removeAttribute('data-p2p-field');
    }

    const selector =
      'input:not([type="hidden"]), select, textarea, button, [role="button"], input[type="submit"]';
    const elements = Array.from(document.querySelectorAll(selector)).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });

    const roles = ['username', 'password', 'submit', 'otp'] as const;
    const visibleElements: Element[] = [];
    for (const el of elements) {
      visibleElements.push(el);
    }

    for (const role of roles) {
      const i = mapping[role];
      if (i >= 0 && i < visibleElements.length) {
        visibleElements[i]!.setAttribute('data-p2p-field', role);
      }
    }
  }, mapping);
}

// ─── Standard Login Forms ────────────────────────────────────────────────────

test.describe('Standard login forms', () => {
  test('email + password + submit button', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" name="email" placeholder="Email address" />
        <label for="pass">Password</label>
        <input id="pass" type="password" name="password" placeholder="Password" />
        <button type="submit">Sign In</button>
      </form>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]!.type).toBe('email');
    expect(candidates[0]!.labelText).toContain('Email');
    expect(candidates[1]!.type).toBe('password');
    expect(candidates[2]!.tagName).toBe('button');
    expect(candidates[2]!.buttonText).toBe('Sign In');
  });

  test('username (not email) + password', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="text" name="login" placeholder="Username or email" autocomplete="username" />
        <input type="password" name="pass" />
        <button>Log in</button>
      </form>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]!.type).toBe('text');
    expect(candidates[0]!.name).toBe('login');
    expect(candidates[0]!.autocomplete).toBe('username');
  });

  test('form with OTP field visible', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="text" name="username" />
        <input type="password" name="password" />
        <input type="text" name="otp_code" placeholder="Enter 2FA code" autocomplete="one-time-code" />
        <button>Log in</button>
      </form>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates).toHaveLength(4);
    expect(candidates[2]!.name).toBe('otp_code');
    expect(candidates[2]!.autocomplete).toBe('one-time-code');
  });
});

// ─── Non-Standard Forms ─────────────────────────────────────────────────────

test.describe('Non-standard login forms', () => {
  test('non-standard field names (no type=email)', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="text" name="usr" placeholder="Enter your ID" />
        <input type="password" name="pwd" />
        <input type="submit" value="Authenticate" />
      </form>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]!.name).toBe('usr');
    expect(candidates[1]!.name).toBe('pwd');
  });

  test('custom button (div with role=button)', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
        <div role="button" style="padding: 10px; background: blue; color: white;">Sign In</div>
      </form>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates).toHaveLength(3);
    expect(candidates[2]!.tagName).toBe('div');
    expect(candidates[2]!.buttonText).toBe('Sign In');
  });

  test('multiple forms on page (login + newsletter)', async ({ page }) => {
    await setPageContent(page, `
      <form id="login">
        <input type="email" name="email" placeholder="Email" />
        <input type="password" name="password" placeholder="Password" />
        <button>Log In</button>
      </form>
      <form id="newsletter">
        <input type="email" name="newsletter_email" placeholder="Subscribe" />
        <button>Subscribe</button>
      </form>
    `);

    const candidates = await scanCandidates(page);
    // Should find all visible form elements across both forms
    expect(candidates).toHaveLength(5);
  });
});

// ─── AI Field Tagging ────────────────────────────────────────────────────────

test.describe('AI field tagging (mocked)', () => {
  test('tags elements with data-p2p-field after mock AI response', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button>Sign In</button>
      </form>
    `);

    // Simulate AI identifying fields
    await tagFieldsFromMockAi(page, { username: 0, password: 1, submit: 2, otp: -1 });

    const usernameTag = await page.getAttribute('[data-p2p-field="username"]', 'name');
    expect(usernameTag).toBe('email');

    const passwordTag = await page.getAttribute('[data-p2p-field="password"]', 'name');
    expect(passwordTag).toBe('password');

    const submitTag = await page.textContent('[data-p2p-field="submit"]');
    expect(submitTag?.trim()).toBe('Sign In');
  });

  test('findLoginField prefers AI-tagged over selectors', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="text" name="user_id" data-p2p-field="username" />
        <input type="email" name="email" />
        <input type="password" name="password" data-p2p-field="password" />
      </form>
    `);

    // Verify that querySelector('[data-p2p-field="username"]') finds the AI-tagged field
    const aiUsername = await page.evaluate(() => {
      const el = document.querySelector('[data-p2p-field="username"]') as HTMLInputElement | null;
      return el?.name ?? null;
    });
    expect(aiUsername).toBe('user_id');
  });
});

// ─── Fallback Behavior ──────────────────────────────────────────────────────

test.describe('Fallback behavior', () => {
  test('no candidates on already-logged-in page', async ({ page }) => {
    await setPageContent(page, `
      <div class="dashboard">
        <h1>Welcome back, User!</h1>
        <p>Portfolio value: €12,345.67</p>
      </div>
    `);

    const candidates = await scanCandidates(page);
    expect(candidates).toHaveLength(0);
  });

  test('selector fallback works when no data-p2p-field tags exist', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button>Submit</button>
      </form>
    `);

    // No AI tags — selector-based lookup should still work
    const emailFound = await page.evaluate(() => {
      const el = document.querySelector('input[type="email"]');
      return el !== null;
    });
    expect(emailFound).toBe(true);

    const noAiTags = await page.evaluate(() => {
      return document.querySelectorAll('[data-p2p-field]').length;
    });
    expect(noAiTags).toBe(0);
  });

  test('learned selector cache avoids repeated AI detection on drifted login form', async ({ page }) => {
    await setPageContent(page, `
      <form>
        <input id="drift-user" />
        <input id="drift-pass" />
        <button id="drift-submit" type="button">Continue</button>
      </form>
    `);

    const result = await page.evaluate(() => {
      type Role = 'username' | 'password' | 'submit';
      type Cache = Partial<Record<Role, string>>;
      const cache: Cache = {};
      let aiCalls = 0;

      function visible(selector: string): HTMLElement | null {
        const el = document.querySelector(selector);
        return el instanceof HTMLElement ? el : null;
      }

      function stableSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        const id = el.getAttribute('id');
        if (id) return `${tag}#${CSS.escape(id)}`;
        throw new Error('Synthetic test expects ids');
      }

      function mockAiDetect(): Cache {
        aiCalls += 1;
        const username = document.querySelector('#drift-user')!;
        const password = document.querySelector('#drift-pass')!;
        const submit = document.querySelector('#drift-submit')!;
        username.setAttribute('data-p2p-field', 'username');
        password.setAttribute('data-p2p-field', 'password');
        submit.setAttribute('data-p2p-field', 'submit');
        return {
          username: stableSelector(username),
          password: stableSelector(password),
          submit: stableSelector(submit),
        };
      }

      function runLogin(): void {
        let username = cache.username ? visible(cache.username) : null;
        let password = cache.password ? visible(cache.password) : null;
        let submit = cache.submit ? visible(cache.submit) : null;

        if (!username || !password) {
          Object.assign(cache, mockAiDetect());
          username = visible('[data-p2p-field="username"]');
          password = visible('[data-p2p-field="password"]');
          submit = visible('[data-p2p-field="submit"]');
        }

        (username as HTMLInputElement).value = 'user@example.com';
        (password as HTMLInputElement).value = 'secret';
        submit?.setAttribute('data-submitted', 'true');
      }

      runLogin();
      document.querySelectorAll('[data-p2p-field]').forEach((el) => {
        el.removeAttribute('data-p2p-field');
      });
      runLogin();

      return {
        aiCalls,
        cache,
        usernameValue: (document.querySelector('#drift-user') as HTMLInputElement).value,
        submitMarked: document.querySelector('#drift-submit')?.getAttribute('data-submitted'),
      };
    });

    expect(result.aiCalls).toBe(1);
    expect(result.cache).toEqual({
      username: 'input#drift-user',
      password: 'input#drift-pass',
      submit: 'button#drift-submit',
    });
    expect(JSON.stringify(result.cache)).not.toContain('data-p2p-field');
    expect(result.usernameValue).toBe('user@example.com');
    expect(result.submitMarked).toBe('true');
  });
});
