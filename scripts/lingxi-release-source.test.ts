import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  buildReleaseMetadataComment,
  buildUpdateFeedManifest,
  classifyPatchSets,
  classifyRepositoryChanges,
  computeNextNightlyVersion,
  normalizeBaseVersion,
  resolveLatestNightlyTag,
  resolveStableVersionFromNightly,
} from "./lingxi-release-source.ts";

describe("lingxi-release-source", () => {
  it("normalizes package version and computes next nightly version with zero-tag bootstrap", () => {
    assert.equal(normalizeBaseVersion("0.0.48-nightly.20260410.1"), "0.0.48");
    assert.equal(resolveLatestNightlyTag([]), null);
    assert.equal(
      resolveLatestNightlyTag([
        "v0.0.48",
        "v0.0.48-nightly.20261120.1",
        "v0.0.48-nightly.20261121.2",
      ]),
      "v0.0.48-nightly.20261121.2",
    );

    const fixedDate = new Date("2026-11-22T06:00:00Z");
    assert.equal(
      computeNextNightlyVersion({
        baseVersion: "0.0.48",
        existingTags: [],
        date: fixedDate,
      }),
      "0.0.48-nightly.20261122.1",
    );
    assert.equal(
      computeNextNightlyVersion({
        baseVersion: "0.0.48",
        existingTags: ["v0.0.48-nightly.20261122.1", "v0.0.48-nightly.20261122.2"],
        date: fixedDate,
      }),
      "0.0.48-nightly.20261122.3",
    );
    assert.deepStrictEqual(resolveStableVersionFromNightly("v0.0.48-nightly.20261122.3"), {
      version: "0.0.48",
      tag: "v0.0.48",
    });
  });

  it("classifies upstream-only, local-only, mixed, and no-change release deltas", () => {
    const upstreamOnly = classifyPatchSets({
      baseTag: "v0.0.48-nightly.20261121.1",
      headSha: "abc1234",
      upstreamRef: "origin/main",
      releaseCommits: [{ sha: "1111111", subject: "fix(web): upstream fix", patchId: "patch-a" }],
      upstreamPatchIds: new Set(["patch-a"]),
    });
    assert.equal(upstreamOnly.classification, "upstream-only");
    assert.isTrue(upstreamOnly.shouldPublishNightly);
    assert.include(
      upstreamOnly.releaseNotes,
      "本次更新来自 T3 Code 官方上游，LingXi 本地无新增功能。",
    );

    const localOnly = classifyPatchSets({
      baseTag: "v0.0.48-nightly.20261121.1",
      headSha: "abc1235",
      upstreamRef: "origin/main",
      releaseCommits: [
        { sha: "2222222", subject: "feat(lingxi): local feature", patchId: "patch-b" },
      ],
      upstreamPatchIds: new Set(["patch-a"]),
    });
    assert.equal(localOnly.classification, "local-only");
    assert.isTrue(localOnly.shouldPublishNightly);
    assert.include(localOnly.releaseNotes, "feat(lingxi): local feature");

    const mixed = classifyPatchSets({
      baseTag: "v0.0.48-nightly.20261121.1",
      headSha: "abc1236",
      upstreamRef: "origin/main",
      releaseCommits: [
        { sha: "1111111", subject: "fix(web): upstream fix", patchId: "patch-a" },
        { sha: "2222222", subject: "feat(lingxi): local feature", patchId: "patch-b" },
      ],
      upstreamPatchIds: new Set(["patch-a"]),
    });
    assert.equal(mixed.classification, "mixed");
    assert.isTrue(mixed.shouldPublishNightly);
    assert.include(mixed.releaseNotes, "### LingXi 本地变更");
    assert.include(mixed.releaseNotes, "### 上游同步变更");

    const noChange = classifyPatchSets({
      baseTag: "v0.0.48-nightly.20261121.1",
      headSha: "abc1237",
      upstreamRef: "origin/main",
      releaseCommits: [],
      upstreamPatchIds: new Set(["patch-a"]),
    });
    assert.equal(noChange.classification, "no-change");
    assert.isFalse(noChange.shouldPublishNightly);
  });

  it("renders release metadata comments and update-feed manifests for LingXiFox/t3code", () => {
    const comment = buildReleaseMetadataComment({
      version: "0.0.48-nightly.20261122.1",
      channel: "nightly",
      databaseMigration: 42,
      classification: "upstream-only",
    });
    assert.include(comment, "<!-- lingxi-t3-release-meta:");
    assert.include(comment, '"databaseMigration":42');
    assert.include(comment, '"repository":"LingXiFox/t3code"');

    const feed = buildUpdateFeedManifest({
      version: "0.0.48-nightly.20261122.1",
      tag: "v0.0.48-nightly.20261122.1",
      channel: "nightly",
      databaseMigration: 42,
      releasedAt: "2026-11-22T06:00:00.000Z",
    });
    assert.deepStrictEqual(feed, {
      tag_name: "v0.0.48-nightly.20261122.1",
      name: "LingXi T3 0.0.48-nightly.20261122.1",
      draft: false,
      prerelease: true,
      version: "0.0.48-nightly.20261122.1",
      tag: "v0.0.48-nightly.20261122.1",
      channel: "nightly",
      repository: "LingXiFox/t3code",
      releaseUrl: "https://github.com/LingXiFox/t3code/releases/tag/v0.0.48-nightly.20261122.1",
      databaseMigration: 42,
      t3code: {
        databaseMigration: 42,
      },
      releasedAt: "2026-11-22T06:00:00.000Z",
    });

    const richFeed = buildUpdateFeedManifest({
      version: "0.0.48-nightly.20261122.1",
      tag: "v0.0.48-nightly.20261122.1",
      channel: "nightly",
      databaseMigration: 42,
      releasedAt: "2026-11-22T06:00:00.000Z",
      name: "LingXi T3 0.0.48-nightly.20261122.1",
      body: `Release notes\n\n${comment}`,
      commitSha: "9db4bdd8c95909d918b1d72b6e209fd801a12a8a",
    });
    assert.deepStrictEqual(richFeed, {
      ...feed,
      body: `Release notes\n\n${comment}`,
      commitSha: "9db4bdd8c95909d918b1d72b6e209fd801a12a8a",
    });
  });

  it("bounds zero-tag bootstrap classification to merge-base(HEAD, upstreamRef)..HEAD", () => {
    const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lingxi-release-git-"));
    const run = (args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();

    try {
      run(["init", "-b", "main"]);
      run(["config", "user.name", "LingXi Test"]);
      run(["config", "user.email", "test@lingxifox.dev"]);

      NodeFS.writeFileSync(NodePath.join(repoRoot, "README.md"), "upstream base\n", "utf8");
      run(["add", "README.md"]);
      run(["commit", "-m", "chore: upstream base"]);

      run(["checkout", "-b", "lingxifox"]);
      NodeFS.writeFileSync(NodePath.join(repoRoot, "FORK.md"), "lingxi fork change\n", "utf8");
      run(["add", "FORK.md"]);
      run(["commit", "-m", "feat(lingxi): fork-only change"]);

      const result = classifyRepositoryChanges({
        repoRoot,
        headRef: "HEAD",
        upstreamRef: "main",
      });

      assert.isNull(result.baseTag);
      assert.equal(result.classification, "local-only");
      assert.isTrue(result.shouldPublishNightly);
      assert.equal(result.localCommits.length, 1);
      assert.equal(result.localCommits[0]?.subject, "feat(lingxi): fork-only change");
      assert.equal(result.upstreamCommits.length, 0);
    } finally {
      NodeFS.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
