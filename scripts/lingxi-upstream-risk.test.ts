import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  assessRepositoryUpstreamRisk,
  assessUpstreamRisk,
  parseGitNameStatus,
} from "./lingxi-upstream-risk.ts";

describe("lingxi-upstream-risk", () => {
  it("parses git diff --name-status lines including renames and copies", () => {
    const parsed = parseGitNameStatus(
      [
        "M\tapps/web/src/components/ChatView.tsx",
        "A\tdocs/user/new-guide.md",
        "D\tpackages/shared/src/unused.ts",
        "R100\tapps/web/src/oldName.ts\tapps/web/src/newName.ts",
      ].join("\n"),
    );

    assert.deepStrictEqual(parsed, [
      { status: "M", path: "apps/web/src/components/ChatView.tsx" },
      { status: "A", path: "docs/user/new-guide.md" },
      { status: "D", path: "packages/shared/src/unused.ts" },
      {
        status: "R100",
        previousPath: "apps/web/src/oldName.ts",
        path: "apps/web/src/newName.ts",
      },
    ]);
  });

  it("marks pure docs/UI upstream changes without fork overlap as low risk", () => {
    const result = assessUpstreamRisk({
      upstreamFiles: [
        { status: "M", path: "apps/web/src/components/ChatView.tsx" },
        { status: "M", path: "docs/user/source-control.md" },
      ],
      forkFiles: ["scripts/lingxi-release-source.ts", "README.md"],
    });

    assert.equal(result.riskLevel, "low");
    assert.isFalse(result.requiresManualReview);
    assert.deepStrictEqual(result.findings, []);
    assert.include(result.markdownSummary, "LOW RISK");
  });

  it("flags each high-risk category and fork overlaps/deletions", () => {
    const result = assessUpstreamRisk({
      upstreamFiles: [
        { status: "M", path: "apps/desktop/src/updates/DesktopUpdates.ts" },
        { status: "A", path: "apps/server/src/persistence/Migrations/106_Example.ts" },
        { status: "M", path: "packages/provider-cursor/src/server/adapter.ts" },
        { status: "M", path: "apps/server/src/orchestration-v2/Orchestrator.ts" },
        { status: "D", path: "apps/web/src/components/ForkCustomWidget.tsx" },
      ],
      forkFiles: ["apps/web/src/components/ForkCustomWidget.tsx"],
    });

    assert.equal(result.riskLevel, "high");
    assert.isTrue(result.requiresManualReview);
    assert.deepStrictEqual(
      result.findings.map((finding) => finding.category),
      [
        "release-and-updater",
        "database-migration",
        "auth-security-provider",
        "core-agent-orchestration",
        "fork-overlap-or-deletion",
      ],
    );
    assert.include(result.markdownSummary, "HIGH RISK");
    assert.include(
      result.markdownSummary,
      "[deleted] apps/web/src/components/ForkCustomWidget.tsx",
    );
  });

  it("evaluates low-risk and high-risk upstream deltas against a real git repository", () => {
    const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lingxi-risk-git-"));
    const run = (args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();

    try {
      run(["init", "-b", "main"]);
      run(["config", "user.name", "LingXi Test"]);
      run(["config", "user.email", "test@lingxifox.dev"]);

      NodeFS.mkdirSync(NodePath.join(repoRoot, "apps/web/src"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(repoRoot, "apps/web/src/App.tsx"), "v1\n", "utf8");
      run(["add", "."]);
      run(["commit", "-m", "chore: base"]);
      const baseSha = run(["rev-parse", "HEAD"]);

      run(["checkout", "-b", "lingxifox"]);
      NodeFS.writeFileSync(NodePath.join(repoRoot, "LINGXI.md"), "fork\n", "utf8");
      run(["add", "LINGXI.md"]);
      run(["commit", "-m", "feat(lingxi): custom doc"]);

      run(["checkout", "main"]);
      NodeFS.writeFileSync(NodePath.join(repoRoot, "apps/web/src/App.tsx"), "v2\n", "utf8");
      run(["add", "."]);
      run(["commit", "-m", "fix(web): low risk ui tweak"]);
      const lowRiskUpstreamSha = run(["rev-parse", "HEAD"]);

      run(["checkout", "-b", "candidate", "lingxifox"]);
      run(["rebase", lowRiskUpstreamSha]);

      const lowRisk = assessRepositoryUpstreamRisk({
        repoRoot,
        baseRef: baseSha,
        upstreamRef: lowRiskUpstreamSha,
        candidateRef: "candidate",
      });
      assert.equal(lowRisk.riskLevel, "low");
      assert.isFalse(lowRisk.requiresManualReview);

      run(["checkout", "main"]);
      NodeFS.mkdirSync(NodePath.join(repoRoot, "apps/server/src/persistence/Migrations"), {
        recursive: true,
      });
      NodeFS.writeFileSync(
        NodePath.join(repoRoot, "apps/server/src/persistence/Migrations/106_New.ts"),
        "export const m = 106;\n",
        "utf8",
      );
      run(["add", "."]);
      run(["commit", "-m", "feat(server): add migration"]);
      const highRiskUpstreamSha = run(["rev-parse", "HEAD"]);

      run(["checkout", "candidate"]);
      run(["rebase", highRiskUpstreamSha]);

      const highRisk = assessRepositoryUpstreamRisk({
        repoRoot,
        baseRef: baseSha,
        upstreamRef: highRiskUpstreamSha,
        candidateRef: "candidate",
      });
      assert.equal(highRisk.riskLevel, "high");
      assert.isTrue(highRisk.requiresManualReview);
      assert.equal(highRisk.findings[0]?.category, "database-migration");
    } finally {
      NodeFS.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
