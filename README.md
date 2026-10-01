# Folio

A read-only research workspace for public investment-manager disclosures. Follow managers, inspect reported holdings, compare quarterly quantities and allocations, and explore securities held across portfolios.

Folio uses SEC EDGAR Form 13F-HR filings. It does not connect to brokerage accounts, execute trades, or generate investment recommendations. Manager-associated names are navigation labels, not evidence of personal ownership or responsibility for individual trades.

## Research workspace

- Syntari UI application shell and controls, with light and dark themes.
- Five tracked manager profiles with browser-local follows and official filing links.
- Same-period allocation comparisons and a manager-by-security overlap heatmap.
- Searchable holdings, quantity-change filters, sorting, and filtered CSV export.
- A source ledger separating application readiness, contact configuration, and filing availability.
- Explicit unavailable and partial-coverage states. No sample holdings or fabricated performance charts.

Syntari sources are vendored at a fixed revision with MIT attribution. See [design-system integration](docs/design-system.md).

## Run locally

Requires Node.js 22 or newer. No application dependencies or frontend build are required.

```sh
cp .dev.vars.example .dev.vars
# Set SEC_USER_AGENT to an application identifier and real contact email.
npm run check
npm test
npm start
```

Open `http://localhost:8787`. The Node server loads `.dev.vars` when present; process environment values take precedence. The file is ignored by Git. SEC contact configuration stays on the server.

The workspace and investor directory are available without a contact. Holdings and charts remain empty until reports are successfully retrieved.

## Deploy to Cloudflare

Use the independent Worker named `folio`, with this repository as its Git source.

| Setting | Value |
| --- | --- |
| Repository | `giovanitier/folio` |
| Worker | `folio` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run check && npm test` |
| Deploy command | `npm run deploy` |
| Non-production upload command | `npm run preview` |
| Runtime secret | `SEC_USER_AGENT` |

In **Workers & Pages → folio → Settings → Variables and Secrets**, add `SEC_USER_AGENT` as a **Secret**, then deploy the setting. It must contain an application name and a real monitored contact email. A build-only variable is not available at runtime. Never commit the contact value or put it in browser code.

CLI alternative, from this repository after authenticating with Cloudflare:

```sh
npm run deploy
npx wrangler secret put SEC_USER_AGENT
```

`server.mjs` provides the application boundary and diagnostics. `worker.mjs` is the SEC filing engine. Static assets live in `public/`. Configuration contains no account identifiers or custom-domain routes.

See [runtime setup and deployment verification](docs/deployment.md) for diagnostics and testing instructions. A successful build does not prove that SEC access works.

## Data limitations

13F reports are delayed disclosures, not real-time portfolios. Reported values are USD from the filing, not current prices, total assets under management, personal balances, or performance records. Option values are reported exposure, not premiums.

Quantity changes do not prove purchases or sales; splits, class changes, and reorganizations are not normalized. An absent holding is not proof it was sold. Options and principal amounts remain distinct. Overlap excludes options, counts each manager once per security, and separates reporting periods.

Amended reports and nonconsecutive quarters are withheld pending reconciliation. Archived submission pages are not traversed in this version.

Successful records use a six-hour edge cache; failures use a one-minute cache. Refreshing the UI does not bypass that cache. Request starts are spaced by 550 ms per isolate, not globally. The local Node server has no edge cache. Broad multi-user traffic requires centralized ingestion, shared rate limits, and persistent snapshots.

## Contributing

Run `npm run check` and `npm test`. Test fixtures are synthetic and never served by the Worker. Optional offline DOM checks are documented in [deployment and testing](docs/deployment.md); they do not verify live upstream access.

See [AGENTS.md](AGENTS.md) for engineering and public communication conventions. Pull requests should explain behavior, validation, and limitations without including private information.

## Primary documentation

- [SEC EDGAR access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC Form 13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f)
- [Cloudflare Workers Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
