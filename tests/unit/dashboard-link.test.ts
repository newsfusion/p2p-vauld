import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clickDashboardLink,
  findDashboardLink,
  findFirstNavLink,
  findLogoLink,
} from "../../src/content/dashboard-link.js";

// Static test fixtures only — same pattern as the other happy-dom tests.
function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  setBody("");
});

describe("findDashboardLink", () => {
  it("finds an exact Dashboard anchor (demo mock shape)", () => {
    setBody('<a href="/demo/mintos/dashboard">Dashboard</a>');

    const match = findDashboardLink();

    expect(match?.text).toBe("dashboard");
  });

  it("finds German Übersicht and Kontoübersicht links", () => {
    setBody('<a href="/konto">Kontoübersicht</a>');

    const match = findDashboardLink();

    expect(match?.text).toBe("kontoübersicht");
  });

  it("prefers tier-1 Dashboard over tier-2 Portfolio", () => {
    setBody(
      '<a href="/portfolio" id="portfolio">Portfolio</a>' +
        '<a href="/home" id="dash">Go to dashboard</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("dash");
  });

  // Debitum ships a nav where "Konto" is the overview and "Meine Investitionen"
  // is a per-loan list. The list link used to win and steer extraction onto the
  // wrong page.
  it("prefers Konto over Meine Investitionen", () => {
    setBody(
      '<a href="/investments" id="list">Meine Investitionen</a>' +
        '<a href="/konto" id="konto">Konto</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("konto");
  });

  it("prefers Account over My Investments", () => {
    setBody(
      '<a href="/investments" id="list">My Investments</a>' +
        '<a href="/account" id="account">Account</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("account");
  });

  it("still finds an investments link when nothing better exists", () => {
    setBody(
      '<a href="/loans">Loan book</a>' +
        '<a href="/investments" id="list">Meine Investitionen</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("list");
  });

  it("prefers an exact match over a substring match", () => {
    setBody(
      '<a href="/fees" id="fees">Overview of all fees</a>' +
        '<a href="/x" id="overview">Overview</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("overview");
  });

  it("never matches logout, settings, or help links", () => {
    setBody(
      '<a href="/logout">Logout</a>' +
        '<a href="/settings">Einstellungen</a>' +
        '<a href="/help">Help</a>',
    );

    expect(findDashboardLink()).toBeNull();
  });

  it("rejects dashboard-labeled links with a logout href", () => {
    setBody('<a href="/logout?next=dashboard">Dashboard</a>');

    expect(findDashboardLink()).toBeNull();
  });

  it("rejects cross-origin links", () => {
    setBody('<a href="https://evil.example.com/dashboard">Dashboard</a>');

    expect(findDashboardLink()).toBeNull();
  });

  it("skips hidden elements in favor of visible lower-tier links", () => {
    setBody(
      '<a href="/dash" id="hidden" style="display:none">Dashboard</a>' +
        '<a href="/portfolio" id="visible">Portfolio</a>',
    );

    const match = findDashboardLink();

    expect(match?.element.id).toBe("visible");
  });

  it("matches link roles via aria-label when the element has no text", () => {
    setBody('<a href="/dashboard" aria-label="Dashboard"></a>');

    const match = findDashboardLink();

    expect(match?.text).toBe("dashboard");
  });

  it("does not match action buttons with broad portfolio keywords", () => {
    setBody('<button id="invest">Invest from portfolio</button>');

    expect(findDashboardLink()).toBeNull();
  });

  it("returns null when no navigation-like link exists", () => {
    setBody("<a href='/imprint'>Imprint</a><p>Some prose about dashboards</p>");

    expect(findDashboardLink()).toBeNull();
  });
});

describe("clickDashboardLink", () => {
  it("clicks the matched anchor and reports its href", () => {
    setBody('<a href="/demo/mintos/dashboard">Dashboard</a>');
    const anchor = document.querySelector("a")!;
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(() => {});

    const result = clickDashboardLink();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.clicked).toBe(true);
    expect(result.navigationKind).toBe("click");
    expect(result.href).toContain("/demo/mintos/dashboard");
    expect(result.matchText).toBe("dashboard");
  });

  it("clicks SPA router links without a real href", () => {
    setBody('<a href="#" id="spa">Dashboard</a>');
    const anchor = document.querySelector("a")!;
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(() => {});

    const result = clickDashboardLink();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.clicked).toBe(true);
    expect(result.href).toBeUndefined();
  });

  it("navigates in place instead of clicking target=_blank links", () => {
    setBody('<a href="/dashboard" target="_blank">Dashboard</a>');
    const anchor = document.querySelector("a")!;
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(() => {});
    const assignSpy = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});

    const result = clickDashboardLink();

    expect(assignSpy).toHaveBeenCalledOnce();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(result.clicked).toBe(true);
    expect(result.navigationKind).toBe("assign");
  });

  it("reports clicked: false when nothing matches", () => {
    setBody("<a href='/logout'>Logout</a>");

    expect(clickDashboardLink()).toEqual({ clicked: false });
  });

  it("keeps payload-less calls on the keyword strategy", () => {
    setBody(
      '<header><a href="/" class="brand"><img alt="Mintos logo"></a></header>' +
        '<a href="/dashboard">Dashboard</a>',
    );
    const logoClick = vi
      .spyOn(document.querySelector(".brand") as HTMLAnchorElement, "click")
      .mockImplementation(() => {});
    const dashboardClick = vi
      .spyOn(document.querySelector('[href="/dashboard"]') as HTMLAnchorElement, "click")
      .mockImplementation(() => {});

    const result = clickDashboardLink();

    expect(result.href).toContain("/dashboard");
    expect(dashboardClick).toHaveBeenCalledOnce();
    expect(logoClick).not.toHaveBeenCalled();
  });

  it("dispatches to the logo strategy", () => {
    setBody(
      '<header><a href="/" class="brand-logo"><img alt="Platform logo"></a></header>' +
        '<a href="/dashboard">Dashboard</a>',
    );
    const logo = document.querySelector(".brand-logo") as HTMLAnchorElement;
    const clickSpy = vi.spyOn(logo, "click").mockImplementation(() => {});

    const result = clickDashboardLink(document, { strategy: "logo" });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.clicked).toBe(true);
    expect(result.href).toBe("http://localhost/");
  });

  it("dispatches to the first-nav strategy", () => {
    setBody(
      '<nav><a href="/transfers">Transfers</a><a href="/portfolio">Portfolio</a></nav>',
    );
    const firstLink = document.querySelector("nav a") as HTMLAnchorElement;
    const clickSpy = vi.spyOn(firstLink, "click").mockImplementation(() => {});

    const result = clickDashboardLink(document, { strategy: "first-nav" });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.clicked).toBe(true);
    expect(result.href).toContain("/transfers");
    expect(result.matchText).toBe("transfers");
  });

  it("excludes already visited hrefs by normalized URL", () => {
    setBody(
      '<nav><a href="/transfers#top">Transfers</a><a href="/portfolio">Portfolio</a></nav>',
    );
    const portfolio = document.querySelector('[href="/portfolio"]') as HTMLAnchorElement;
    const clickSpy = vi.spyOn(portfolio, "click").mockImplementation(() => {});

    const result = clickDashboardLink(document, {
      strategy: "first-nav",
      excludeHrefs: ["http://localhost/transfers"],
    });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(result.href).toContain("/portfolio");
  });
});

describe("findLogoLink", () => {
  it("finds same-origin logo links in the header", () => {
    setBody('<header><a href="/" aria-label="Home"><img alt="Income logo"></a></header>');

    const match = findLogoLink();

    expect(match?.href).toBe("http://localhost/");
  });

  it("rejects excluded logo hrefs", () => {
    setBody('<header><a href="/" class="logo"><img alt="Logo"></a></header>');

    expect(findLogoLink(document, ["http://localhost/"])).toBeNull();
  });
});

describe("findFirstNavLink", () => {
  it("finds the first safe same-origin nav link", () => {
    setBody(
      '<nav><a href="/logout">Logout</a><a href="/transfer">Transfer</a></nav>',
    );

    const match = findFirstNavLink();

    expect(match?.href).toContain("/transfer");
    expect(match?.text).toBe("transfer");
  });
});
