<p align="center">
  <a href="https://github.com/LingXiFox/t3code">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="LingXi T3 logo" />
  </a>
</p>

<h1 align="center">LingXi T3</h1>

<p align="center">Independent personal fork of <a href="https://github.com/pingdotgg/t3code">T3 Code</a> — an open-source control plane for coding agents, with isolated desktop identity, automated upstream sync, and signed multi-channel releases.</p>

<p align="center">
  <a href="https://github.com/LingXiFox/t3code/releases"><strong>Releases</strong></a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://github.com/LingXiFox/t3code/issues">Issues</a> ·
  <a href="https://github.com/pingdotgg/t3code">Upstream (pingdotgg/t3code)</a>
</p>

> **Fork Notice:** LingXi T3 is an independent personal fork maintained by [LingXiFox](https://github.com/LingXiFox) and is not affiliated with or endorsed by Ping Labs / T3 Tools. It preserves the MIT license and upstream attribution while isolating application identity, user data, and update channels from official T3 Code.

LingXi T3 runs the coding agents on your machine and gives them one fast interface. Start a thread at your desk, then approve the next step from your phone.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. If an agent is set up on your computer, LingXi T3 can control it.

## Fork Isolation & Release Channels

- **Isolated Desktop Identity:** Uses `com.lingxifox.lingxit3` (`LingXi T3` / `LingXi T3 Nightly`), custom URL schemes (`lingxit3://`, `lingxit3-dev://`), and separate local data/config directories (`~/.lingxi-t3`, `~/Library/Application Support/lingxi-t3`, `lingxi-t3`) so it never collides with official T3 Code installs.
- **Branch Strategy:**
  - `main`: clean mirror of `pingdotgg/t3code` `main` (never modified directly).
  - `lingxifox`: default active branch carrying LingXi T3 customizations.
- **Dual Update Channels:**
  - **Stable (`latest`)**: promoted from verified builds (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`).
  - **Nightly (`nightly`)**: prerelease builds (`nightly-mac.yml`, `nightly.yml`, `nightly-linux.yml`, `nightly-linux-arm64.yml`) published from `LingXiFox/t3code`.

## What you get

- **Your subscriptions.** LingXi T3 does not resell tokens. It drives the agents you are already signed in to.
- **Every agent in one place.** Change models in the middle of a thread. Let Claude hand a task to Codex.
- **Desktop, web, and phone.** One server, and every client shows the same threads.
- **Remote ready.** Run agents on any machine. Connect over your local network, Tailscale, or [T3 Connect](./docs/user/remote-access.md).
- **Git built in.** Each thread can work in its own worktree. Review the diff, then commit, push, and open a pull request with one button.
- **Fast.** Performance is a feature here. We measure it, and we treat a dropped frame as a bug.
- **Open.** MIT licensed, forked from [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

## Install

### Desktop app

Download signed installers for macOS, Windows, and Linux from [LingXi T3 Releases](https://github.com/LingXiFox/t3code/releases).

### Command line

This installs the `t3` command from `LingXiFox/t3code` releases. Run `t3` to start the server and open the web app.

```bash
curl -fsSL https://raw.githubusercontent.com/LingXiFox/t3code/lingxifox/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/LingXiFox/t3code/lingxifox/scripts/install.ps1 | iex
```

### Sign in to an agent

LingXi T3 needs one agent that is installed and signed in. For example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.

[Provider setup](./docs/user/install.md#providers) has the steps for each agent. [Install T3 Code](./docs/user/install.md) covers nightly builds, AppImage, WSL, and NixOS.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request.

- Fork-specific issues and PRs: [LingXiFox/t3code](https://github.com/LingXiFox/t3code/issues) (target branch: `lingxifox`).
- Upstream T3 Code bugs and feature discussions: [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
- Build from source with the [development runbook](./docs/operations/00_development.md#first-checkout). The [architecture overview](./docs/internals/01_architecture.md) explains how it works.

## License

[MIT](./LICENSE) — Copyright © Ping Labs / T3 Code contributors, with independent fork modifications by LingXiFox.
