/**
 * DSH admission for this plugin's HTTP bridge.
 *
 * The Host exposes its own fence as `connection.requestRejection(request)`: it
 * answers 403 when the Host/Origin fence rejects a caller (DNS rebinding and
 * cross-site calls), and 401 when the caller has neither the browser login
 * cookie nor an attached API token. Registering a `webServer` route does not
 * run that fence — "the caller admits the reader before reading" — so every
 * bridge handler asks here first, before it reads a file or writes one.
 *
 * `connection` exists only in a Web composition. Elsewhere (a TUI Host, a test
 * harness) no HTTP server is registered at all, so the lookup must stay quiet:
 * `ctx.get` is used instead of an `inject` entry, and any failure reading the
 * service is treated as absent. A service that is present but throws while
 * judging a request fails closed.
 */

/** Service name of the Host Connection service. */
export const CONNECTION_SERVICE = 'connection';

/**
 * Read the composition's Connection service without requiring it to exist.
 * @param ctx - the plugin context.
 * @returns the service, or undefined when this composition has no HTTP carrier.
 */
export function connectionOf(ctx) {
  try {
    return ctx?.get?.(CONNECTION_SERVICE);
  } catch {
    return undefined;
  }
}

/**
 * Ask DSH to admit one HTTP request.
 * @param ctx - the plugin context.
 * @param request - the Node request handed to the route.
 * @returns the HTTP status DSH wants sent, or undefined when the request is admitted.
 */
export function admissionRejection(ctx, request) {
  const connection = connectionOf(ctx);
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined;
  try {
    const rejection = connection.requestRejection(request);
    return typeof rejection === 'number' && Number.isInteger(rejection) ? rejection : undefined;
  } catch {
    return 401;
  }
}
