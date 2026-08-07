// Transport, and nothing else (D43 point 7). This module talks to the server the page was
// served from and hands back a plain result object; no derivation, no state and no DOM live
// here. Everything downstream reads `ok` first and never has to reason about HTTP.
//
// The two routes are the whole client-facing contract of the server:
//
//   GET /api/snapshot?days=&limit=   the snapshot for the served repository, over a window
//   GET /api/knowledge/body?id=<id>  the body of the one concept that id addresses
//
// Both are same origin and both are read-only, so no base URL is configurable here: a
// configurable origin would be a way to point this page at a server it was not served by,
// which is surface nobody asked for.
//
// Failure is a value, never an exception. Every path below resolves, never rejects, with
// `{ ok: false, route, status, error }`, and the error string is the one the server sent
// whenever it sent one (the server answers a refused input with `{ error: "<message>" }`,
// which is the message the user actually needs). This matters more here than it usually
// would: D43 point 2 dropped the degraded path, so a failed fetch has no embedded data to
// fall back on and the message is the only thing the page can show.

export const SNAPSHOT_ROUTE = '/api/snapshot'
export const BODY_ROUTE = '/api/knowledge/body'

function describe(e) {
  return e && e.message ? String(e.message) : String(e)
}

// The first line of a non-JSON error body, clipped. Our server never takes this path: it
// answers every failure, the 404s and the 405 included, as JSON `{error}`, so the branch above
// reads the served message instead. This exists for a body that is not JSON at all, which
// means something other than our server produced it (a proxy, a captive portal, a stray HTML
// error page). Such a body is worth one clipped line as a clue and no more, hence the clip.
function firstLine(text) {
  const line = String(text == null ? '' : text).split('\n')[0].trim()
  return line.length > 200 ? line.slice(0, 200) + '...' : line
}

// One request, one result object. Reads the body as text first and parses it here rather than
// calling res.json(), because the error path needs the raw text when the body is not JSON and
// res.json() would have consumed the stream by then.
function requestJson(route) {
  let status = 0
  return fetch(route, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(function (res) {
      status = res.status
      return res.text().then(function (text) {
        return { ok: res.ok, text: text }
      })
    })
    .then(function (res) {
      let parsed = false
      let payload = null
      let parseError = ''
      try {
        payload = JSON.parse(res.text)
        parsed = true
      } catch (e) {
        parseError = describe(e)
      }
      const served = parsed && payload !== null && typeof payload === 'object'
        && typeof payload.error === 'string' && payload.error !== '' ? payload.error : ''
      if (!res.ok) {
        const body = firstLine(res.text)
        return {
          ok: false, route: route, status: status,
          error: served || (body
            ? 'the server answered HTTP ' + status + ': ' + body
            : 'the server answered HTTP ' + status + ' with an empty body')
        }
      }
      if (!parsed) {
        return {
          ok: false, route: route, status: status,
          error: 'the server answered HTTP ' + status + ' with a body that is not JSON (' + parseError + ')'
        }
      }
      return { ok: true, route: route, status: status, data: payload }
    })
    .catch(function (e) {
      // No response at all: the server is not running, was stopped mid-session, or the
      // connection failed. Naming the origin matters, because the usual cause is that the
      // process behind it is gone and the user is the one who has to start it again.
      return {
        ok: false, route: route, status: status,
        error: 'the request to ' + route + ' did not complete (' + describe(e) + ')'
      }
    })
}

// The whole snapshot. Recomputed by the server on every call, so this is equally the load
// request and the refresh request: D43 point 5's explicit recompute is this same request
// issued again, and there is no separate verb to call.
//
// `win` is the window of D45: null when the reader has chosen none, in which case no parameter
// travels and the server applies the configured default, or an object carrying both `days` and
// `limit`. This is the one place the query is built, and it is built from both keys or from
// neither, which is what makes the two parameters travel together by construction rather than
// by discipline: there is no path through this function that puts one of them on the wire
// without the other. That is D45 point 4 at the client layer, and D42 is why it matters, both
// streams being cut by one window; a request that moved only one would recreate exactly the
// ragged reading D42 was written to prevent.
//
// The values go out as the reader typed them, never coerced and never clamped here. The bounds
// are the server's and it refuses rather than clamps (D45 point 2), so a copy of them in this
// file would be a second source of truth for one rule, and worse, it would replace the server's
// own sentence, which names the parameter, the value received and the accepted range, with a
// guess made here.
export function fetchSnapshot(win) {
  if (win === null || win === undefined) return requestJson(SNAPSHOT_ROUTE)
  return requestJson(SNAPSHOT_ROUTE
    + '?days=' + encodeURIComponent(String(win.days == null ? '' : win.days))
    + '&limit=' + encodeURIComponent(String(win.limit == null ? '' : win.limit)))
}

// The body of one concept, addressed by the opaque id its listing entry carries. The id is
// minted by the server and never built here, so the client holds no knowledge path at all.
export function fetchKnowledgeBody(id) {
  return requestJson(BODY_ROUTE + '?id=' + encodeURIComponent(String(id == null ? '' : id)))
}
