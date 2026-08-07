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
2. Determine the absolute path of the repository root (`git rev-parse --show-toplevel`).
   The server takes it as its first argument and reads everything it serves from there;
   there is no dashboard file to look for, because nothing is generated at onboard time.
3. If a dashboard server is already listening (check ports 4242 and 4243 as in the stop
   section), do not start a second one: report the URL it is already on.
4. Start the server from the plugin as a background task (Bash with run_in_background):

   node ${CLAUDE_PLUGIN_ROOT}/app/server.js <absolute repo root> 4242

   Always the plugin copy: `${CLAUDE_PLUGIN_ROOT}` is substituted on every run, so this
   command always reaches the installed version. There is no repo-local copy of the
   application to prefer, and `.claude/server/launcher.js` is not for this command: it
   exists only for the Claude Desktop `launch.json` surface, which performs no such
   substitution (D44).

   If port 4242 is taken (the server exits saying so), retry once with 4243 and use that
   port in the next step.
5. Open it in the browser: `open http://localhost:<port>` (macOS) or `xdg-open` (Linux).
6. Tell the user: the URL, that the page computes its data from the repository on demand
   and carries a refresh control that recomputes it (so nothing has to be re-run to see
   current data), and that they stop it with `/major-tom:dashboard stop`.

## stop

1. Find the process listening on port 4242, then 4243 (e.g.
   `lsof -ti tcp:4242 -sTCP:LISTEN`).
2. For each PID found, read its command line (`ps -p <pid> -o command=`) and verify it
   actually is this repository's dashboard server before touching it. Both of these must
   hold: the command line contains the path segment `app/server.js`, and it contains the
   absolute repository root path determined above, which the server takes as its argument.
   The basename `server.js` alone is far too common to identify anything, so never match on
   it by itself. If either check fails, do NOT kill the process: report that the port is in
   use by something else and leave it alone.
3. Kill only the PIDs that passed both checks, confirm they are gone, and report what was
   stopped. If nothing was listening, say the dashboard server is not running.
4. A server started from Claude Desktop runs underneath `.claude/server/launcher.js`, which
   exits on its own once the server it started is gone, so it needs no separate handling.
