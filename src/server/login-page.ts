// The login screen served to unauthenticated browsers. Self-contained
// (inline CSS + a few lines of JS) so it needs nothing from the web build
// and renders in the Night City theme even if the bundle is missing.

export function loginPage(opts: { error?: string; idleMinutes: number }): string {
  const err = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:" />
<title>DCN Designer — locked</title>
<style>
  @font-face { font-family: "Rajdhani"; font-weight: 600; src: url("/fonts/rajdhani-600.woff2") format("woff2"); font-display: swap; }
  @font-face { font-family: "Rajdhani"; font-weight: 700; src: url("/fonts/rajdhani-700.woff2") format("woff2"); font-display: swap; }
  :root { --bg: oklch(0.15 0.022 275); --card: oklch(0.19 0.024 275); --fg: oklch(0.94 0.02 100);
          --muted: oklch(0.70 0.035 215); --yellow: oklch(0.92 0.20 105); --cyan: oklch(0.86 0.14 195);
          --hot: oklch(0.66 0.25 5); --border: oklch(0.86 0.14 195 / 22%); }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--fg); font: 600 16px/1.4 "Rajdhani", "Segoe UI", system-ui, sans-serif;
         letter-spacing: .02em; display: grid; place-items: center;
         background-image: repeating-linear-gradient(0deg, transparent 0 3px, oklch(0 0 0 / .09) 3px 4px); }
  .panel { width: min(420px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--border);
           clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
           box-shadow: inset 0 1px 0 0 color-mix(in oklch, var(--yellow) 40%, transparent); padding: 28px 28px 24px; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .brand .mark { width: 40px; height: 40px; background: var(--yellow); color: #0d0e1a; display: grid; place-items: center;
                 clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); }
  .brand h1 { font-size: 18px; margin: 0; text-transform: uppercase; letter-spacing: .18em; color: var(--yellow); }
  .brand small { display: block; color: var(--muted); font-size: 10px; letter-spacing: .2em; text-transform: uppercase; }
  label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .18em; color: var(--muted); margin-bottom: 6px; }
  input { width: 100%; height: 44px; background: transparent; border: 1px solid oklch(0.86 0.14 195 / 35%); color: var(--fg);
          font: inherit; font-size: 18px; padding: 0 12px; outline: none; }
  input:focus { border-color: var(--cyan); box-shadow: 0 0 0 1px var(--cyan); }
  button { margin-top: 16px; width: 100%; height: 44px; border: 0; background: var(--yellow); color: #0d0e1a; font: inherit;
           font-weight: 700; text-transform: uppercase; letter-spacing: .2em; cursor: pointer;
           clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }
  button:hover { filter: brightness(.92); }
  .err { color: var(--hot); margin: 12px 0 0; font-size: 14px; }
  .hint { color: var(--muted); font-size: 12px; margin: 18px 0 0; }
  .hazard { height: 4px; margin: 18px 0 0; background-image: repeating-linear-gradient(-45deg, var(--yellow) 0 8px, transparent 8px 16px); opacity: .6; }
</style>
</head>
<body>
  <form class="panel" method="post" action="/api/login" id="f">
    <div class="brand">
      <div class="mark">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="7" height="5" fill="currentColor"/><rect x="13" y="2" width="7" height="5" fill="currentColor"/>
          <rect x="1" y="15" width="5" height="5" fill="currentColor" opacity=".7"/><rect x="8.5" y="15" width="5" height="5" fill="currentColor" opacity=".7"/><rect x="16" y="15" width="5" height="5" fill="currentColor" opacity=".7"/>
          <path d="M5.5 7v3M16.5 7v3M5.5 10h11M3.5 15v-5M11 15v-5M18.5 15v-5" stroke="currentColor" stroke-width="1.2" opacity=".75"/>
        </svg>
      </div>
      <div><h1>DCN Designer</h1><small>// locked</small></div>
    </div>
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Unlock</button>
    ${err}
    <p class="hint">Session ends when you close the browser or after ${opts.idleMinutes} min idle. Use <b>Lock</b> in the top bar to end it now.</p>
    <div class="hazard"></div>
  </form>
  <script>
    // Progressive enhancement: post as JSON and reload in place; the plain
    // form POST above still works without JS.
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('p').value;
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (r.ok) { location.replace(location.pathname + location.search); return; }
      let msg = 'Wrong password';
      try { msg = (await r.json()).error || msg; } catch {}
      let el = document.querySelector('.err');
      if (!el) { el = document.createElement('p'); el.className = 'err'; document.querySelector('button').after(el); }
      el.textContent = msg;
      document.getElementById('p').select();
    });
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
