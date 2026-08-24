import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getFixtureFilename,
  getPlatformConfig,
  loadFixtureHtml,
  PLATFORM_IDS,
} from "./helpers/test-helpers.js";
import {
  scanFormCandidates,
  describeCandidate,
  buildFieldDetectionPrompt,
  parseFieldDetectionResponse,
} from "../../src/content/ai-login.js";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import { isLikelyLoggedIn } from "../../src/content/login.js";

// Mock isVisible since happy-dom doesn't compute element dimensions/layout
vi.mock("../../src/content/login.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    isVisible: () => true,
  };
});

describe("AI Login Pipeline with Real Data", () => {
  PLATFORM_IDS.forEach((platformId) => {
    describe(`Platform: ${platformId}`, () => {
      let document: Document;

      beforeEach(() => {
        // Load the real HTML login page for this platform
        const html = loadFixtureHtml("logins", getFixtureFilename(platformId));
        document = new DOMParser().parseFromString(html, "text/html");
      });

      it("scanFormCandidates should find the basic login inputs", () => {
        const candidates = scanFormCandidates(document);

        // Typical login page has at least username, password and a submit button
        expect(candidates.length).toBeGreaterThanOrEqual(2);

        // Ensure candidates have the expected structure
        candidates.forEach((c) => {
          expect(c).toHaveProperty("element");
          expect(typeof c.tagName).toBe("string");
        });

        // We expect at least one password candidate and one input or button for submit
        const hasPasswordInput = candidates.some(
          (c) => c.tagName.toLowerCase() === "input" && c.type === "password",
        );
        const hasEmailOrTextInput = candidates.some(
          (c) =>
            c.tagName.toLowerCase() === "input" &&
            (c.type === "email" || c.type === "text" || !c.type),
        );
        const hasButton = candidates.some(
          (c) =>
            c.tagName.toLowerCase() === "button" ||
            (c.tagName.toLowerCase() === "input" && c.type === "submit"),
        );

        // We log these for visibility during debugging, but don't strictly assert because some SPAs
        // might only render an empty shell until JS runs. For Mintos, Debitum, EstateGuru, it should pass.
        // For the ones we downloaded shells for (Triple Dragon, Income, PeerBerry), we appended form snippets.
        if (
          [
            "mintos",
            "debitum",
            "estateguru",
            "triple_dragon",
            "income_marketplace",
            "indemo",
            "peerberry",
          ].includes(platformId)
        ) {
          expect(hasPasswordInput).toBeTruthy();
          expect(hasEmailOrTextInput).toBeTruthy();
          expect(hasButton).toBeTruthy();
        }
      });

      it("describeCandidate should include important attributes", () => {
        const candidates = scanFormCandidates(document);

        candidates.forEach((c) => {
          const desc = describeCandidate(c);

          if (c.tagName.toLowerCase() === "input" && c.type) {
            expect(desc).toContain(`type=${c.type}`);
          }
          if (c.name) {
            expect(desc).toContain(`name=${c.name}`);
          }
        });
      });

      it("buildFieldDetectionPrompt should format candidates correctly", () => {
        const candidates = scanFormCandidates(document);
        const prompt = buildFieldDetectionPrompt(candidates);

        // Should contain instructions about identifying fields
        expect(prompt).toContain("Identify the login form fields.");

        // Should list out the candidates
        if (candidates.length > 0) {
          const firstCandidate = candidates[0]!;
          // The prompt should contain some identifying information about the first candidate
          // We can't guarantee 'selector' will always be present or unique enough for a simple include,
          // but tagName is always there.
          expect(prompt).toContain(firstCandidate.tagName.toLowerCase());
        }
      });

      it("parseFieldDetectionResponse should gracefully handle valid and invalid JSON", () => {
        const candidates = scanFormCandidates(document);

        // A perfectly valid response picking the first text and second password
        const passwordCand = candidates.find((c) => c.type === "password");
        const textCand = candidates.find(
          (c) => c.type === "email" || c.type === "text",
        );
        const submitCand = candidates.find(
          (c) => c.tagName.toLowerCase() === "button" || c.type === "submit",
        );

        // Create valid mock string representing the indexes instead of selectors
        if (textCand && passwordCand && submitCand) {
          const textIdx = candidates.indexOf(textCand);
          const passIdx = candidates.indexOf(passwordCand);
          const subIdx = candidates.indexOf(submitCand);
          const mockJsonStr = JSON.stringify({
            username: textIdx,
            password: passIdx,
            submit: subIdx,
            otp: -1,
          });

          const result = parseFieldDetectionResponse(
            mockJsonStr,
            candidates,
          ) as any;

          expect(Object.keys(result).length).toBeGreaterThan(0);
          expect(result.username).toBe(textCand.element);
          expect(result.password).toBe(passwordCand.element);
          expect(result.submit).toBe(submitCand.element);
        }

        // Test with invalid JSON / markdown code blocks
        if (textCand && passwordCand && submitCand) {
          const textIdx = candidates.indexOf(textCand);
          const passIdx = candidates.indexOf(passwordCand);
          // Only passing username and pass so it doesn't fail on missing required fields
          const markdownJson = `\`\`\`json\n{"username": ${textIdx}, "password": ${passIdx}}\n\`\`\``;

          // Markdown with code blocks fails parse unless we pre-strip it in our mock but the source doesn't strip
          // so it should return an error. Or did we strip it in the caller? `detectLoginFields` strips it, `parseFieldDetectionResponse` doesn't
          const result = parseFieldDetectionResponse(
            markdownJson,
            candidates,
          ) as { error: string };
          expect(result.error).toBe("invalid_json");
        }

        // Test with completely broken JSON
        const brokenResult = parseFieldDetectionResponse(
          "I think it is the first one",
          candidates,
        ) as { error: string };
        expect(brokenResult.error).toBe("invalid_json");
      });
    });
  });
});

describe("Debitum login selectors with fixture", () => {
  it("matches username, password and login submit button in debitum-investments.html", () => {
    const html = loadFixtureHtml("logins", "debitum-investments.html");
    const document = new DOMParser().parseFromString(html, "text/html");
    const login = getPlatformConfig("debitum").login;

    const usernameEl = document.querySelector(
      login.usernameSelectors[0]!,
    ) as HTMLInputElement | null;
    expect(usernameEl).not.toBeNull();
    expect(usernameEl?.name).toBe("email");

    const passwordEl = document.querySelector(
      login.passwordSelectors[0]!,
    ) as HTMLInputElement | null;
    expect(passwordEl).not.toBeNull();
    expect(passwordEl?.name).toBe("password");
    expect(passwordEl?.type).toBe("password");

    const submitEl = document.querySelector(
      login.submitSelectors[0]!,
    ) as HTMLButtonElement | null;
    expect(submitEl).not.toBeNull();
    expect(submitEl?.closest("form")).not.toBeNull();
    expect(submitEl?.textContent).toContain("Einloggen");
  });
});

describe("EstateGuru login selectors with fixture", () => {
  it("matches username, password and login submit button in estateguru-com.html", () => {
    // Fixture: tests/fixtures/logins/estateguru-com.html
    const html = loadFixtureHtml("logins", "estateguru-com.html");
    const document = new DOMParser().parseFromString(html, "text/html");
    const login = getPlatformConfig("estateguru").login;

    const usernameEl = document.querySelector(
      login.usernameSelectors[0]!,
    ) as HTMLInputElement | null;
    expect(usernameEl).not.toBeNull();
    expect(usernameEl?.name).toBe("username");

    const passwordEl = document.querySelector(
      login.passwordSelectors[0]!,
    ) as HTMLInputElement | null;
    expect(passwordEl).not.toBeNull();
    expect(passwordEl?.name).toBe("password");
    expect(passwordEl?.type).toBe("password");

    const submitEl = document.querySelector(
      login.submitSelectors[0]!,
    ) as HTMLButtonElement | null;
    expect(submitEl).not.toBeNull();
    expect(submitEl?.closest("form")).not.toBeNull();
    expect(submitEl?.textContent).toContain("Log in");
  });
});

describe("isLikelyLoggedIn with hidden inputs (Debitum regression)", () => {
  it("should return false when hidden login inputs are present", () => {
    // Mock a state where we have post-login indicators but ALSO hidden login fields
    document.body.innerHTML = `
      <form>
        <input name="email" type="email" hidden />
        <input name="password" type="password" hidden />
      </form>
      <div id="dashboard">Welcome to Dashboard</div>
    `;

    const postLoginIndicators = ["#dashboard"];
    const usernameSelectors = ["input[name='email']"];
    const passwordSelectors = ["input[name='password']"];

    const loggedIn = isLikelyLoggedIn(postLoginIndicators, {
      usernameSelectors,
      passwordSelectors,
    });

    // Should be false because hidden login inputs indicate we are on a login page (SPA transition)
    expect(loggedIn).toBe(false);
  });

  it("treats a visible logout trigger as a strong logged-in signal", () => {
    document.body.innerHTML = `
      <main>
        <a href="/logout">Log out</a>
        <section>Transfer money between accounts</section>
      </main>
    `;

    expect(isLikelyLoggedIn([])).toBe(true);
  });

  it("allows neutral post-submit pages after navigating away from the entry path", () => {
    window.history.replaceState(null, "", "/transfer");
    document.body.innerHTML = `
      <main>
        <h1>Transfer</h1>
        <p>${"Logged in account workspace ".repeat(8)}</p>
      </main>
    `;

    expect(
      isLikelyLoggedIn([], {
        afterSubmission: true,
        entryUrl: "https://example.test/login",
      }),
    ).toBe(true);
    expect(
      isLikelyLoggedIn([], {
        entryUrl: "https://example.test/login",
      }),
    ).toBe(false);
  });

  it("keeps login forms, OTP, and captcha as negative signals after submission", () => {
    window.history.replaceState(null, "", "/transfer");
    document.body.innerHTML = `
      <form>
        <input name="email" type="email" />
        <input name="password" type="password" />
      </form>
      <p>${"Neutral account page ".repeat(8)}</p>
    `;

    expect(
      isLikelyLoggedIn([], {
        usernameSelectors: ["input[name='email']"],
        passwordSelectors: ["input[name='password']"],
        afterSubmission: true,
        entryUrl: "https://example.test/login",
      }),
    ).toBe(false);

    document.body.innerHTML = `
      <form>
        <input name="email" type="email" hidden />
        <input name="password" type="password" hidden />
      </form>
      <p>${"Neutral account page ".repeat(8)}</p>
    `;

    expect(
      isLikelyLoggedIn([], {
        usernameSelectors: ["input[name='email']"],
        passwordSelectors: ["input[name='password']"],
        afterSubmission: true,
        entryUrl: "https://example.test/login",
      }),
    ).toBe(false);

    document.body.innerHTML = `
      <input name="otp" />
      <p>${"Neutral account page ".repeat(8)}</p>
    `;

    expect(
      isLikelyLoggedIn([], {
        otpSelectors: ["input[name='otp']"],
        afterSubmission: true,
        entryUrl: "https://example.test/login",
      }),
    ).toBe(false);

    document.body.innerHTML = `
      <div class="g-recaptcha">captcha</div>
      <p>${"Neutral account page ".repeat(8)}</p>
    `;

    expect(
      isLikelyLoggedIn([], {
        afterSubmission: true,
        entryUrl: "https://example.test/login",
      }),
    ).toBe(false);
  });
});
