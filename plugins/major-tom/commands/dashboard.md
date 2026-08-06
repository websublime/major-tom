---
description: Serve the Major Tom dashboard of this repository (start, default) or stop the running server.
argument-hint: "[start|stop]"
---

Manage the Major Tom dashboard server for the current repository. The argument is:

$ARGUMENTS

Interpret it: empty or `start` means start; `stop` means stop; anything else, tell the
user the usage is `/major-tom:dashboard [start|stop]` and do nothing. Follow the matching
section exactly; do not improvise around a failed precondition.

## start

1. Read `.claude/major-tom.json`. If it does not exist, tell the user this repository is
   not onboarded yet and to run `/major-tom:onboard` first; stop here.
2. The dashboard file is `<persistence.root>/dashboard.html` (persistence.root comes from
   the config, normally `.knowledge`). If the file does not exist, tell the user to re-run
   `/major-tom:onboard` to generate it; stop here.
3. If a dashboard server is already listening (check ports 4242 and 4243 as in the stop
   section), do not start a second one: report the URL it is already on.
4. Pick the server file: `.claude/server/dashboard-server.js` when it exists (the copy the
   onboard writes, the same one Claude Desktop's launch.json uses, D32); otherwise fall
   back to `${CLAUDE_PLUGIN_ROOT}/templates/dashboard-server.js` and suggest re-running
   `/major-tom:onboard` to materialize the repo copy. Start it as a background task (Bash
   with run_in_background):

   node <server-file> <persistence.root>/dashboard.html 4242

   If port 4242 is taken (the server exits saying so), retry once with 4243 and use that
   port in the next step.
5. Open it in the browser: `open http://localhost:<port>` (macOS) or `xdg-open` (Linux).
6. Tell the user: the URL, that the page reads a data snapshot embedded at render time
   (re-running the onboard refreshes it; the server picks the new file up on browser
   refresh), and that they stop it with `/major-tom:dashboard stop`.

## stop

1. Find the process listening on port 4242, then 4243 (e.g.
   `lsof -ti tcp:4242 -sTCP:LISTEN`).
2. For each PID found, verify its command line actually is the dashboard server
   (`ps -p <pid> -o command=` contains `dashboard-server.js`) before touching it. If it is
   something else, do NOT kill it: report that the port is in use by another process and
   leave it alone.
3. Kill only the verified dashboard-server PIDs, confirm they are gone, and report what
   was stopped. If nothing was listening, say the dashboard server is not running.
