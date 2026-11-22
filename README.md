<p align="center">
  <a href="https://github.com/LingXiFox/t3code">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="LingXi T3 logo" />
  </a>
</p>

<h1 align="center">LingXi T3</h1>

<p align="center">基于 <a href="https://github.com/pingdotgg/t3code">T3 Code</a> 的独立个人分支版本 —— 面向编程智能体的开源控制平面，具备独立桌面应用身份、自动化上游同步以及签名多通道发布能力。</p>

<p align="center">
  <a href="https://github.com/LingXiFox/t3code/releases"><strong>发行版下载</strong></a> ·
  <a href="./docs/README.md">文档</a> ·
  <a href="https://github.com/LingXiFox/t3code/issues">问题反馈</a> ·
  <a href="https://github.com/pingdotgg/t3code">上游仓库 (pingdotgg/t3code)</a>
</p>

> **分支说明：** LingXi T3 是由 [LingXiFox](https://github.com/LingXiFox) 维护的独立个人分支，与 Ping Labs / T3 Tools 官方无隶属或背书关系。本项目完整保留 MIT 开源协议与上游署名，并将应用身份、本地用户数据目录与更新通道与官方 T3 Code 完全隔离。

LingXi T3 负责调度你本机上的各类编程智能体，并提供统一高速的控制界面。你可以在桌面端开启会话，随后在手机端随时审批下一步操作。

目前支持 Claude Code、Codex、Cursor、OpenCode、Grok Build、Antigravity（含原生 Orchestrator 预设）、DeepSeek Harness (`dsh`)、Kiro、Pi、Muse Code、fx 以及任意 [ACP](./docs/user/providers-acp.md) 智能体。只要你的电脑上已经配置好对应智能体，LingXi T3 即可直接驱动。

## 分支隔离与发布通道

- **独立桌面身份**：采用 `com.lingxifox.lingxit3`（`LingXi T3` / `LingXi T3 Nightly`）、独立 URL Scheme（`lingxit3://`、`lingxit3-dev://`）以及独立数据与配置目录（`~/.lingxi-t3`、`~/Library/Application Support/lingxi-t3`、`lingxi-t3`），绝不与官方 T3 Code 安装发生冲突。
- **分支策略**：
  - `main`：纯净镜像上游 `pingdotgg/t3code` 的 `main` 分支（不直接修改）。
  - `lingxifox`：默认主力开发分支，承载 LingXi T3 全部定制特性。
- **双通道更新**：
  - **稳定版 (`latest`)**：由通过验证的构建晋升发布（`latest-mac.yml`、`latest.yml`、`latest-linux.yml`、`latest-linux-arm64.yml`）。
  - **每夜版 (`nightly`)**：由 `LingXiFox/t3code` 发布的预发行构建（`nightly-mac.yml`、`nightly.yml`、`nightly-linux.yml`、`nightly-linux-arm64.yml`）。

## 核心特性

- **自带订阅，零加价。** LingXi T3 不转售 Token，直接驱动你本机已登录的智能体与订阅配额。
- **全智能体聚合工作台。** 随时在会话中切换模型或供应商，支持 Claude、Codex、DeepSeek Harness (`dsh --profile acp`)、Antigravity 等多后端协同工作。
- **LingXi 定制体验。** 内置 `LingXi Night Sky` 像素极光主题（狐橙 / 炭黑 / 奶白配色与像素赤狐水印）、6 平台额度与上下文/缓存监控中心（含 Antigravity 多号池视图与实时会话浮窗）。
- **桌面端、Web 端与移动端同步。** 一套本地或远端服务，全端实时同步会话状态。
- **随时随地远程控制。** 支持局域网、Tailscale 或 [T3 Connect](./docs/user/remote-access.md) 隧道远程连接你的开发机。
- **原生 Git 工作流。** 每个会话均可独立运行在专属 worktree 中，支持差异审阅与一键提交、推送及创建 PR。
- **极致性能。** 掉帧即缺陷，持续针对 WebSocket 吞吐与渲染帧率优化。
- **开源开放。** 基于 MIT 协议开源，衍生自 [pingdotgg/t3code](https://github.com/pingdotgg/t3code)。

## 安装使用

### 桌面客户端

前往 [LingXi T3 Releases](https://github.com/LingXiFox/t3code/releases) 下载对应 macOS、Windows 和 Linux 的签名安装包。

### 命令行安装

以下命令将从 `LingXiFox/t3code` 发行版安装 `t3` 命令行工具，运行 `t3` 即可启动服务并打开 Web 界面：

```bash
curl -fsSL https://raw.githubusercontent.com/LingXiFox/t3code/lingxifox/scripts/install.sh | sh
```

Windows PowerShell 安装方式：

```powershell
irm https://raw.githubusercontent.com/LingXiFox/t3code/lingxifox/scripts/install.ps1 | iex
```

### 登录至少一个智能体

LingXi T3 需要你本机已安装并登录至少一个编程智能体。例如安装 [Claude Code](https://claude.com/product/claude-code) 并执行 `claude auth login`，或安装 [Codex CLI](https://developers.openai.com/codex/cli) 并执行 `codex login`，也可直接使用已配置好的 DeepSeek Harness (`dsh`) 或 Antigravity (`agy`)。

详细配置请参阅 [Provider 配置指南](./docs/user/install.md#providers)，关于每夜版、AppImage、WSL 与 NixOS 安装说明请参阅 [安装指南](./docs/user/install.md)。

## 相关文档

- [安装与首次运行](./docs/user/install.md)
- [从手机或其他设备远程访问](./docs/user/remote-access.md)
- [权限模式说明](./docs/user/permission-modes.md)
- [源代码管理与 Git 工作流](./docs/user/source-control.md)
- [通过 MCP 接入外部智能体](./docs/user/outside-agents.md)
- [常见问题 (FAQ)](./docs/user/faq.md)

完整文档索引见 [全部文档](./docs/README.md)。

## 参与贡献

在提交 Issue 或 Pull Request 前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

- 本分支定制问题与 PR：[LingXiFox/t3code](https://github.com/LingXiFox/t3code/issues)（目标分支：`lingxifox`）。
- 上游 T3 Code 缺陷与特性讨论：[pingdotgg/t3code](https://github.com/pingdotgg/t3code)。
- 从源码构建请参考 [开发者运行手册](./docs/operations/00_development.md#first-checkout)，架构设计概览见 [架构说明](./docs/internals/01_architecture.md)。

## 开源协议

[MIT](./LICENSE) — Copyright © Ping Labs / T3 Code contributors，由 LingXiFox 维护独立个人分支修改。
