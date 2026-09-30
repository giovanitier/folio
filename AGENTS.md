# Repository guidance

## Scope

Folio is a standalone, read-only SEC filing tracker. Keep code, deployment configuration, and release automation self-contained in this repository. Do not reuse or modify another application's repository, deployment, domains, or secrets.

## Public communication

Treat every commit, pull request, issue, source comment, document, and screenshot as public.

- Describe changes in terms of product behavior, implementation, validation, and known limitations.
- Never copy private conversations, prompts, personal feedback, private notes, account information, or credentials into repository content or metadata.
- Use neutral, concise commit subjects such as `feat: add filing comparison` or `fix: preserve option positions`.
- PR descriptions should cover Summary, Validation, and Limitations. Report only checks actually executed. Distinguish tests from live upstream verification.
- Use synthetic fixtures and reserved example domains in tests. Redact identifying information from logs and screenshots before publishing.
- Review the complete diff and commit metadata before pushing. Do not import unrelated Git history. Use the contributor's configured public or GitHub no-reply identity, never an address inferred from private context.

## Engineering

- Run `npm run check` and `npm test` before publishing application changes.
- Keep SEC contact configuration server-side. Never include a default personal contact or credentials in source code.
- Do not invent holdings, live prices, portfolio returns, or execution times.
- Preserve report periods, source links, quantity units, and explicit error states.
- Filing changes are not trade executions. Fail conservatively on unsupported amendments or missing quarters.
- Do not add brokerage execution or cross-product account integrations without an explicit specification.
- Keep secrets out of Git; use local ignored configuration and deployment secret storage.
