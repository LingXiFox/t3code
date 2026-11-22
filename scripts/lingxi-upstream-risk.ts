import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export type RiskCategory =
  | "release-and-updater"
  | "database-migration"
  | "auth-security-provider"
  | "core-agent-orchestration"
  | "fork-overlap-or-deletion";

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string | undefined;
}

export interface RiskFinding {
  readonly category: RiskCategory;
  readonly summary: string;
  readonly files: ReadonlyArray<string>;
}

export interface UpstreamRiskAssessment {
  readonly riskLevel: "low" | "high";
  readonly requiresManualReview: boolean;
  readonly upstreamFileCount: number;
  readonly findings: ReadonlyArray<RiskFinding>;
  readonly markdownSummary: string;
}

interface CategorySpec {
  readonly category: RiskCategory;
  readonly summary: string;
  readonly matches: (filePath: string) => boolean;
}

const CATEGORY_SPECS: ReadonlyArray<CategorySpec> = [
  {
    category: "release-and-updater",
    summary: "Release, signing, workflow, or desktop/CLI updater logic changed upstream",
    matches: (filePath) =>
      filePath.startsWith(".github/workflows/") ||
      filePath.startsWith("scripts/build-desktop-artifact") ||
      filePath.startsWith("scripts/verify-macos-") ||
      filePath.startsWith("scripts/merge-release-update-manifests") ||
      filePath.startsWith("scripts/merge-update-manifests") ||
      filePath.startsWith("scripts/lingxi-") ||
      filePath.startsWith("scripts/prepare-server-compile-cache") ||
      filePath.startsWith("patches/electron-updater") ||
      filePath.startsWith("patches/app-builder-lib") ||
      filePath.startsWith("apps/desktop/src/updates/") ||
      filePath.startsWith("apps/desktop/src/electron/ElectronUpdater") ||
      filePath.startsWith("apps/desktop/src/app/DesktopEnvironment") ||
      filePath.startsWith("apps/desktop/src/app/DesktopConfig") ||
      filePath === "apps/desktop/package.json" ||
      filePath.startsWith("apps/server/src/cloud/npmRelease") ||
      filePath.startsWith("packages/shared/src/cliRelease") ||
      filePath.startsWith("apps/web/src/components/settings/UpdateTrackSwitchDialog") ||
      filePath.startsWith("apps/web/src/components/settings/updateTrackSwitch") ||
      filePath.startsWith("apps/web/src/components/desktopUpdate"),
  },
  {
    category: "database-migration",
    summary: "Server persistence schema, SQLite store, or database migrations changed upstream",
    matches: (filePath) =>
      filePath.startsWith("apps/server/src/persistence/Migrations/") ||
      filePath.startsWith("apps/server/src/persistence/Sqlite") ||
      filePath.startsWith("apps/server/src/persistence/Services/"),
  },
  {
    category: "auth-security-provider",
    summary: "Provider adapter, auth, permission, or security boundary changed upstream",
    matches: (filePath) =>
      filePath.startsWith("packages/provider-") ||
      filePath.startsWith("apps/server/src/auth/") ||
      filePath.startsWith("apps/server/src/provider/") ||
      filePath.startsWith("apps/server/src/security/") ||
      filePath.startsWith("packages/contracts/src/auth") ||
      filePath.startsWith("packages/contracts/src/rpc") ||
      filePath === "SECURITY.md" ||
      filePath === ".github/SECURITY.md",
  },
  {
    category: "core-agent-orchestration",
    summary: "Core agent orchestration or orchestration contracts changed upstream",
    matches: (filePath) =>
      filePath.startsWith("apps/server/src/orchestration") ||
      filePath.startsWith("packages/contracts/src/orchestration"),
  },
];

export function parseGitNameStatus(output: string): ReadonlyArray<ChangedFile> {
  const results: Array<ChangedFile> = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (!status) continue;
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      results.push({
        status,
        previousPath: parts[1],
        path: parts[2] ?? parts[1] ?? "",
      });
    } else if (parts[1]) {
      results.push({
        status,
        path: parts[1],
      });
    }
  }
  return results;
}

function renderRiskMarkdownSummary(options: {
  readonly baseSha?: string | undefined;
  readonly upstreamSha?: string | undefined;
  readonly candidateSha?: string | undefined;
  readonly upstreamFileCount: number;
  readonly findings: ReadonlyArray<RiskFinding>;
}): string {
  const requiresManualReview = options.findings.length > 0;
  const lines: Array<string> = [
    "### Upstream Sync Risk Assessment",
    "",
    `- **Verdict**: ${
      requiresManualReview
        ? "HIGH RISK — manual review required (auto-sync blocked)"
        : "LOW RISK — eligible for auto-sync"
    }`,
    `- **Upstream changed files**: ${options.upstreamFileCount}`,
  ];
  if (options.baseSha) {
    lines.push(`- **Base SHA**: \`${options.baseSha}\``);
  }
  if (options.upstreamSha) {
    lines.push(`- **Upstream SHA**: \`${options.upstreamSha}\``);
  }
  if (options.candidateSha) {
    lines.push(`- **Candidate SHA**: \`${options.candidateSha}\``);
  }

  if (!requiresManualReview) {
    lines.push("", "No high-risk upstream paths or fork overlaps were detected.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "#### Risk Findings");
  for (const finding of options.findings) {
    lines.push(
      "",
      `- **\`${finding.category}\`** (${finding.files.length} files): ${finding.summary}`,
    );
    for (const file of finding.files.slice(0, 20)) {
      lines.push(`  - \`${file}\``);
    }
    if (finding.files.length > 20) {
      lines.push(`  - ...and ${finding.files.length - 20} more`);
    }
  }

  lines.push(
    "",
    "#### Recovery / Manual Review",
    "1. Inspect the flagged upstream changes above against LingXi fork customizations.",
    "2. Rebase `lingxifox` onto `upstream/main` locally and run `pnpm exec vp run check:changed`.",
    "3. Push the reviewed `lingxifox` branch after verifying CI passes.",
  );

  return `${lines.join("\n")}\n`;
}

export function assessUpstreamRisk(options: {
  readonly upstreamFiles: ReadonlyArray<ChangedFile>;
  readonly forkFiles: ReadonlyArray<string>;
  readonly upstreamSha?: string | undefined;
  readonly baseSha?: string | undefined;
  readonly candidateSha?: string | undefined;
}): UpstreamRiskAssessment {
  const forkFileSet = new Set(options.forkFiles);
  const grouped = new Map<RiskCategory, Set<string>>();

  const addFinding = (category: RiskCategory, label: string) => {
    let bucket = grouped.get(category);
    if (!bucket) {
      bucket = new Set<string>();
      grouped.set(category, bucket);
    }
    bucket.add(label);
  };

  for (const change of options.upstreamFiles) {
    const candidatePaths = change.previousPath ? [change.path, change.previousPath] : [change.path];

    for (const spec of CATEGORY_SPECS) {
      if (candidatePaths.some((candidate) => spec.matches(candidate))) {
        addFinding(spec.category, change.path);
      }
    }

    const overlapsFork = candidatePaths.some((candidate) => forkFileSet.has(candidate));
    if (overlapsFork) {
      const prefix = change.status.startsWith("D")
        ? "[deleted] "
        : change.status.startsWith("R")
          ? `[renamed from ${change.previousPath ?? "?"}] `
          : "";
      addFinding("fork-overlap-or-deletion", `${prefix}${change.path}`);
    }
  }

  const findings: Array<RiskFinding> = [];
  for (const spec of CATEGORY_SPECS) {
    const files = grouped.get(spec.category);
    if (files && files.size > 0) {
      findings.push({
        category: spec.category,
        summary: spec.summary,
        files: [...files].toSorted(),
      });
    }
  }

  const overlapFiles = grouped.get("fork-overlap-or-deletion");
  if (overlapFiles && overlapFiles.size > 0) {
    findings.push({
      category: "fork-overlap-or-deletion",
      summary: "Upstream deleted, renamed, or modified files also touched by LingXi fork commits",
      files: [...overlapFiles].toSorted(),
    });
  }

  const requiresManualReview = findings.length > 0;
  return {
    riskLevel: requiresManualReview ? "high" : "low",
    requiresManualReview,
    upstreamFileCount: options.upstreamFiles.length,
    findings,
    markdownSummary: renderRiskMarkdownSummary({
      baseSha: options.baseSha,
      upstreamSha: options.upstreamSha,
      candidateSha: options.candidateSha,
      upstreamFileCount: options.upstreamFiles.length,
      findings,
    }),
  };
}

function runGit(repoRoot: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}

export function assessRepositoryUpstreamRisk(options: {
  readonly repoRoot: string;
  readonly baseRef: string;
  readonly upstreamRef: string;
  readonly candidateRef: string;
}): UpstreamRiskAssessment {
  const baseSha = runGit(options.repoRoot, ["rev-parse", options.baseRef]);
  const upstreamSha = runGit(options.repoRoot, ["rev-parse", options.upstreamRef]);
  const candidateSha = runGit(options.repoRoot, ["rev-parse", options.candidateRef]);

  const nameStatus = runGit(options.repoRoot, [
    "diff",
    "--name-status",
    `${baseSha}..${upstreamSha}`,
  ]);
  const forkNameOnly = runGit(options.repoRoot, [
    "diff",
    "--name-only",
    `${upstreamSha}..${candidateSha}`,
  ]);

  const upstreamFiles = parseGitNameStatus(nameStatus);
  const forkFiles = forkNameOnly
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return assessUpstreamRisk({
    upstreamFiles,
    forkFiles,
    baseSha,
    upstreamSha,
    candidateSha,
  });
}

function parseCliArgs(argv: ReadonlyArray<string>): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const repoRoot = NodePath.resolve(args["repo-root"] ?? process.cwd());
  const baseRef = args["base-ref"];
  const upstreamRef = args["upstream-ref"] ?? "upstream/main";
  const candidateRef = args["candidate-ref"] ?? "HEAD";
  if (!baseRef) {
    throw new Error("--base-ref is required");
  }

  const assessment = assessRepositoryUpstreamRisk({
    repoRoot,
    baseRef,
    upstreamRef,
    candidateRef,
  });

  if (args["json-out"]) {
    NodeFS.mkdirSync(NodePath.dirname(args["json-out"]), { recursive: true });
    NodeFS.writeFileSync(args["json-out"], `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
  }
  if (args["summary-out"]) {
    NodeFS.mkdirSync(NodePath.dirname(args["summary-out"]), { recursive: true });
    NodeFS.writeFileSync(args["summary-out"], assessment.markdownSummary, "utf8");
  }

  console.log(JSON.stringify(assessment, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  main();
}
