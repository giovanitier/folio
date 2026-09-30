# Runtime configuration and verification

## Cloudflare Worker

Deploy this repository as the independent Worker named `folio`. `wrangler.jsonc` points to `server.mjs`, which wraps the SEC engine in `worker.mjs` and serves the `public` directory. No frontend build or database is required.

The optional build command is `npm run check && npm test`. The deploy command is `npx wrangler deploy`.

## SEC contact

The app deliberately makes no SEC requests without a valid contact setting. This is not a financial-data API key.

In **Cloudflare → Workers & Pages → folio → Settings → Variables and Secrets**, add a **Secret** named `SEC_USER_AGENT`. Its value must contain an application name and a real monitored contact email on a single line, for example `Folio/0.3 you@your-domain.com`. Replace the example address. Select **Deploy** to apply the runtime change.

Do not put the setting only in Build Variables. Build-time variables are not runtime bindings. Do not commit the contact value, put it in frontend configuration, or paste it into an issue.

CLI alternative, from this repository after authenticating with Cloudflare:

```sh
npx wrangler secret put SEC_USER_AGENT
```

For the lightweight Node development server:

```sh
SEC_USER_AGENT='Folio/0.3 <real-contact-email>' npm start
```

The Node server reads the process environment and loads an ignored `.dev.vars` file when present. Existing process values take precedence. Wrangler development also uses `.dev.vars`.

`keep_vars` preserves dashboard-managed variables during code deployment. Secrets remain runtime-only. Static assets pass through the Worker to receive a consistent content-security policy.

## Verification

1. `/api/health` must return version `0.3.0` and `secConfigured: true`. `upstream: not_checked` means this endpoint does not verify SEC access.
2. `/api/investors` returns the supported manager directory even without SEC configuration. It contains no holdings.
3. `/api/dashboard` must return at least one loaded manager before filing charts appear. Inspect `errors` for partial coverage. An all-source failure is HTTP 503, not a valid empty portfolio.
4. In **Data & sources**, inspect report periods, filing dates, source links, and checked timestamps. Cached manager reports can be up to six hours old.

A configured contact does not guarantee upstream access. SEC may reject hosted requests or be unavailable. HTTP 403/429 and unsupported filing structures must remain visible errors; do not hide them with sample data or bypass upstream restrictions. Cache and pacing are not a global ingestion service; high-traffic use still needs shared rate limits and centralized ingestion.

## Testing

```sh
npm run check
npm test
```

The Node suite covers the SEC parser, report comparison, connection diagnostics, privacy guards, filtering, chart denominators, and CSV escaping. Fixtures under `tests/` are synthetic and are never served by the Worker.

Offline Chromium DOM checks require Python Playwright and a local Chromium installation:

```sh
FOLIO_BROWSER=/path/to/chromium python checks/browser-offline.py
```

These checks inject local HTML/CSS/JavaScript with explicit fetch and storage test doubles. They verify interactions and layout at 1440px, 390px, and 320px. They do not verify native browser storage, deployed HTTP, production CSP enforcement, or live SEC access. Screenshots of chart states are labelled synthetic.

## References

- Cloudflare runtime secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Build and runtime settings: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- SEC data access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
