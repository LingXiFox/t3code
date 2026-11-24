import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CANDIDATE_CI_STATUS_CONTEXT,
  REQUIRED_VERIFY_JOB_NAMES,
  SYNC_BRANCH_DEFAULT,
  TARGET_BRANCH_DEFAULT,
  TRUSTED_REPOSITORY,
  TRUSTED_STATUS_CREATOR,
  TRUSTED_SYNC_WORKFLOW_PATH,
  decidePostPreparePlan,
  parseApplySyncCommand,
  parseSyncMetadata,
  renderReviewPrBody,
  validateManualSyncApproval,
  type SyncApprovalValidationInput,
  type SyncMetadata,
} from "./lingxi-upstream-sync.ts";

const SHA_CANDIDATE = "1111111111111111111111111111111111111111";
const SHA_CANDIDATE_OLD = "2222222222222222222222222222222222222222";
const SHA_LINGXIFOX_BEFORE = "3333333333333333333333333333333333333333";
const SHA_LINGXIFOX_MOVED = "4444444444444444444444444444444444444444";
const SHA_UPSTREAM = "5555555555555555555555555555555555555555";
const SHA_BASE = "6666666666666666666666666666666666666666";

function makeMetadata(overrides?: Partial<SyncMetadata>): SyncMetadata {
  return {
    syncBranch: SYNC_BRANCH_DEFAULT,
    candidateSha: SHA_CANDIDATE,
    lingxifoxBeforeSha: SHA_LINGXIFOX_BEFORE,
    upstreamSha: SHA_UPSTREAM,
    baseSha: SHA_BASE,
    behindCount: 3,
    verifyResult: "success",
    syncRunId: "987654321",
    ...overrides,
  };
}

function makeApprovalInput(
  overrides?: Partial<SyncApprovalValidationInput> & {
    readonly metadataOverrides?: Partial<SyncMetadata>;
  },
): SyncApprovalValidationInput {
  const metadata = makeMetadata(overrides?.metadataOverrides);
  const prBody = renderReviewPrBody({
    metadata,
    runUrl: `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/${metadata.syncRunId}`,
    prNumber: 42,
    status: metadata.verifyResult === "success" ? "verified-pending-approval" : "ci-failed",
  });

  return {
    repository: TRUSTED_REPOSITORY,
    workflowRef: `${TRUSTED_REPOSITORY}/.github/workflows/lingxi-upstream-sync-apply.yml@refs/heads/${TARGET_BRANCH_DEFAULT}`,
    gitRef: `refs/heads/${TARGET_BRANCH_DEFAULT}`,
    trigger: "issue_comment",
    actor: {
      login: "lingxifox",
      type: "User",
      permission: "admin",
    },
    commentBody: `/apply-sync ${metadata.candidateSha} ${metadata.lingxifoxBeforeSha}`,
    pr: {
      number: 42,
      state: "open",
      body: prBody,
      headRef: SYNC_BRANCH_DEFAULT,
      headSha: metadata.candidateSha,
      headRepoFullName: TRUSTED_REPOSITORY,
      baseRef: TARGET_BRANCH_DEFAULT,
      baseRepoFullName: TRUSTED_REPOSITORY,
    },
    remoteCandidateSha: metadata.candidateSha,
    remoteLingxifoxSha: metadata.lingxifoxBeforeSha,
    isUpstreamAncestorOfCandidate: true,
    reviews: [
      {
        userLogin: "lingxifox",
        userType: "User",
        state: "APPROVED",
        commitId: metadata.candidateSha,
        submittedAt: "2026-11-24T10:00:00Z",
      },
    ],
    reviewerPermissions: {
      lingxifox: "admin",
    },
    commitStatuses: [
      {
        context: CANDIDATE_CI_STATUS_CONTEXT,
        state: "success",
        targetUrl: `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/${metadata.syncRunId}`,
        creatorLogin: TRUSTED_STATUS_CREATOR,
        updatedAt: "2026-11-24T09:59:00Z",
      },
    ],
    syncRun: {
      id: Number(metadata.syncRunId),
      path: TRUSTED_SYNC_WORKFLOW_PATH,
      repositoryFullName: TRUSTED_REPOSITORY,
      headBranch: TARGET_BRANCH_DEFAULT,
      headSha: metadata.lingxifoxBeforeSha,
      status: "completed",
      conclusion: "success",
    },
    syncRunJobs: REQUIRED_VERIFY_JOB_NAMES.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
    })),
    ...overrides,
  };
}

describe("lingxi-upstream-sync", () => {
  describe("post-prepare planning (low-risk, high-risk, dry-run, up-to-date)", () => {
    it("runs CI and auto-applies for low-risk candidates", () => {
      assert.deepStrictEqual(
        decidePostPreparePlan({
          behindCount: 5,
          dryRun: false,
          manualReviewRequired: false,
          candidatePushed: true,
        }),
        {
          verifyNeeded: true,
          autoApplyEligible: true,
          openReviewPr: false,
          cleanupOnVerifyFailure: true,
          initialState: "pending-verify",
        },
      );
    });

    it("runs CI without auto-applying and keeps branch/PR for high-risk candidates", () => {
      assert.deepStrictEqual(
        decidePostPreparePlan({
          behindCount: 5,
          dryRun: false,
          manualReviewRequired: true,
          candidatePushed: true,
        }),
        {
          verifyNeeded: true,
          autoApplyEligible: false,
          openReviewPr: true,
          cleanupOnVerifyFailure: false,
          initialState: "pending-verify",
        },
      );
    });

    it("skips CI and push on dry-run or when up to date", () => {
      assert.deepStrictEqual(
        decidePostPreparePlan({
          behindCount: 5,
          dryRun: true,
          manualReviewRequired: true,
          candidatePushed: false,
        }),
        {
          verifyNeeded: false,
          autoApplyEligible: false,
          openReviewPr: false,
          cleanupOnVerifyFailure: false,
          initialState: "dry-run",
        },
      );
      assert.deepStrictEqual(
        decidePostPreparePlan({
          behindCount: 0,
          dryRun: false,
          manualReviewRequired: false,
          candidatePushed: false,
        }),
        {
          verifyNeeded: false,
          autoApplyEligible: false,
          openReviewPr: false,
          cleanupOnVerifyFailure: false,
          initialState: "up-to-date",
        },
      );
    });
  });

  describe("review PR rendering and metadata round-trip", () => {
    it("distinguishes verified-pending-approval, ci-failed, and synced states without claiming fast-forward", () => {
      const metadata = makeMetadata();
      const runUrl = `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/${metadata.syncRunId}`;

      const pendingBody = renderReviewPrBody({
        metadata,
        runUrl,
        prNumber: 42,
        status: "verified-pending-approval",
      });
      assert.include(pendingBody, "Status: Verified — Pending Manual Approval");
      assert.include(pendingBody, "cannot be fast-forwarded");
      assert.include(pendingBody, "must NOT be merged");
      assert.notInclude(pendingBody, "Landing this PR fast-forwards");
      assert.deepStrictEqual(parseSyncMetadata(pendingBody), metadata);

      const failedBody = renderReviewPrBody({
        metadata: makeMetadata({ verifyResult: "failure" }),
        runUrl,
        prNumber: 42,
        status: "ci-failed",
      });
      assert.include(failedBody, "Status: Blocked — CI Failed");
      assert.notInclude(failedBody, "/apply-sync");

      const syncedBody = renderReviewPrBody({
        metadata,
        runUrl,
        applyRunUrl: `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/555`,
        approvers: ["lingxifox"],
        prNumber: 42,
        status: "synced",
      });
      assert.include(syncedBody, "Status: Synced");
      assert.include(syncedBody, "@lingxifox");
      assert.include(syncedBody, "force-with-lease");
    });

    it("parses /apply-sync comments with optional SHAs", () => {
      assert.deepStrictEqual(parseApplySyncCommand("/apply-sync"), {
        matched: true,
        expectedCandidateSha: undefined,
        expectedLingxifoxSha: undefined,
      });
      assert.deepStrictEqual(
        parseApplySyncCommand(`/apply-sync ${SHA_CANDIDATE.toUpperCase()} ${SHA_LINGXIFOX_BEFORE}`),
        {
          matched: true,
          expectedCandidateSha: SHA_CANDIDATE,
          expectedLingxifoxSha: SHA_LINGXIFOX_BEFORE,
        },
      );
      assert.isFalse(parseApplySyncCommand("LGTM").matched);
    });
  });

  describe("approval & CI validation paths", () => {
    it("accepts a valid maintainer approval via issue_comment and workflow_dispatch", () => {
      const commentResult = validateManualSyncApproval(makeApprovalInput());
      assert.isTrue(commentResult.ok);
      assert.equal(commentResult.state, "synced");
      assert.deepStrictEqual(commentResult.approvers, ["lingxifox"]);

      const dispatchResult = validateManualSyncApproval(
        makeApprovalInput({
          trigger: "workflow_dispatch",
          commentBody: undefined,
          dispatchInputs: {
            prNumber: "42",
            expectedCandidateSha: SHA_CANDIDATE,
            expectedLingxifoxSha: SHA_LINGXIFOX_BEFORE,
          },
        }),
      );
      assert.isTrue(dispatchResult.ok);
      assert.equal(dispatchResult.state, "synced");
    });

    it("blocks apply when candidate CI failed or required verify jobs did not pass", () => {
      const failedMeta = validateManualSyncApproval(
        makeApprovalInput({
          metadataOverrides: { verifyResult: "failure" },
          commitStatuses: [
            {
              context: CANDIDATE_CI_STATUS_CONTEXT,
              state: "failure",
              targetUrl: `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/987654321`,
              creatorLogin: TRUSTED_STATUS_CREATOR,
            },
          ],
          syncRunJobs: [
            { name: REQUIRED_VERIFY_JOB_NAMES[0], status: "completed", conclusion: "failure" },
            { name: REQUIRED_VERIFY_JOB_NAMES[1], status: "completed", conclusion: "skipped" },
          ],
        }),
      );
      assert.isFalse(failedMeta.ok);
      assert.equal(failedMeta.state, "ci-failed");
      assert.include(failedMeta.codes, "ci-not-passed");
      assert.include(failedMeta.codes, "ci-status-invalid");
      assert.include(failedMeta.codes, "ci-jobs-not-passed");
    });

    it("invalidates stale approvals when candidate SHA or lingxifox moves", () => {
      const staleApproval = validateManualSyncApproval(
        makeApprovalInput({
          reviews: [
            {
              userLogin: "lingxifox",
              userType: "User",
              state: "APPROVED",
              commitId: SHA_CANDIDATE_OLD,
              submittedAt: "2026-11-24T10:00:00Z",
            },
          ],
        }),
      );
      assert.isFalse(staleApproval.ok);
      assert.equal(staleApproval.state, "approval-stale");
      assert.include(staleApproval.codes, "approval-stale-candidate");

      const movedCandidate = validateManualSyncApproval(
        makeApprovalInput({
          remoteCandidateSha: SHA_CANDIDATE_OLD,
        }),
      );
      assert.isFalse(movedCandidate.ok);
      assert.equal(movedCandidate.state, "approval-stale");
      assert.include(movedCandidate.codes, "candidate-changed");

      const movedTarget = validateManualSyncApproval(
        makeApprovalInput({
          remoteLingxifoxSha: SHA_LINGXIFOX_MOVED,
        }),
      );
      assert.isFalse(movedTarget.ok);
      assert.equal(movedTarget.state, "approval-stale");
      assert.include(movedTarget.codes, "target-branch-changed");
    });

    it("rejects non-maintainer actors, changes-requested reviews, and untrusted refs", () => {
      const nonMaintainer = validateManualSyncApproval(
        makeApprovalInput({
          actor: { login: "outsider", type: "User", permission: "read" },
        }),
      );
      assert.isFalse(nonMaintainer.ok);
      assert.include(nonMaintainer.codes, "unauthorized-actor");

      const changesRequested = validateManualSyncApproval(
        makeApprovalInput({
          reviews: [
            {
              userLogin: "lingxifox",
              userType: "User",
              state: "APPROVED",
              commitId: SHA_CANDIDATE,
              submittedAt: "2026-11-24T10:00:00Z",
            },
            {
              userLogin: "lingxifox",
              userType: "User",
              state: "CHANGES_REQUESTED",
              commitId: SHA_CANDIDATE,
              submittedAt: "2026-11-24T10:05:00Z",
            },
          ],
        }),
      );
      assert.isFalse(changesRequested.ok);
      assert.include(changesRequested.codes, "changes-requested");

      const untrustedRef = validateManualSyncApproval(
        makeApprovalInput({
          gitRef: "refs/pull/42/merge",
        }),
      );
      assert.isFalse(untrustedRef.ok);
      assert.include(untrustedRef.codes, "untrusted-workflow-ref");
    });
  });

  describe("real git force-with-lease landing and drift protection", () => {
    it("lands a diverged rebased candidate via explicit force-with-lease and rejects when lingxifox moves", () => {
      const tmpRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lingxi-sync-git-"));
      const remoteDir = NodePath.join(tmpRoot, "origin.git");
      const workDir = NodePath.join(tmpRoot, "work");
      const git = (cwd: string, args: ReadonlyArray<string>) =>
        NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

      try {
        git(tmpRoot, ["init", "--bare", remoteDir]);
        git(tmpRoot, ["init", "-b", "main", workDir]);
        git(workDir, ["config", "user.name", "LingXi Test"]);
        git(workDir, ["config", "user.email", "test@lingxifox.dev"]);

        NodeFS.writeFileSync(NodePath.join(workDir, "base.txt"), "base\n", "utf8");
        git(workDir, ["add", "base.txt"]);
        git(workDir, ["commit", "-m", "chore: base"]);
        git(workDir, ["remote", "add", "origin", remoteDir]);
        git(workDir, ["push", "origin", "main"]);

        git(workDir, ["checkout", "-b", "lingxifox"]);
        NodeFS.writeFileSync(NodePath.join(workDir, "lingxi.txt"), "fork\n", "utf8");
        git(workDir, ["add", "lingxi.txt"]);
        git(workDir, ["commit", "-m", "feat(lingxi): fork commit"]);
        git(workDir, ["push", "origin", "lingxifox"]);
        const lingxifoxBefore = git(workDir, ["rev-parse", "lingxifox"]);

        git(workDir, ["checkout", "main"]);
        NodeFS.writeFileSync(NodePath.join(workDir, "upstream.txt"), "upstream\n", "utf8");
        git(workDir, ["add", "upstream.txt"]);
        git(workDir, ["commit", "-m", "fix: upstream change"]);
        const upstreamHead = git(workDir, ["rev-parse", "main"]);

        git(workDir, ["checkout", "-B", SYNC_BRANCH_DEFAULT, "lingxifox"]);
        git(workDir, ["rebase", upstreamHead]);
        const candidateSha = git(workDir, ["rev-parse", "HEAD"]);
        git(workDir, [
          "push",
          "--force-with-lease",
          "origin",
          `HEAD:refs/heads/${SYNC_BRANCH_DEFAULT}`,
        ]);

        // Rebased candidate diverges from lingxifox, so fast-forward merge must fail.
        git(workDir, ["checkout", "lingxifox"]);
        assert.throws(() => git(workDir, ["merge", "--ff-only", candidateSha]));

        // Explicit force-with-lease against lingxifoxBefore succeeds cleanly.
        git(workDir, [
          "push",
          `--force-with-lease=refs/heads/lingxifox:${lingxifoxBefore}`,
          "origin",
          `${candidateSha}:refs/heads/lingxifox`,
        ]);
        assert.equal(
          git(remoteDir, ["rev-parse", "--verify", "refs/heads/lingxifox"]),
          candidateSha,
        );

        // If lingxifox advances concurrently, stale lease must fail atomically.
        git(workDir, ["reset", "--hard", candidateSha]);
        NodeFS.writeFileSync(NodePath.join(workDir, "extra.txt"), "extra\n", "utf8");
        git(workDir, ["add", "extra.txt"]);
        git(workDir, ["commit", "-m", "chore: concurrent lingxifox commit"]);
        git(workDir, ["push", "origin", "HEAD:refs/heads/lingxifox"]);
        const concurrentSha = git(workDir, ["rev-parse", "HEAD"]);

        assert.throws(() =>
          git(workDir, [
            "push",
            `--force-with-lease=refs/heads/lingxifox:${lingxifoxBefore}`,
            "origin",
            `${candidateSha}:refs/heads/lingxifox`,
          ]),
        );
        const remoteHeadAfterFailedPush = git(workDir, [
          "ls-remote",
          "origin",
          "refs/heads/lingxifox",
        ]).split(/\s+/u)[0];
        assert.equal(remoteHeadAfterFailedPush, concurrentSha);
      } finally {
        NodeFS.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe("workflow YAML contracts", () => {
    const WorkflowSchema = Schema.Struct({
      name: Schema.String,
      jobs: Schema.Record(
        Schema.String,
        Schema.Struct({
          if: Schema.optional(Schema.String),
          uses: Schema.optional(Schema.String),
          needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
        }),
      ),
    });

    it.effect("parses all sync, apply, nightly, and verify workflows with expected gates", () =>
      Effect.gen(function* () {
        const workflowsDir = NodePath.resolve(import.meta.dirname, "../.github/workflows");
        const syncYaml = NodeFS.readFileSync(
          NodePath.join(workflowsDir, "lingxi-upstream-sync.yml"),
          "utf8",
        );
        const applyYaml = NodeFS.readFileSync(
          NodePath.join(workflowsDir, "lingxi-upstream-sync-apply.yml"),
          "utf8",
        );
        const nightlyYaml = NodeFS.readFileSync(
          NodePath.join(workflowsDir, "lingxi-nightly.yml"),
          "utf8",
        );
        const verifyYaml = NodeFS.readFileSync(
          NodePath.join(workflowsDir, "lingxi-verify.yml"),
          "utf8",
        );

        const syncDoc = yield* Schema.decodeEffect(fromYaml(WorkflowSchema))(syncYaml);
        const applyDoc = yield* Schema.decodeEffect(fromYaml(WorkflowSchema))(applyYaml);
        yield* Schema.decodeEffect(fromYaml(WorkflowSchema))(nightlyYaml);
        const verifyDoc = yield* Schema.decodeEffect(fromYaml(WorkflowSchema))(verifyYaml);

        assert.include(syncDoc.jobs["verify-candidate"]?.if ?? "", "verify_needed == 'true'");
        assert.notInclude(syncDoc.jobs["verify-candidate"]?.if ?? "", "manual_review_required");
        assert.include(syncYaml, "run_macos_smoke: true");
        assert.include(syncYaml, "statuses: write");
        assert.include(syncYaml, "pull-requests: write");
        assert.include(syncYaml, "issues: write");
        assert.include(syncYaml, "contents: write");
        assert.isDefined(syncDoc.jobs["record-candidate-status"]);
        assert.include(
          syncDoc.jobs["cleanup-failed-candidate"]?.if ?? "",
          "auto_apply_eligible == 'true'",
        );
        assert.include(syncDoc.jobs["apply-sync"]?.if ?? "", "auto_apply_eligible == 'true'");
        assert.notInclude(syncYaml, "Landing this PR fast-forwards");

        assert.isDefined(applyDoc.jobs["validate-and-apply"]);
        assert.equal(
          applyDoc.jobs["trigger-nightly"]?.uses,
          "./.github/workflows/lingxi-nightly.yml",
        );
        assert.notInclude(applyYaml, "pull_request_review");
        assert.include(applyYaml, "--force-with-lease");
        assert.include(applyYaml, "'lingxi-upstream-sync'");
        assert.include(applyYaml, "lingxi-upstream-sync-apply-noop-");

        assert.include(
          verifyDoc.jobs["verify-macos-smoke"]?.if ?? "",
          "inputs.run_macos_smoke == true",
        );
        assert.notInclude(
          verifyDoc.jobs["verify-macos-smoke"]?.if ?? "",
          "github.event_name == 'workflow_call'",
        );

        assert.include(nightlyYaml, "lingxi-upstream-sync-apply.yml@refs/heads/lingxifox");
        assert.include(verifyYaml, "scripts/lingxi-upstream-sync.test.ts");
      }),
    );
  });
});
