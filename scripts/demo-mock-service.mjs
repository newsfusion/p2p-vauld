import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_LOGIN_CACHE_DIR,
  parseDemoLoginPageMode,
  renderCachedLoginPage as renderCachedLoginPageFromCache,
} from "./demo-login-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const platformCatalog = JSON.parse(
  readFileSync(path.join(repoRoot, "src/shared/platforms/platform-catalog.json"), "utf8"),
);

export const DEMO_ALL_PLATFORM_IDS = platformCatalog.map((platform) => platform.id);
export const DEMO_PLATFORM_IDS = DEMO_ALL_PLATFORM_IDS.slice(0, 10);
const platformById = new Map(platformCatalog.map((platform) => [platform.id, platform]));

const DEFAULT_PORT = 4180;
const HOST = "127.0.0.1";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoney(value) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatEuMoney(value) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  return value.toFixed(2);
}

function formatEuPercent(value) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sendHtml(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

export function createDemoState() {
  return new Map(DEMO_ALL_PLATFORM_IDS.map((platformId) => [platformId, 0]));
}

export function resetDemoState(state) {
  for (const platformId of DEMO_ALL_PLATFORM_IDS) {
    state.set(platformId, 0);
  }
}

export function getDynamicAdditions(platformIndex, date = new Date()) {
  if (!date) {
    return { portfolioAddition: 0, freeCashAddition: 0 };
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const timeStr = hours + minutes;

  const incrementedDigits = timeStr
    .split("")
    .map((char) => {
      const digit = Number.parseInt(char, 10);
      return (digit + platformIndex) % 10;
    })
    .join("");

  const integerPart = Number.parseInt(incrementedDigits, 10);
  const decimalPart = platformIndex * 0.11;
  const portfolioAddition = integerPart + decimalPart;
  const freeCashAddition = Number((portfolioAddition / 100).toFixed(4));

  return {
    portfolioAddition,
    freeCashAddition,
  };
}

export function getDemoValues(platformId, stateIndex, date = new Date()) {
  const platformIndex = DEMO_PLATFORM_IDS.indexOf(platformId);
  const allPlatformIndex = DEMO_ALL_PLATFORM_IDS.indexOf(platformId);
  if (platformIndex < 0) {
    if (allPlatformIndex < 0) {
      throw new Error(`Unknown demo platform: ${platformId}`);
    }
  }

  const effectivePlatformIndex = allPlatformIndex;
  let basePortfolioValue = 10_000 + effectivePlatformIndex * 1_000 + stateIndex * 250;
  // Keep demo accounts visually distinct so mock portfolios do not cluster
  // into near-identical ranges across screenshots and smoke tests.
  if (effectivePlatformIndex === 0) {
    basePortfolioValue -= 6_000;
  }
  if (effectivePlatformIndex === 2) {
    basePortfolioValue += 5_000;
  }
  if (effectivePlatformIndex === 6) {
    basePortfolioValue -= 3_090;
  }
  if (effectivePlatformIndex === 7) {
    basePortfolioValue -= 13_090;
  }
  const baseFreeCash = 500 + effectivePlatformIndex * 50 + stateIndex * 25;
  const baseNetAnnualReturn = Number((6 + effectivePlatformIndex * 0.15 + stateIndex * 0.03).toFixed(2));

  const { portfolioAddition, freeCashAddition } = getDynamicAdditions(effectivePlatformIndex, date);

  return {
    portfolioValue: basePortfolioValue + portfolioAddition,
    freeCash: baseFreeCash + freeCashAddition,
    netAnnualReturn: baseNetAnnualReturn,
  };
}

export function renderIndexPage() {
  const links = DEMO_ALL_PLATFORM_IDS.map(
    (platformId) =>
      `<li><a href="/demo/${platformId}/login">${escapeHtml(platformId)}</a></li>`,
  ).join("");

  return page(
    "P2P Demo Service",
    `<main>
      <h1>P2P Demo Service</h1>
      <p>Mock platform service for the P2P Portfolio Tracker demo mode.</p>
      <nav aria-label="Demo platforms">
        <ul>${links}</ul>
      </nav>
    </main>`,
  );
}

export function renderCachedLoginPage(platformId, options = {}) {
  const platform = platformById.get(platformId);
  return renderCachedLoginPageFromCache(platformId, {
    cacheDir: options.cacheDir,
    platformName: options.platformName ?? platform?.name ?? platformId,
    sourceUrl: options.sourceUrl ?? platform?.login?.entryUrl ?? "",
  });
}

export function renderLoginPage(platformId) {
  return page(
    `${platformId} login`,
    `<main>
      <h1>${escapeHtml(platformId)} Login</h1>
      <form method="POST" action="/demo/${platformId}/authenticated" class="login-form">
        <label for="login-username">Email</label>
        <input id="login-username" name="email" type="email" autocomplete="username" />
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" />
        <button data-testid="login-button" type="submit">Sign in</button>
      </form>
    </main>`,
  );
}

export function renderAuthenticatedPage(platformId) {
  return page(
    `${platformId} authenticated`,
    `<main>
      <h1>Demo authenticated</h1>
      <p>${escapeHtml(platformId)} session ready.</p>
      <a href="/demo/${platformId}/dashboard">Dashboard</a>
    </main>`,
  );
}

export const DEMO_DASHBOARD_TEMPLATES = {
  mintos: ({ values }) => `<main>
      <h1>${escapeHtml("mintos")} Dashboard</h1>
      <section data-testid="account-overview" aria-label="Portfolio summary">
        <h1 data-testid="total-value">Portfolio Value €${formatMoney(values.portfolioValue)}</h1>
        <p><span>Free Cash</span> <strong>€${formatMoney(values.freeCash)}</strong></p>
        <p><span>Net Annual Return</span> <strong>${formatPercent(values.netAnnualReturn)}%</strong></p>
      </section>
    </main>`,
  bondora_go_grow: ({ values }) => `<main>
      <h1>Bondora Go & Grow Dashboard</h1>
      <section aria-label="Investor account">
        <p>Account balance: €${formatMoney(values.portfolioValue)}</p>
        <p>Wallet: €${formatMoney(values.freeCash)}</p>
        <p>Annual return: ${formatPercent(values.netAnnualReturn)}%</p>
      </section>
    </main>`,
  peerberry: ({ values }) => `<main>
      <h1>PeerBerry Overview</h1>
      <section aria-label="Available for investment">
        <article data-test="peerberry-balance">Portfolio Value €${formatMoney(values.portfolioValue)}</article>
        <article><span>Available funds</span><b>€${formatMoney(values.freeCash)}</b></article>
        <article><span>Net annualised return</span><b>${formatPercent(values.netAnnualReturn)}%</b></article>
      </section>
    </main>`,
  robocash: ({ values }) => `<main>
      <h1>Robocash Investor Cabinet</h1>
      <table aria-label="Financial overview">
        <tbody>
          <tr><th scope="row">Total investments</th><td>€${formatMoney(values.portfolioValue)}</td></tr>
          <tr><th scope="row">Available funds</th><td>€${formatMoney(values.freeCash)}</td></tr>
          <tr><th scope="row">Expected return</th><td>${formatPercent(values.netAnnualReturn)}%</td></tr>
        </tbody>
      </table>
    </main>`,
  twino: ({ values }) => `<main>
      <h1>TWINO Account</h1>
      <dl aria-label="Account metrics">
        <dt>Total value</dt>
        <dd>€${formatMoney(values.portfolioValue)}</dd>
        <dt>Available to invest</dt>
        <dd>€${formatMoney(values.freeCash)}</dd>
        <dt>XIRR yearly</dt>
        <dd>${formatPercent(values.netAnnualReturn)}%</dd>
      </dl>
    </main>`,
  estateguru: ({ values }) => `<main>
      <h1>Estateguru Portfolio</h1>
      <section aria-label="Uebersicht">
        <p><span>Kontowert</span><strong>${formatEuMoney(values.portfolioValue)} EUR</strong></p>
        <p><span>Verfügbares Guthaben</span><strong>${formatEuMoney(values.freeCash)} EUR</strong></p>
        <p><span>Jahresrendite</span><strong>${formatEuPercent(values.netAnnualReturn)}%</strong></p>
      </section>
    </main>`,
  debitum: ({ values }) => `<main>
      <h1>Debitum Dashboard</h1>
      <section class="dashboard-cards" aria-label="Account cards">
        <article class="metric-card"><span class="label">Net value</span><span class="portfolio-value"><span>€</span><span>${formatMoney(values.portfolioValue)}</span></span></article>
        <article class="metric-card"><span class="label">Free cash</span><span class="free-cash"><span>€</span><span>${formatMoney(values.freeCash)}</span></span></article>
        <article class="metric-card"><span class="label">Annual yield</span><span class="yield-value"><span>${formatPercent(values.netAnnualReturn)}</span><span>%</span></span></article>
      </section>
    </main>`,
  esketit: ({ values }) => `<main>
      <h1>Esketit Summary</h1>
      <section aria-label="Summary">
        <p><strong>€${formatMoney(values.portfolioValue)}</strong> Total value</p>
        <p><strong>€${formatMoney(values.freeCash)}</strong> Uninvested cash</p>
        <p><strong>${formatPercent(values.netAnnualReturn)}%</strong> IRR annual</p>
      </section>
    </main>`,
  viainvest: ({ values }) => `<main>
      <h1>VIAINVEST Dashboard</h1>
      <section aria-label="Portfolio overview">
        <div>Portfolio: ${formatEuMoney(values.portfolioValue)} EUR</div>
        <div>Available cash: ${formatEuMoney(values.freeCash)} EUR</div>
        <div>Net annual return: ${formatEuPercent(values.netAnnualReturn)}%</div>
      </section>
    </main>`,
  nectaro: ({ values }) => `<main>
      <h1>Nectaro Dashboard</h1>
      <aside aria-label="Risk breakdown">
        <p>Delayed loans 31-60 days: 42.00%</p>
        <p>Monthly bonus rate: 1.20%</p>
      </aside>
      <section aria-label="Real portfolio metrics">
        <div><span>Portfolio value</span><strong>€${formatMoney(values.portfolioValue)}</strong></div>
        <div><span>Free cash</span><strong>€${formatMoney(values.freeCash)}</strong></div>
        <div><span>Net annual return</span><strong>${formatPercent(values.netAnnualReturn)}%</strong></div>
      </section>
    </main>`,
};

const DASHBOARDS_WITH_STABLE_NATIVE_SIGNALS = new Set([
  "mintos",
  "peerberry",
  "twino",
  "debitum",
]);

function renderGenericDashboardTemplate({ platformId, values }) {
  const platformName = platformById.get(platformId)?.name ?? platformId;
  return `<main>
      <h1>${escapeHtml(platformName)} Dashboard</h1>
      <section aria-label="Portfolio summary" data-testid="generic-demo-dashboard">
        <article>
          <span>Portfolio Value</span>
          <strong>€${formatMoney(values.portfolioValue)}</strong>
        </article>
        <article>
          <span>Free Cash</span>
          <strong>€${formatMoney(values.freeCash)}</strong>
        </article>
        <article>
          <span>Net Annual Return</span>
          <strong>${formatPercent(values.netAnnualReturn)}%</strong>
        </article>
      </section>
    </main>`;
}

function renderCanonicalMetricSection(values) {
  return `<section aria-label="Canonical demo metrics" data-testid="canonical-demo-metrics">
      <p><span>Portfolio Value</span> <strong>€${formatMoney(values.portfolioValue)}</strong></p>
      <p><span>Free Cash</span> <strong>€${formatMoney(values.freeCash)}</strong></p>
      <p><span>Net Annual Return</span> <strong>${formatPercent(values.netAnnualReturn)}%</strong></p>
    </section>`;
}

export function renderDashboardPage(platformId, stateIndex, date = new Date()) {
  const values = getDemoValues(platformId, stateIndex, date);
  const renderTemplate =
    DEMO_DASHBOARD_TEMPLATES[platformId] ?? renderGenericDashboardTemplate;
  if (!renderTemplate) {
    throw new Error(`Unknown demo platform: ${platformId}`);
  }

  return page(
    `${platformId} dashboard`,
    `${renderTemplate({ platformId, values })}
    ${
      DASHBOARDS_WITH_STABLE_NATIVE_SIGNALS.has(platformId)
        ? ""
        : renderCanonicalMetricSection(values)
    }`,
  );
}

export function createDemoMockServer(options = {}) {
  const state = options.state ?? createDemoState();
  const loginPageMode = options.loginPageMode ?? parseDemoLoginPageMode(process.env.DEMO_LOGIN_PAGE_MODE);
  const loginCacheDir = options.loginCacheDir ?? process.env.DEMO_LOGIN_CACHE_DIR ?? DEMO_LOGIN_CACHE_DIR;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        platformCount: DEMO_ALL_PLATFORM_IDS.length,
        loginPageMode,
      });
      return;
    }

    if (url.pathname === "/reset" && req.method === "POST") {
      resetDemoState(state);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      sendHtml(res, 200, renderIndexPage());
      return;
    }

    const match = url.pathname.match(/^\/demo\/([^/]+)\/([^/]+)$/);
    if (!match) {
      sendHtml(res, 404, page("Not Found", "<main><h1>Not Found</h1></main>"));
      return;
    }

    const [, platformId, view] = match;
    if (!DEMO_ALL_PLATFORM_IDS.includes(platformId)) {
      sendHtml(res, 404, page("Unknown Platform", "<main><h1>Unknown Platform</h1></main>"));
      return;
    }

    if (view === "login" && req.method === "GET") {
      sendHtml(
        res,
        200,
        loginPageMode === "catalog-cache"
          ? renderCachedLoginPage(platformId, { cacheDir: loginCacheDir })
          : renderLoginPage(platformId),
      );
      return;
    }

    if (view === "authenticated" && (req.method === "GET" || req.method === "POST")) {
      sendHtml(res, 200, renderAuthenticatedPage(platformId));
      return;
    }

    if (view === "dashboard" && req.method === "GET") {
      Promise.resolve(options.beforeDashboardResponse?.({ platformId }))
        .then(() => {
          const stateIndex = state.get(platformId) ?? 0;
          state.set(platformId, stateIndex + 1);
          sendHtml(
            res,
            200,
            options.renderDashboard?.({ platformId, stateIndex }) ??
              renderDashboardPage(platformId, stateIndex),
          );
        })
        .catch((error) => {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    sendHtml(res, 405, page("Method Not Allowed", "<main><h1>Method Not Allowed</h1></main>"));
  });

  return { server, state };
}

export function parsePort(value) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : DEFAULT_PORT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parsePort(process.env.DEMO_SERVICE_PORT);
  const { server } = createDemoMockServer();

  server.listen(port, HOST, () => {
    console.log(`Demo mock service listening on http://localhost:${port}`);
  });

  server.on("error", (error) => {
    console.error(`Demo mock service failed: ${error.message}`);
    process.exitCode = 1;
  });
}
