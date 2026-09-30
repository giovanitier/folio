# Folio

A read-only tracker for public investment-manager disclosures. Follow managers, inspect reported holdings, compare quarterly position quantities, and explore overlap between portfolios.

Folio uses SEC EDGAR Form 13F-HR filings. It does not connect to brokerage accounts, execute trades, or generate investment recommendations. Manager-associated names are navigation labels, not evidence of personal ownership or responsibility for individual trades.

## Features

- Five configurable manager profiles with filing dates and official source links.
- Position states: new, increased, reduced, unchanged, and absent from the latest report.
- Activity feed, manager details, company search, and browser-local follows.
- Same-quarter consensus across reported equity holdings.
- Explicit unavailable and partial-coverage states; no sample holdings in the app.
- Cloudflare Worker API and static frontend with no application dependencies.

## Run locally

Requires Node.js 22 or newer.

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set SEC_USER_AGENT to a project identifier and real contact email.
npm run check
npm test
npm start
```

Open `http://localhost:8787`. The UI and health endpoint work without SEC configuration; the dashboard returns `503 SEC_NOT_CONFIGURED` until a contact is supplied. `.dev.vars` is ignored by Git. The contact is sent to SEC on server-side requests, not to the browser.

## Deploy to Cloudflare

Use a dedicated Worker named `folio`, with this repository as its Git source.

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

In Cloudflare Workers & Pages, create an application and import this repository. Add `SEC_USER_AGENT` as a runtime secret, not a public source constant. Enable non-production branch builds for preview URLs. Wrangler configuration includes only this application's Worker and `public/` assets; it contains no account identifiers or custom-domain routes.

For an authenticated CLI deployment:

```sh
npm run deploy
npx wrangler@4 secret put SEC_USER_AGENT
```

Deploying without the secret serves the UI with the explicit configuration-required state. Setting the secret enables requests to SEC. A repository push alone does not create a Cloudflare project or prove a deployment is live.

## Verify a deployment

`GET /api/health` reports service readiness and whether SEC contact configuration exists. It does not test SEC availability.

`GET /api/dashboard` returns sourced records or explicit errors. Verify actual holdings, reporting periods, and source links before treating the deployment as data-ready. Synthetic automated fixtures are never served by the app.

## Data limitations

13F reports are delayed disclosures, not real-time portfolios. Reported values are USD from the filing, not current prices, total assets under management, personal balances, or performance records.

Quantity changes do not prove purchases or sales; splits, class changes, and reorganizations are not normalized. An absent holding is not proof it was sold. Options and principal amounts remain distinct. Consensus excludes options, counts each manager once, and separates reporting periods.

Amended reports and nonconsecutive quarters are withheld pending reconciliation. Archived submission pages are not traversed in this version.

Successful records use a six-hour edge cache; failures use a one-minute cache. Refreshing the UI does not bypass that cache. Request starts are spaced by 550 ms per isolate, not globally. The local Node server has no edge cache. Broad multi-user traffic requires centralized ingestion, shared rate limits, and persistent snapshots before launch.

## Contributing

See [AGENTS.md](AGENTS.md) for engineering and public communication conventions. Pull requests should explain the change, the checks performed, and limitations without including private information.

## Primary documentation

- [SEC developer resources](https://www.sec.gov/about/developer-resources)
- [SEC EDGAR access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC Form 13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f)
- [Cloudflare Workers Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
