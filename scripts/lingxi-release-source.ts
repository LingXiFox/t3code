import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  buildReleaseMetadataComment,
  buildUpdateFeedManifest,
} from "../packages/shared/src/cliRelease.ts";

export { buildReleaseMetadataComment, buildUpdateFeedManifest };

export type ReleaseClassification = "upstream-only" | "local-only" | "mixed" | "no-change";
export type ReleaseChannel = "nightly" | "latest";

export interface CommitDescriptor {
  readonly sha: string;
  readonly subject: string;
  readonly patchId: string | null;
}

export interface ClassificationResult {
  readonly baseTag: string | null;
  readonly headSha: string;
  readonly upstreamRef: string;
  readonly classification: ReleaseClassification;
  readonly shouldPublishNightly: boolean;
  readonly localCommits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly upstreamCommits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly releaseNotes: string;
}

export interface VersionResolution {
  readonly version: string;
  readonly tag: string;
  readonly baseTag: string | null;
  readonly baseVersion: string;
  readonly databaseMigration: number;
  readonly releaseFeedFile: string;
}

function runGit(repoRoot: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}

export function latestServerMigrationId(repoRoot: string): number {
  const migrationsDir = NodePath.join(repoRoot, "apps/server/src/persistence/Migrations");
  let latest = 0;
  for (const entry of NodeFS.readdirSync(migrationsDir)) {
    const match = /^(\d+)_\w+\.ts$/u.exec(entry);
    if (!match?.[1]) continue;
    const id = Number.parseInt(match[1], 10);
    if (Number.isFinite(id) && id > latest) {
      latest = id;
    }
  }
  if (latest === 0) {
    throw new Error(`No server migration files found under ${migrationsDir}`);
  }
  return latest;
}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly nightlyDate: number;
  readonly nightlyRev: number;
  readonly normalized: string;
}

function parseSemverVersion(raw: string): ParsedVersion | null {
  const cleaned = raw.trim().replace(/^v/u, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d{8})\.(\d+))?(?:[+-].*)?$/u.exec(cleaned);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const nightlyDate = match[4] ? Number.parseInt(match[4], 10) : 0;
  const nightlyRev = match[5] ? Number.parseInt(match[5], 10) : 0;
  return {
    major,
    minor,
    patch,
    nightlyDate,
    nightlyRev,
    normalized: `${major}.${minor}.${patch}`,
  };
}

function compareNightlyVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.nightlyDate !== b.nightlyDate) return a.nightlyDate - b.nightlyDate;
  return a.nightlyRev - b.nightlyRev;
}

export function normalizeBaseVersion(rawVersion: string): string {
  const parsed = parseSemverVersion(rawVersion);
  if (!parsed) {
    throw new Error(`Invalid package.json version: ${rawVersion}`);
  }
  return parsed.normalized;
}

export function resolveLatestNightlyTag(tags: ReadonlyArray<string>): string | null {
  let latestTag: string | null = null;
  let latestParsed: ParsedVersion | null = null;
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag.startsWith("v") || !tag.includes("-nightly.")) continue;
    const parsed = parseSemverVersion(tag);
    if (!parsed) continue;
    if (!latestParsed || compareNightlyVersions(parsed, latestParsed) > 0) {
      latestParsed = parsed;
      latestTag = tag;
    }
  }
  return latestTag;
}

export function formatNightlyDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function computeNextNightlyVersion(options: {
  readonly baseVersion: string;
  readonly existingTags: ReadonlyArray<string>;
  readonly date?: Date;
}): string {
  const datePart = formatNightlyDate(options.date ?? new Date());
  const prefix = `${options.baseVersion}-nightly.${datePart}.`;
  let maxRevision = 0;
  for (const rawTag of options.existingTags) {
    const tag = rawTag.trim().replace(/^v/u, "");
    if (!tag.startsWith(prefix)) continue;
    const rev = Number.parseInt(tag.slice(prefix.length), 10);
    if (Number.isFinite(rev) && rev > maxRevision) {
      maxRevision = rev;
    }
  }
  return `${prefix}${maxRevision + 1}`;
}

export function resolveStableVersionFromNightly(nightlyTagOrVersion: string): {
  readonly version: string;
  readonly tag: string;
} {
  const parsed = parseSemverVersion(nightlyTagOrVersion);
  if (!parsed) {
    throw new Error(`Invalid nightly version or tag: ${nightlyTagOrVersion}`);
  }
  return {
    version: parsed.normalized,
    tag: `v${parsed.normalized}`,
  };
}

export function computeStablePatchId(repoRoot: string, sha: string): string | null {
  const diff = NodeChildProcess.execFileSync("git", ["show", "--format=", "--patch", sha], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (diff.trim().length === 0) {
    return null;
  }
  const output = NodeChildProcess.execFileSync("git", ["patch-id", "--stable"], {
    cwd: repoRoot,
    input: diff,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const patchId = output.split(/\s+/u)[0] ?? "";
  return patchId.length > 0 ? patchId : null;
}

export function listCommitsWithPatchIds(
  repoRoot: string,
  range: string,
): ReadonlyArray<CommitDescriptor> {
  const raw = runGit(repoRoot, ["log", "--no-merges", "--format=%H%x09%s", range]);
  if (raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => {
      const tabIndex = line.indexOf("\t");
      const sha = tabIndex === -1 ? line : line.slice(0, tabIndex);
      const subject = tabIndex === -1 ? "" : line.slice(tabIndex + 1);
      return {
        sha,
        subject,
        patchId: computeStablePatchId(repoRoot, sha),
      };
    });
}

export function classifyPatchSets(options: {
  readonly baseTag: string | null;
  readonly headSha: string;
  readonly upstreamRef: string;
  readonly releaseCommits: ReadonlyArray<CommitDescriptor>;
  readonly upstreamPatchIds: ReadonlySet<string>;
}): ClassificationResult {
  const { baseTag, headSha, upstreamRef, releaseCommits, upstreamPatchIds } = options;

  if (releaseCommits.length === 0 && baseTag !== null) {
    return {
      baseTag,
      headSha,
      upstreamRef,
      classification: "no-change",
      shouldPublishNightly: false,
      localCommits: [],
      upstreamCommits: [],
      releaseNotes: "自上一版 Nightly 以来无代码变更。",
    };
  }

  const upstreamCommits: Array<{ readonly sha: string; readonly subject: string }> = [];
  const localCommits: Array<{ readonly sha: string; readonly subject: string }> = [];

  for (const commit of releaseCommits) {
    if (commit.patchId && upstreamPatchIds.has(commit.patchId)) {
      upstreamCommits.push({ sha: commit.sha, subject: commit.subject });
    } else {
      localCommits.push({ sha: commit.sha, subject: commit.subject });
    }
  }

  let classification: ReleaseClassification;
  if (upstreamCommits.length > 0 && localCommits.length === 0) {
    classification = "upstream-only";
  } else if (upstreamCommits.length === 0 && localCommits.length > 0) {
    classification = "local-only";
  } else if (upstreamCommits.length > 0 && localCommits.length > 0) {
    classification = "mixed";
  } else {
    classification = "local-only";
  }

  return {
    baseTag,
    headSha,
    upstreamRef,
    classification,
    shouldPublishNightly: true,
    localCommits,
    upstreamCommits,
    releaseNotes: renderReleaseNotes({
      classification,
      baseTag,
      upstreamCommits,
      localCommits,
    }),
  };
}

export function renderReleaseNotes(options: {
  readonly classification: ReleaseClassification;
  readonly baseTag: string | null;
  readonly upstreamCommits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly localCommits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}): string {
  const { classification, baseTag, upstreamCommits, localCommits } = options;
  const baselineText = baseTag ? `自 \`${baseTag}\` 起` : "首次发布";

  if (classification === "upstream-only") {
    const lines = [
      "本次更新来自 T3 Code 官方上游，LingXi 本地无新增功能。",
      "",
      `> 基线：${baselineText}（共 ${upstreamCommits.length} 个上游同步提交）`,
      "",
      "### 上游同步变更",
      ...upstreamCommits
        .slice(0, 20)
        .map((commit) => `- ${commit.subject} (\`${commit.sha.slice(0, 7)}\`)`),
    ];
    if (upstreamCommits.length > 20) {
      lines.push(`- ……其余 ${upstreamCommits.length - 20} 个提交见对比记录`);
    }
    return lines.join("\n");
  }

  if (classification === "local-only") {
    const lines = [
      `LingXi T3 本地变更（${baselineText}，共 ${localCommits.length} 个本地提交）。`,
      "",
      "### LingXi 本地变更",
      ...localCommits
        .slice(0, 20)
        .map((commit) => `- ${commit.subject} (\`${commit.sha.slice(0, 7)}\`)`),
    ];
    if (localCommits.length > 20) {
      lines.push(`- ……其余 ${localCommits.length - 20} 个提交见对比记录`);
    }
    return lines.join("\n");
  }

  if (classification === "mixed") {
    const lines = [
      `本次更新包含 T3 Code 官方上游同步与 LingXi 本地变更（${baselineText}）。`,
      "",
      "### LingXi 本地变更",
      ...localCommits
        .slice(0, 15)
        .map((commit) => `- ${commit.subject} (\`${commit.sha.slice(0, 7)}\`)`),
      "",
      "### 上游同步变更",
      ...upstreamCommits
        .slice(0, 15)
        .map((commit) => `- ${commit.subject} (\`${commit.sha.slice(0, 7)}\`)`),
    ];
    return lines.join("\n");
  }

  return "自上一版 Nightly 以来无代码变更。";
}

export function classifyRepositoryChanges(options: {
  readonly repoRoot: string;
  readonly headRef: string;
  readonly upstreamRef: string;
  readonly baseTag?: string | null | undefined;
}): ClassificationResult {
  const { repoRoot, headRef, upstreamRef } = options;
  const headSha = runGit(repoRoot, ["rev-parse", headRef]);
  const allTags = runGit(repoRoot, ["tag", "--list", "v*-nightly.*"])
    .split(/\r?\n/u)
    .filter(Boolean);
  const baseTag =
    options.baseTag !== undefined ? options.baseTag : resolveLatestNightlyTag(allTags);

  const range = baseTag ? `${baseTag}..${headSha}` : headSha;
  const releaseCommits = listCommitsWithPatchIds(repoRoot, range);

  // Only inspect upstream commits reachable after the merge-base with baseTag (or recent 300 commits on bootstrap)
  const upstreamRange = baseTag
    ? `${runGit(repoRoot, ["merge-base", baseTag, upstreamRef])}..${upstreamRef}`
    : `${upstreamRef}~200..${upstreamRef}`;

  let upstreamPatchIds = new Set<string>();
  try {
    const upstreamCommits = listCommitsWithPatchIds(repoRoot, upstreamRange);
    upstreamPatchIds = new Set(
      upstreamCommits.map((commit) => commit.patchId).filter((id): id is string => id !== null),
    );
  } catch {
    // Fallback if repo is shallow and upstreamRef~200 does not exist
    const upstreamCommits = listCommitsWithPatchIds(repoRoot, upstreamRef);
    upstreamPatchIds = new Set(
      upstreamCommits.map((commit) => commit.patchId).filter((id): id is string => id !== null),
    );
  }

  return classifyPatchSets({
    baseTag,
    headSha,
    upstreamRef,
    releaseCommits,
    upstreamPatchIds,
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
  const [command, ...rest] = process.argv.slice(2);
  const args = parseCliArgs(rest);
  const repoRoot = NodePath.resolve(args["repo-root"] ?? process.cwd());

  if (command === "resolve-version") {
    const channel = (args.channel ?? "nightly") as ReleaseChannel;
    const desktopPkg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
    ) as { readonly version: string };
    const baseVersion = normalizeBaseVersion(desktopPkg.version);
    const existingTags = runGit(repoRoot, ["tag", "--list", "v*"]).split(/\r?\n/u).filter(Boolean);
    const baseTag = resolveLatestNightlyTag(existingTags);
    const databaseMigration = latestServerMigrationId(repoRoot);

    if (channel === "latest") {
      const sourceTag = args["nightly-tag"] ?? baseTag;
      if (!sourceTag) {
        throw new Error("No nightly tag found or provided for stable promotion.");
      }
      const stable = resolveStableVersionFromNightly(sourceTag);
      const resolution: VersionResolution = {
        version: stable.version,
        tag: stable.tag,
        baseTag: sourceTag,
        baseVersion,
        databaseMigration,
        releaseFeedFile: "latest.json",
      };
      console.log(JSON.stringify(resolution, null, 2));
      return;
    }

    const version = computeNextNightlyVersion({
      baseVersion,
      existingTags,
    });
    const resolution: VersionResolution = {
      version,
      tag: `v${version}`,
      baseTag,
      baseVersion,
      databaseMigration,
      releaseFeedFile: "nightly.json",
    };
    console.log(JSON.stringify(resolution, null, 2));
    return;
  }

  if (command === "classify-and-notes") {
    const channel = (args.channel ?? "nightly") as ReleaseChannel;
    const version = args.version;
    const tag = args.tag ?? (version ? `v${version}` : undefined);
    if (!version || !tag) {
      throw new Error("classify-and-notes requires --version <version>");
    }
    const headRef = args["head-ref"] ?? "HEAD";
    const upstreamRef = args["upstream-ref"] ?? "origin/main";
    const databaseMigration = latestServerMigrationId(repoRoot);
    const classification = classifyRepositoryChanges({
      repoRoot,
      headRef,
      upstreamRef,
      baseTag: args["base-tag"] ? args["base-tag"] : undefined,
    });

    const notesWithMeta = `${classification.releaseNotes}\n\n${buildReleaseMetadataComment({
      version,
      channel,
      databaseMigration,
      classification: classification.classification,
    })}\n`;

    if (args["notes-out"]) {
      NodeFS.mkdirSync(NodePath.dirname(args["notes-out"]), { recursive: true });
      NodeFS.writeFileSync(args["notes-out"], notesWithMeta, "utf8");
    }

    if (args["feed-out"]) {
      const feed = buildUpdateFeedManifest({
        version,
        tag,
        channel,
        databaseMigration,
        releasedAt: new Date().toISOString(),
      });
      NodeFS.mkdirSync(NodePath.dirname(args["feed-out"]), { recursive: true });
      NodeFS.writeFileSync(args["feed-out"], `${JSON.stringify(feed, null, 2)}\n`, "utf8");
    }

    console.log(
      JSON.stringify(
        {
          ...classification,
          version,
          tag,
          channel,
          databaseMigration,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(`Unknown command: ${command ?? "(none)"}`);
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  main();
}
