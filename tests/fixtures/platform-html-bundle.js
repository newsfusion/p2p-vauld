// @p2p-synthetic-fixture
// Synthetic HTML only. Do not paste live platform captures into committed fixtures.

function html(strings, ...values) {
  return String.raw({ raw: strings }, ...values);
}

export const logins = {
  mintos: {
    id: "mintos",
    name: "Mintos",
    fileName: "mintos-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <label>Email <input type="email" name="email" autocomplete="username" /></label>
      <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`,
  },
  debitum: {
    id: "debitum",
    name: "Debitum",
    fileName: "debitum-investments-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <div class="nOADS" data-fieldname="email">
        <input name="email" inputmode="email" type="email" autocomplete="username" />
      </div>
      <div class="nOADS" data-fieldname="password">
        <input name="password" type="password" autocomplete="current-password" />
      </div>
      <button class="_85ZHE" type="submit">Einloggen</button>
    </form>
  </body>
</html>`,
  },
  estateguru: {
    id: "estateguru",
    name: "Estateguru",
    fileName: "estateguru-com-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <input name="username" placeholder="name@example.com" type="email" autocomplete="username" />
      <input name="password" type="password" autocomplete="current-password" />
      <button type="submit">Log in</button>
    </form>
  </body>
</html>`,
  },
  income_marketplace: {
    id: "income_marketplace",
    name: "Income",
    fileName: "income-marketplace-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <input name="email" type="email" autocomplete="username" />
      <input name="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`,
  },
  indemo: {
    id: "indemo",
    name: "Indemo",
    fileName: "indemo-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <input name="email" type="email" autocomplete="username" />
      <input name="password" type="password" autocomplete="current-password" />
      <button type="submit">Login</button>
    </form>
  </body>
</html>`,
  },
  peerberry: {
    id: "peerberry",
    name: "PeerBerry",
    fileName: "peerberry-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <input name="email" type="email" autocomplete="username" />
      <input name="password" type="password" autocomplete="current-password" />
      <button type="submit">Log in</button>
    </form>
  </body>
</html>`,
  },
  triple_dragon: {
    id: "triple_dragon",
    name: "Triple Dragon Funding",
    fileName: "triple-dragon-login.html",
    html: html`<!doctype html>
<html>
  <body>
    <form>
      <input name="email" type="email" autocomplete="username" />
      <input name="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`,
  },
};

export const dashboards = {
  mintos: {
    id: "mintos",
    name: "Mintos",
    fileName: "mintos.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Mintos portfolio overview</h1>
      <section data-testid="account-overview" aria-label="Portfolio Value">
        <h1 data-testid="total-value">€12,345.67</h1>
        <p>Available funds <span class="m-u-nowrap m-u-color-n10--text">€890.12</span></p>
        <div data-test="mintos-balance">Portfolio Value €12,345.67</div>
        <dl>
          <dt>Portfolio Value</dt><dd>€12,345.67</dd>
          <dt>Free Cash</dt><dd>€890.12</dd>
          <dt>Net Annual Return</dt><dd>8.50%</dd>
        </dl>
      </section>
    </main>
  </body>
</html>`,
  },
  debitum: {
    id: "debitum",
    name: "Debitum",
    fileName: "debitum-investments.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Debitum dashboard</h1>
      <section aria-label="Portfolio Value">
        <h2>Total invested</h2>
        <div class="_2nctq _2MeSN _3kiGJ">
          <div class="_2Ft66 _3yzYJ JZ1mA _1NpnX">€2,516.63</div>
        </div>
      </section>
      <section aria-label="Free Cash">
        <h2>Available funds</h2>
        <div class="_3sWxm">
          <div class="_2Xt7V">
            <div class="_2Ft66 _3yzYJ KoTjv">
              <div class="_2nctq _2eX-8 _3kiGJ">
                <div class="_2Ft66 _3yzYJ KoTjv">€0.15</div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <dl>
        <dt>Portfolio Value</dt><dd>€2,516.63</dd>
        <dt>Free Cash</dt><dd>€0.15</dd>
        <dt>Net Annual Return</dt><dd>7.20%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
  estateguru: {
    id: "estateguru",
    name: "Estateguru",
    fileName: "estateguru-com.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Estateguru dashboard portfolio overview</h1>
      <section aria-label="Account value">
        <h2>Portfolio Value</h2>
        <div data-test="portfolio-value" class="portfolio-value">€8,765.43</div>
      </section>
      <section aria-label="Available funds">
        <h2>Available funds</h2>
        <div data-test="available-funds" class="available-funds">€321.00</div>
      </section>
      <section aria-label="Annual return">
        <h2>Net annual return</h2>
        <div data-test="annual-return" class="annual-return">9.8%</div>
      </section>
      <dl>
        <dt>Portfolio Value</dt><dd>€8,765.43</dd>
        <dt>Free Cash</dt><dd>€321.00</dd>
        <dt>Net Annual Return</dt><dd>9.8%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
  income_marketplace: {
    id: "income_marketplace",
    name: "Income",
    fileName: "income-marketplace.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Income portfolio dashboard</h1>
      <section class="your" aria-label="Your portfolio">
        <h2>Your portfolio</h2>
        <div class="header-value">€4,210.90</div>
      </section>
      <section class="info-table" aria-label="Available funds">
        <div>Available funds</div>
        <div class="col-4 text-right">€110.20</div>
      </section>
      <dl>
        <dt>Portfolio Value</dt><dd>€4,210.90</dd>
        <dt>Free Cash</dt><dd>€110.20</dd>
        <dt>Net Annual Return</dt><dd>8.10%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
  indemo: {
    id: "indemo",
    name: "Indemo",
    fileName: "indemo.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Indemo portfolio dashboard</h1>
      <nav aria-label="Portfolio">
        <span>Portfolio Value</span>
        <span class="aside-bar__nav-amount">€6,450.00</span>
      </nav>
      <nav aria-label="Available cash">
        <span>Available</span>
        <span class="aside-bar__menu-sublist-amout">€75.00</span>
      </nav>
      <dl>
        <dt>Portfolio Value</dt><dd>€6,450.00</dd>
        <dt>Free Cash</dt><dd>€75.00</dd>
        <dt>Net Annual Return</dt><dd>6.90%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
  peerberry: {
    id: "peerberry",
    name: "PeerBerry",
    fileName: "peerberry.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>PeerBerry overview dashboard</h1>
      <section aria-label="Account overview">
        <h2>Total portfolio invested funds</h2>
        <div data-test="peerberry-balance">€3,333.33</div>
      </section>
      <section aria-label="Available for investment">
        <h2>Available funds</h2>
        <div>€890.12</div>
      </section>
      <dl>
        <dt>Portfolio Value</dt><dd>€3,333.33</dd>
        <dt>Free Cash</dt><dd>€890.12</dd>
        <dt>Net Annual Return</dt><dd>10.40%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
  triple_dragon: {
    id: "triple_dragon",
    name: "Triple Dragon Funding",
    fileName: "triple-dragon.html",
    html: html`<!doctype html>
<html>
  <body>
    <main>
      <h1>Triple Dragon portfolio dashboard</h1>
      <section aria-label="Account value">
        <h2>Invested portfolio</h2>
        <p class="text-primary-yellow text-3xl">€7,777.77</p>
      </section>
      <section aria-label="Available wallet balance">
        <h2>Available</h2>
        <div class="text-primary-milky-white leading-6 font-semibold">€88.88</div>
      </section>
      <dl>
        <dt>Portfolio Value</dt><dd>€7,777.77</dd>
        <dt>Free Cash</dt><dd>€88.88</dd>
        <dt>Net Annual Return</dt><dd>11.20%</dd>
      </dl>
    </main>
  </body>
</html>`,
  },
};

export function dashboardFixture(platformId) {
  const fixture = dashboards[platformId];
  if (!fixture) throw new Error(`Missing synthetic dashboard fixture for ${platformId}`);
  return fixture;
}

export function loginFixture(platformId) {
  const fixture = logins[platformId];
  if (!fixture) throw new Error(`Missing synthetic login fixture for ${platformId}`);
  return fixture;
}
