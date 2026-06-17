# zyxel-nr5101-watchdog

Node.js watchdog for a Zyxel NR5101 gateway. It signs in to the gateway UI, reads the visible connection state, and only requests a reboot when the connection is clearly down and startup/connection-establishing states are absent.

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
```

`check` signs in, reads status, and prints a JSON decision without rebooting.

`reboot` performs the same check and only clicks the UI reboot flow when the watchdog decision allows it.

`watch` runs continuously, waiting `checkIntervalMs` between checks.

## Configuration

Required fields:

- `uiUrl`: gateway UI URL, for example `http://192.168.86.3`
- `username`: gateway UI username
- `password`: gateway UI password

Safety timing fields:

- `checkIntervalMs`: delay between `watch` checks
- `rebootCooldownMs`: minimum time between successful watchdog reboots
- `bootGracePeriodMs`: gateway uptime below this value blocks reboot
- `minimumUptimeBeforeRebootMs`: optional stricter uptime gate before rebooting
- `statePath`: local JSON file storing the last successful reboot timestamp

Discovery fields:

- `selectors`: optional discovered UI selectors for login, status, uptime, and reboot controls
- `labels`: text labels used to classify healthy, down, and establishing states

## Reboot Safety

The watchdog will not reboot when:

- the UI cannot be reached
- login fails
- the connection is healthy
- the UI says the connection is connecting, establishing, booting, initializing, or registering
- uptime is inside `bootGracePeriodMs`
- uptime is below `minimumUptimeBeforeRebootMs`
- `rebootCooldownMs` has not elapsed since the last successful watchdog reboot
- the status is unknown

The gateway UI can still be reachable while the Internet connection is down. This tool uses the UI reachability only as a precondition for safe inspection and reboot control, not as proof that Internet access is healthy.

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
