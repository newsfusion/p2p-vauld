import { describe, it, expect, beforeEach } from "vitest";
import { cleanHtml } from "../../src/content/html-cleanup.js";

describe("cleanHtml", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("removes script tags", () => {
    document.body.innerHTML = '<div>Hello</div><script>alert(1)</script>';
    const { root } = cleanHtml();
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("Hello");
  });

  it("removes style tags", () => {
    document.body.innerHTML = '<div>Hello</div><style>.x{color:red}</style>';
    const { root } = cleanHtml();
    expect(root.querySelector("style")).toBeNull();
  });

  it("removes footer elements", () => {
    document.body.innerHTML = '<div>Data</div><footer>Copyright</footer>';
    const { root } = cleanHtml();
    expect(root.querySelector("footer")).toBeNull();
    expect(root.textContent).toContain("Data");
  });

  it("removes base64 images", () => {
    document.body.innerHTML = '<div>Data</div><img src="data:image/png;base64,ABC123">';
    const { root } = cleanHtml();
    expect(root.querySelector("img")).toBeNull();
  });

  it("removes aria-hidden elements", () => {
    document.body.innerHTML = '<div aria-hidden="true">Hidden</div><div>Visible</div>';
    const { root } = cleanHtml();
    expect(root.textContent).not.toContain("Hidden");
    expect(root.textContent).toContain("Visible");
  });

  it("preserves hidden form controls used by SPA login hydration", () => {
    document.body.innerHTML = `
      <form>
        <div class="nOADS" data-fieldname="email">
          <input name="email" hidden value="user@example.com" />
        </div>
        <div class="nOADS" data-fieldname="password">
          <input name="password" type="password" hidden value="secret" />
        </div>
        <div class="nOADS" data-fieldname="otp">
          <textarea name="otp" hidden>123456</textarea>
        </div>
        <button hidden>Sign in</button>
      </form>
      <div hidden>Decorative hidden text</div>
    `;

    const { root } = cleanHtml();
    const emailWrapper = root.querySelector('div.nOADS[data-fieldname="email"]');
    const email = root.querySelector('input[name="email"]') as HTMLInputElement | null;
    const password = root.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement | null;
    const otp = root.querySelector('textarea[name="otp"]') as HTMLTextAreaElement | null;

    expect(emailWrapper).not.toBeNull();
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    expect(otp).not.toBeNull();
    expect(email?.getAttribute("value")).toBe("");
    expect(email?.value).toBe("");
    expect(password?.getAttribute("value")).toBe("");
    expect(password?.value).toBe("");
    expect(otp?.getAttribute("value")).toBe("");
    expect(otp?.value).toBe("");
    expect(otp?.textContent).toBe("");
    expect(root.querySelector("button")).not.toBeNull();
    expect(root.textContent).not.toContain("Decorative hidden text");
  });

  it("removes SVG elements", () => {
    document.body.innerHTML = '<div>Data</div><svg><path d="M0 0"/></svg>';
    const { root } = cleanHtml();
    expect(root.querySelector("svg")).toBeNull();
  });

  it("preserves attributes (no longer stripped)", () => {
    document.body.innerHTML = '<div style="color:red" data-id="123">Data</div>';
    const { root, stats } = cleanHtml();
    expect(root.querySelector("[style]")).not.toBeNull();
    expect(root.querySelector("[data-id]")).not.toBeNull();
    expect(stats.attributesStripped).toBe(0);
  });

  it("removes empty container elements", () => {
    document.body.innerHTML = '<div></div><div>   </div><div>Content</div>';
    const { root } = cleanHtml();
    expect(root.querySelectorAll("div").length).toBe(1);
    expect(root.textContent).toContain("Content");
  });

  it("preserves HTML comment nodes (no longer removed)", () => {
    document.body.innerHTML = '<div>Data</div><!-- this is a comment --><div>More</div>';
    const { root } = cleanHtml();
    expect(root.textContent).toContain("Data");
    expect(root.textContent).toContain("More");
  });

  it("reports accurate cleanup stats", () => {
    document.body.innerHTML =
      '<div>Data €100</div><script>big script</script><footer>Footer</footer><svg><path/></svg>';
    const { stats } = cleanHtml();
    expect(stats.rawLength).toBeGreaterThan(stats.cleanedLength);
    expect(stats.reductionPct).toBeGreaterThan(0);
    expect(stats.elementsRemoved).toBeGreaterThan(0);
  });

  it("does not modify the live DOM", () => {
    document.body.innerHTML = '<div>Original</div><script>x</script>';
    cleanHtml();
    expect(document.querySelector("script")).not.toBeNull();
  });

  it("preserves financial data elements", () => {
    document.body.innerHTML = `
      <div class="portfolio">
        <span>Portfolio Value</span>
        <span>€12,345.67</span>
      </div>
      <div class="balance">
        <span>Available Cash</span>
        <span>€1,234.56</span>
      </div>
    `;
    const { root } = cleanHtml();
    expect(root.textContent).toContain("€12,345.67");
    expect(root.textContent).toContain("€1,234.56");
    expect(root.textContent).toContain("Portfolio Value");
  });

  it("preserves financial values inside semantic header banners", () => {
    document.body.innerHTML = `
      <header role="banner">
        <a href="/wallet" aria-label="Wallet">
          <span><div>€25.51</div></span>
        </a>
      </header>
      <main><div>Portfolio Value</div><div>€15,800.70</div></main>
    `;

    const { root } = cleanHtml();

    expect(root.querySelector('[role="banner"]')).not.toBeNull();
    expect(root.textContent).toContain("€25.51");
  });

  it("handles empty body gracefully", () => {
    document.body.innerHTML = "";
    const { root, stats } = cleanHtml();
    expect(stats.rawLength).toBe(0);
    expect(stats.cleanedLength).toBe(0);
    expect(stats.reductionPct).toBe(0);
    expect(root.innerHTML).toBe("");
  });

  it("handles body with only removable content", () => {
    document.body.innerHTML = '<script>x</script><style>y</style>';
    const { root, stats } = cleanHtml();
    expect(stats.reductionPct).toBe(100);
    expect(root.textContent?.trim()).toBe("");
  });

  it("removes iframe elements", () => {
    document.body.innerHTML = '<div>Data</div><iframe src="https://example.com"></iframe>';
    const { root } = cleanHtml();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.textContent).toContain("Data");
  });

  it("preserves event handler attributes (no longer stripped)", () => {
    document.body.innerHTML = '<div onclick="alert(1)" onload="foo()">Data</div>';
    const { root } = cleanHtml();
    expect(root.querySelector("[onclick]")).not.toBeNull();
    expect(root.querySelector("[onload]")).not.toBeNull();
    expect(root.textContent).toContain("Data");
  });
});
