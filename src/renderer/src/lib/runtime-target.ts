// Which shell the renderer is running in. Kept in its own module (rather than beside
// the HTTP adapter) so that importing the flag from a view doesn't drag the web-only
// adapter into the Electron bundle.

/** True when built for the self-hosted web server; false for the Electron desktop build. */
export const IS_WEB_BUILD = import.meta.env.VITE_DCN_TARGET === 'web'
