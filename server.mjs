import core, { INVESTORS, hasSecConfiguration } from './worker.mjs';

const VERSION = '0.3.0';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

export function configurationState(env = {}) {
  return hasSecConfiguration(env) ? 'configured' : env.SEC_USER_AGENT ? 'invalid' : 'missing';
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const path = new URL(request.url).pathname;
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    let response;
    if (path === '/api/health') {
      const state = configurationState(env);
      response = json({ ok: true, service: 'folio', version: VERSION, secConfigured: state === 'configured', configuration: state, upstream: 'not_checked', configuredInvestors: INVESTORS.length });
    } else if (path === '/api/investors') {
      response = json({ investors: INVESTORS, source: 'Tracked SEC filing managers', holdingsIncluded: false });
    } else if (path === '/api/dashboard' && !hasSecConfiguration(env)) {
      response = json({ code: 'SEC_NOT_CONFIGURED', configuration: configurationState(env), error: 'The SEC contact setting is missing or invalid.', requiredBinding: 'SEC_USER_AGENT', setupPath: '/#sources', investors: [], activity: [], consensus: [], errors: [] }, 503);
    } else {
      response = await core.fetch(request, env, ctx);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Folio-Version', VERSION);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-cache');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  }
};
