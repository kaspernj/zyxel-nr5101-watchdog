# Project Notes

- This project is a Zyxel NR5101-specific Node.js watchdog.
- Use `zyxel-nr5101-watchdog` for the folder, npm package name, and CLI binary name.
- The user intentionally overrode the earlier generic package-name guidance; product-specific naming is required here.
- Use the `system-testing` npm package directly for browser automation. Do not use the `system-testing` CLI for the watchdog runtime unless the user explicitly asks for CLI-driven browser control. Do not use Playwright or Puppeteer directly unless `system-testing` does so internally.
- Keep browser automation behind an interface so watchdog decisions can be tested without launching a browser.
- Store credentials only in a local config/secrets file. Do not hardcode usernames/passwords and do not log passwords.
- Do not perform a real UI reboot during discovery or validation unless the user explicitly approves that exact action.
- Follow test-first development for watchdog behavior and config loading.
