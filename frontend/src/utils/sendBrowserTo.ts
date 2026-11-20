/**
 * Send the browser to another address, leaving the app.
 *
 * Its own module so tests can mock it: jsdom won't let a test replace or spy on
 * `window.location.assign`.
 */
export function sendBrowserTo(url: string): void {
  window.location.assign(url)
}
