// Turns any Neuroglancer link into a desktop link and a Neuroglancer Mobile link.
// All Neuroglancer state lives in the URL fragment (`#!<json>` or `#!<json_url>`),
// so conversion keeps the fragment and swaps the app in front of it.

export const MOBILE_RELEASE = '2026-10-28-spelunker-v4';
export const MOBILE_BASE = `https://c10s.pni.princeton.edu/web/neuroglancer-mobile/${MOBILE_RELEASE}/index.html`;

export const DESKTOP_APPS = {
  spelunker: { label: 'Spelunker', base: 'https://spelunker.cave-explorer.org/' },
  'neuroglancer-demo': { label: 'neuroglancer-demo', base: 'https://neuroglancer-demo.appspot.com/' },
};

const MOBILE_PATH = '/web/neuroglancer-mobile/';

// Slack wraps links as <url> or <url|label>; people also paste with stray whitespace.
function unwrap(text) {
  let s = String(text ?? '').trim();
  const slack = /^<([^|>]+)(?:\|[^>]*)?>$/.exec(s);
  if (slack) s = slack[1].trim();
  return s.replace(/&amp;/g, '&');
}

function stateUrlFragment(url) {
  // A bare CAVE state-server link: open it through MiddleAuth like Spelunker's short links.
  return `#!${/^middleauth\+/.test(url) ? url : `middleauth+${url}`}`;
}

// Returns { fragment, sourceApp } where sourceApp is a DESKTOP_APPS key, 'mobile', 'other' or null.
export function parseLink(text) {
  const s = unwrap(text);
  if (!s) throw new Error('Paste a Neuroglancer link.');
  if (s.startsWith('{')) {
    let state;
    try { state = JSON.parse(s); } catch { throw new Error('That looks like JSON state but does not parse.'); }
    return { fragment: `#!${encodeURIComponent(JSON.stringify(state))}`, sourceApp: null };
  }
  if (s.startsWith('#')) return { fragment: s, sourceApp: null };
  if (/^middleauth\+https?:\/\//.test(s)) return { fragment: stateUrlFragment(s), sourceApp: null };
  let url;
  try { url = new URL(s); } catch { throw new Error('That is not a URL, a #! fragment or JSON state.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links can be converted.');
  if (!url.hash && /\/nglstate\//.test(url.pathname)) return { fragment: stateUrlFragment(s), sourceApp: null };
  const hashAt = s.indexOf('#');
  const fragment = hashAt < 0 ? '' : s.slice(hashAt);
  let sourceApp = 'other';
  for (const [key, app] of Object.entries(DESKTOP_APPS)) if (url.host === new URL(app.base).host) sourceApp = key;
  if (url.host === 'c10s.pni.princeton.edu' && url.pathname.startsWith(MOBILE_PATH)) sourceApp = 'mobile';
  return { fragment, sourceApp };
}

// desktopApp: a DESKTOP_APPS key, or 'auto' to keep a known desktop app from the input (else Spelunker).
export function convert(text, desktopApp = 'auto') {
  const { fragment, sourceApp } = parseLink(text);
  const key = desktopApp !== 'auto' ? desktopApp : sourceApp in DESKTOP_APPS ? sourceApp : 'spelunker';
  const app = DESKTOP_APPS[key];
  if (!app) throw new Error(`Unknown desktop app ${desktopApp}.`);
  return { desktop: app.base + fragment, desktopApp: key, mobile: MOBILE_BASE + fragment, sourceApp, hasState: fragment.length > 2 };
}
