# zyxel-nr5101-watchdog

Node.js watchdog for a Zyxel NR5101 gateway. It signs in to the gateway UI, reads the visible connection state, runs a TCP connectivity probe when the UI reports healthy long enough, and only requests a reboot when the connection is clearly down or the healthy UI cannot pass the outbound probe.

## Install

```bash
npm install
```

Create a local secrets file from the example:

```bash
cp config/secrets.example.json config/secrets.json
```

Edit `config/secrets.json` with the local gateway URL, username, and password. `config/secrets.json` is ignored by git. Do not put real credentials in committed files or logs.

## Commands

```bash
npx zyxel-nr5101-watchdog check --config config/secrets.json
npx zyxel-nr5101-watchdog reboot --config config/secrets.json
npx zyxel-nr5101-watchdog watch --config config/secrets.json
npx zyxel-nr5101-watchdog help
```

`check` signs in, reads status, and prints a JSON decision without rebooting.

`reboot` performs the same check and only clicks the UI reboot flow when the watchdog decision allows it.

`watch` runs continuously, waiting `checkIntervalMs` between checks.

`help` prints the JSON usage payload without loading configuration.

## Docker

Build the local image:

```bash
docker build -t zyxel-nr5101-watchdog:local .
```

Run a safe non-rebooting check from Docker:

```bash
mkdir -p var
docker run --rm \
  --network host \
  -v "$PWD/config/secrets.json:/app/config/secrets.json:ro" \
  -v "$PWD/var:/app/var" \
  zyxel-nr5101-watchdog:local check --config /app/config/secrets.json
```

Run the watchdog continuously from Docker:

```bash
mkdir -p var
docker run -d \
  --name zyxel-nr5101-watchdog \
  --restart unless-stopped \
  --network host \
  -v "$PWD/config/secrets.json:/app/config/secrets.json:ro" \
  -v "$PWD/var:/app/var" \
  zyxel-nr5101-watchdog:local
```

Or use Docker Compose:

```bash
docker compose up -d
```

The Docker image includes Node.js, Chromium, and ChromeDriver so the existing `system-testing` browser automation can run inside the container. The examples mount `config/secrets.json` instead of baking credentials into the image. The `docker run` examples mount `var/` so reboot cooldown state survives container restarts; create that host directory before running the container. Docker Compose uses a named `watchdog-state` volume for the same state so fresh Compose starts are writable by the container user.

`--network host` is recommended on Linux so the container reaches the gateway UI and runs the connectivity probe through the host's normal LAN/default route. Docker Desktop on macOS and Windows handles host networking differently; if the router IP is reachable from normal bridge networking there, omit `--network host` and keep the same volume mounts.

## Configuration

Required fields:

- `uiUrl`: gateway UI URL, for example `http://192.168.86.3`
- `username`: gateway UI username
- `password`: gateway UI password

Safety timing fields:

- `checkIntervalMs`: delay between `watch` checks
- `rebootCooldownMs`: minimum time between successful watchdog reboots
- `bootGracePeriodMs`: gateway uptime below this value blocks reboot for non-healthy UI states
- `connectivityProbeMinimumUptimeMs`: healthy gateway uptime required before the outbound probe can trigger reboot
- `minimumUptimeBeforeRebootMs`: optional stricter uptime gate before rebooting
- `statePath`: local JSON file storing the last successful reboot timestamp

Connectivity probe fields:

- `connectivityProbeHost`: TCP host to connect to through the default route, default `1.1.1.1`
- `connectivityProbePort`: TCP port to connect to, default `443`
- `connectivityProbeTimeoutMs`: TCP connection timeout, default `5000`

Discovery fields:

- `selectors`: optional discovered UI selectors for login, status, uptime, and reboot controls
- `labels`: text labels used to classify healthy, down, and establishing states

## Reboot Safety

The watchdog will not reboot when:

- the UI cannot be reached
- login fails
- the connection is healthy
- the UI says the connection is connecting, establishing, booting, initializing, or registering
- the UI does not report healthy/up and uptime is inside `bootGracePeriodMs`
- the UI reports healthy/up but uptime is below `connectivityProbeMinimumUptimeMs`
- uptime is below `minimumUptimeBeforeRebootMs`
- `rebootCooldownMs` has not elapsed since the last successful watchdog reboot
- the status is unknown

The gateway UI can still be reachable while the Internet connection is down. This tool uses the UI reachability only as a precondition for safe inspection and reboot control, not as proof that Internet access is healthy. When the UI reports healthy/up for at least `connectivityProbeMinimumUptimeMs`, the watchdog opens a TCP connection to `connectivityProbeHost:connectivityProbePort`; a failed probe is treated as `connectivity_probe_failed` and can trigger the same reboot flow as a clearly down UI status.

## Browser Automation

Runtime browser automation uses the `system-testing` package directly via its `Browser` API. Watchdog decisions stay behind `SystemTestingUiSession`, so config and reboot logic are tested without launching a real browser.

## Logs

Commands print JSON lines to stdout. The output includes the command and watchdog decision. Passwords are never printed by the application.

## Long-Lived Operation

Run `watch` from a process manager such as systemd, cron with locking, or another supervisor. Use the same project directory so `statePath` resolves consistently, or set `statePath` to an absolute path in `config/secrets.json`.

## Development

Run focused Velocious specs while changing behavior:

```bash
npx velocious test -- spec/watchdog-spec.js
```

Run static checks before finishing changes:

```bash
npm run lint
```

Release a patch version from `master`:

```bash
npm run release:patch
```

The patch release script bumps the package version, commits the version files, pushes `master`, and publishes to npm.
