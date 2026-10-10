# Scheduler service examples

These files are templates. The installer does not register them or request administrator rights.

- Linux user systemd: `config/services/toonforge-scheduler.service`
- macOS user LaunchAgent template: `config/services/com.toonforge.scheduler.plist` (copy into `~/Library/LaunchAgents` yourself)
- Windows Task Scheduler template: `config/services/toonforge-scheduler-task.xml` (register it yourself; do not put OAuth tokens in the XML)

A container restart policy is an alternative. See `docs/deployment.md`. The scheduler state lives in `TOONFORGE_DATA_DIR/scheduler` and must be on persistent storage.
