import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export const TRUSTED_REPOSITORY = "LingXiFox/t3code";
export const SYNC_BRANCH_DEFAULT = "sync/upstream-rebase";
export const TARGET_BRANCH_DEFAULT = "lingxifox";
export const CANDIDATE_CI_STATUS_CONTEXT = "lingxi/upstream-sync-candidate-ci";
export const TRUSTED_STATUS_CREATOR = "github-actions[bot]";
export const TRUSTED_SYNC_WORKFLOW_PATH = ".github/workflows/lingxi-upstream-sync.yml";
export const REQUIRED_VERIFY_JOB_NAMES = [
  "Verify Rebased Candidate / Core Checks (Linux)",
  "Verify Rebased Candidate / macOS Build Smoke (Unsigned)",
] as const;
export const MAINTAIN_PERMISSIONS: ReadonlySet<string> = new Set(["admin", "maintain", "write"]);

const HEX_40_REGEX = /^[0-9a-f]{40}$/u;
const DIGITS_REGEX = /^[0-9]+$/u;
const APPLY_COMMAND_REGEX = /^\/apply-sync(?:\s+([0-9a-f]{40})(?:\s+([0-9a-f]{40}))?)?$/iu;
const METADATA_BLOCK_REGEX = /<!--\s*lingxi-sync-metadata\s*\n([\s\S]*?)\n-->/u;

export type SyncLifecycleState =
  | "up-to-date"
  | "dry-run"
  | "pending-verify"
  | "ci-failed"
  | "verified-pending-approval"
  | "synced"
  | "approval-stale";

export interface PostPreparePlan {
  readonly verifyNeeded: boolean;
  readonly autoApplyEligible: boolean;
  readonly openReviewPr: boolean;
  readonly cleanupOnVerifyFailure: boolean;
  readonly initialState: "up-to-date" | "dry-run" | "pending-verify";
}

export interface SyncMetadata {
  readonly syncBranch: string;
  readonly candidateSha: string;
  readonly lingxifoxBeforeSha: string;
  readonly upstreamSha: string;
  readonly baseSha: string;
  readonly behindCount: number;
  readonly verifyResult: string;
  readonly syncRunId: string;
}

export type ApplySyncCommandParseResult =
  | {
      readonly matched: true;
      readonly expectedCandidateSha?: string | undefined;
      readonly expectedLingxifoxSha?: string | undefined;
    }
  | {
      readonly matched: false;
      readonly reason: string;
    };

export interface SyncApprovalValidationInput {
  readonly repository: string;
  readonly workflowRef: string;
  readonly gitRef: string;
  readonly trigger: "issue_comment" | "workflow_dispatch";
  readonly actor: {
    readonly login: string;
    readonly type?: string | undefined;
    readonly permission: string;
  };
  readonly commentBody?: string | undefined;
  readonly dispatchInputs?:
    | {
        readonly prNumber: string;
        readonly expectedCandidateSha: string;
        readonly expectedLingxifoxSha: string;
      }
    | undefined;
  readonly pr: {
    readonly number: number;
    readonly state: string;
    readonly body: string;
    readonly headRef: string;
    readonly headSha: string;
    readonly headRepoFullName: string;
    readonly baseRef: string;
    readonly baseRepoFullName: string;
  };
  readonly remoteCandidateSha: string;
  readonly remoteLingxifoxSha: string;
  readonly isUpstreamAncestorOfCandidate: boolean;
  readonly reviews: ReadonlyArray<{
    readonly userLogin: string;
    readonly userType?: string | undefined;
    readonly state: string;
    readonly commitId: string;
    readonly submittedAt: string;
  }>;
  readonly reviewerPermissions: Readonly<Record<string, string>>;
  readonly commitStatuses: ReadonlyArray<{
    readonly context: string;
    readonly state: string;
    readonly targetUrl: string;
    readonly creatorLogin: string;
    readonly updatedAt?: string | undefined;
  }>;
  readonly syncRun: {
    readonly id: number;
    readonly path: string;
    readonly repositoryFullName: string;
    readonly headBranch: string;
    readonly headSha: string;
    readonly status: string;
    readonly conclusion: string | null;
  } | null;
  readonly syncRunJobs: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
  }>;
}

export interface SyncApprovalValidationResult {
  readonly ok: boolean;
  readonly state: SyncLifecycleState;
  readonly codes: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly candidateSha: string;
  readonly lingxifoxBeforeSha: string;
  readonly upstreamSha: string;
  readonly baseSha: string;
  readonly syncBranch: string;
  readonly behindCount: number;
  readonly syncRunId: string;
  readonly approvers: ReadonlyArray<string>;
  readonly markdownSummary: string;
  readonly prComment: string;
}

export function decidePostPreparePlan(options: {
  readonly behindCount: number;
  readonly dryRun: boolean;
  readonly manualReviewRequired: boolean;
  readonly candidatePushed: boolean;
}): PostPreparePlan {
  if (options.behindCount <= 0) {
    return {
      verifyNeeded: false,
      autoApplyEligible: false,
      openReviewPr: false,
      cleanupOnVerifyFailure: false,
      initialState: "up-to-date",
    };
  }

  if (options.dryRun || !options.candidatePushed) {
    return {
      verifyNeeded: false,
      autoApplyEligible: false,
      openReviewPr: false,
      cleanupOnVerifyFailure: false,
      initialState: "dry-run",
    };
  }

  const autoApplyEligible = !options.manualReviewRequired;
  return {
    verifyNeeded: true,
    autoApplyEligible,
    openReviewPr: options.manualReviewRequired,
    cleanupOnVerifyFailure: autoApplyEligible,
    initialState: "pending-verify",
  };
}

export function renderSyncMetadataComment(meta: SyncMetadata): string {
  return [
    "<!-- lingxi-sync-metadata",
    `sync_branch=${meta.syncBranch}`,
    `candidate_sha=${meta.candidateSha}`,
    `lingxifox_before_sha=${meta.lingxifoxBeforeSha}`,
    `upstream_sha=${meta.upstreamSha}`,
    `base_sha=${meta.baseSha}`,
    `behind_count=${meta.behindCount}`,
    `verify_result=${meta.verifyResult}`,
    `sync_run_id=${meta.syncRunId}`,
    "-->",
  ].join("\n");
}

export function parseSyncMetadata(body: string): SyncMetadata | null {
  const match = METADATA_BLOCK_REGEX.exec(body);
  if (!match?.[1]) return null;

  const kv = new Map<string, string>();
  for (const rawLine of match[1].split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    kv.set(line.slice(0, eqIndex).trim(), line.slice(eqIndex + 1).trim());
  }

  const syncBranch = kv.get("sync_branch") ?? "";
  const candidateSha = (kv.get("candidate_sha") ?? "").toLowerCase();
  const lingxifoxBeforeSha = (kv.get("lingxifox_before_sha") ?? "").toLowerCase();
  const upstreamSha = (kv.get("upstream_sha") ?? "").toLowerCase();
  const baseSha = (kv.get("base_sha") ?? "").toLowerCase();
  const behindCountRaw = kv.get("behind_count") ?? "";
  const verifyResult = kv.get("verify_result") ?? "";
  const syncRunId = kv.get("sync_run_id") ?? "";

  if (
    !syncBranch ||
    !HEX_40_REGEX.test(candidateSha) ||
    !HEX_40_REGEX.test(lingxifoxBeforeSha) ||
    !HEX_40_REGEX.test(upstreamSha) ||
    !HEX_40_REGEX.test(baseSha) ||
    !DIGITS_REGEX.test(behindCountRaw) ||
    !verifyResult ||
    !DIGITS_REGEX.test(syncRunId)
  ) {
    return null;
  }

  const behindCount = Number.parseInt(behindCountRaw, 10);
  if (!Number.isSafeInteger(behindCount) || behindCount < 0) {
    return null;
  }

  return {
    syncBranch,
    candidateSha,
    lingxifoxBeforeSha,
    upstreamSha,
    baseSha,
    behindCount,
    verifyResult,
    syncRunId,
  };
}

export function renderReviewPrBody(options: {
  readonly metadata: SyncMetadata;
  readonly runUrl: string;
  readonly prNumber?: number | undefined;
  readonly status: "verified-pending-approval" | "ci-failed" | "synced";
  readonly applyRunUrl?: string | undefined;
  readonly approvers?: ReadonlyArray<string> | undefined;
  readonly riskSummaryMarkdown?: string | undefined;
}): string {
  const { metadata } = options;
  const statusBanner =
    options.status === "verified-pending-approval"
      ? "**Status: Verified — Pending Manual Approval** (Candidate CI passed; waiting for maintainer approval and explicit apply workflow.)"
      : options.status === "ci-failed"
        ? "**Status: Blocked — CI Failed** (Candidate CI did not pass; branch and PR are preserved for inspection, and apply is blocked until a new candidate passes CI.)"
        : "**Status: Synced** (Approved candidate applied to `lingxifox` via explicit `force-with-lease`.)";

  const lines: Array<string> = [
    "Automated high-risk upstream sync candidate.",
    "",
    `> ${statusBanner}`,
    "",
    "### Sync State & SHAs",
    "",
    `- **upstream/main**: \`${metadata.upstreamSha}\``,
    `- **merge-base**: \`${metadata.baseSha}\``,
    `- **lingxifox (before sync)**: \`${metadata.lingxifoxBeforeSha}\``,
    `- **candidate**: \`${metadata.candidateSha}\` (branch \`${metadata.syncBranch}\`)`,
    `- **lingxifox behind by**: ${metadata.behindCount} commits`,
    `- **Candidate CI (${CANDIDATE_CI_STATUS_CONTEXT})**: \`${metadata.verifyResult}\` ([sync run](${options.runUrl}))`,
  ];

  if (options.approvers && options.approvers.length > 0) {
    lines.push(`- **Approved by**: ${options.approvers.map((login) => `@${login}`).join(", ")}`);
  }
  if (options.applyRunUrl) {
    lines.push(`- **Apply Run**: [LingXi Upstream Sync Apply](${options.applyRunUrl})`);
  }

  lines.push(
    "",
    "### Landing Rules (Important)",
    "",
    `Rebasing \`lingxifox\` onto \`upstream/main\` creates a **diverged** candidate history on \`${metadata.syncBranch}\`. It **cannot be fast-forwarded** onto \`lingxifox\` and **must NOT be merged** using GitHub's Merge, Squash, or Rebase buttons.`,
    "",
    "This PR is a **review entry point only**. Any change pushed to `sync/upstream-rebase` or `lingxifox` invalidates prior approvals and requires re-sync plus re-verification.",
  );

  if (options.status === "verified-pending-approval") {
    const prHint = options.prNumber ? String(options.prNumber) : "<this PR number>";
    lines.push(
      "",
      "#### How to Approve & Apply",
      "",
      "1. Review the diff, risk findings below, and verify that `lingxi/upstream-sync-candidate-ci` passed.",
      `2. Submit a GitHub **Approve** review on this PR (bound to candidate SHA \`${metadata.candidateSha}\`).`,
      "3. Trigger **LingXi Upstream Sync Apply** using either:",
      `   - PR comment: \`/apply-sync ${metadata.candidateSha} ${metadata.lingxifoxBeforeSha}\` (or \`/apply-sync\`)`,
      `   - Actions \`workflow_dispatch\` (\`lingxi-upstream-sync-apply.yml\`) with \`pr_number=${prHint}\`, \`expected_candidate_sha=${metadata.candidateSha}\`, \`expected_lingxifox_sha=${metadata.lingxifoxBeforeSha}\``,
    );
  } else if (options.status === "ci-failed") {
    lines.push(
      "",
      "#### Next Steps",
      "",
      `Inspect the failing CI checks in [the sync run](${options.runUrl}). Do not approve or apply this candidate until a subsequent sync run produces a passing candidate.`,
    );
  }

  lines.push(
    "",
    "The next sync run force-updates `sync/upstream-rebase` from `lingxifox`, so manual fixes pushed only to this branch do not persist unless landed on `lingxifox` first.",
  );

  if (options.riskSummaryMarkdown?.trim()) {
    lines.push("", options.riskSummaryMarkdown.trim());
  }

  lines.push("", renderSyncMetadataComment(metadata), "");
  return lines.join("\n");
}

export function parseApplySyncCommand(commentBody: string): ApplySyncCommandParseResult {
  const firstNonEmptyLine = commentBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) {
    return { matched: false, reason: "Comment body is empty." };
  }

  const match = APPLY_COMMAND_REGEX.exec(firstNonEmptyLine);
  if (!match) {
    return {
      matched: false,
      reason:
        "Expected `/apply-sync` or `/apply-sync <candidate_sha_40> [lingxifox_sha_40]` on the first non-empty line.",
    };
  }

  return {
    matched: true,
    expectedCandidateSha: match[1]?.toLowerCase(),
    expectedLingxifoxSha: match[2]?.toLowerCase(),
  };
}

export function validateManualSyncApproval(
  input: SyncApprovalValidationInput,
): SyncApprovalValidationResult {
  const codes: Array<string> = [];
  const errors: Array<string> = [];
  const addError = (code: string, message: string) => {
    if (!codes.includes(code)) {
      codes.push(code);
    }
    errors.push(message);
  };

  if (input.repository !== TRUSTED_REPOSITORY) {
    addError(
      "untrusted-repository",
      `Refusing to apply sync in untrusted repository '${input.repository}'.`,
    );
  }
  if (input.gitRef !== `refs/heads/${TARGET_BRANCH_DEFAULT}`) {
    addError(
      "untrusted-workflow-ref",
      `Apply workflow must execute from refs/heads/${TARGET_BRANCH_DEFAULT} (got '${input.gitRef}').`,
    );
  }
  if (
    input.workflowRef &&
    !input.workflowRef.startsWith(
      `${TRUSTED_REPOSITORY}/.github/workflows/lingxi-upstream-sync-apply.yml@refs/heads/${TARGET_BRANCH_DEFAULT}`,
    )
  ) {
    addError("untrusted-workflow-ref", `Unexpected workflow_ref '${input.workflowRef}'.`);
  }

  if (input.actor.type === "Bot" || !MAINTAIN_PERMISSIONS.has(input.actor.permission)) {
    addError(
      "unauthorized-actor",
      `Actor '${input.actor.login}' (permission=${input.actor.permission}, type=${input.actor.type ?? "User"}) lacks write/maintain/admin permission.`,
    );
  }

  let expectedCandidateSha: string | undefined;
  let expectedLingxifoxSha: string | undefined;

  if (input.trigger === "issue_comment") {
    const parsedCommand = parseApplySyncCommand(input.commentBody ?? "");
    if (!parsedCommand.matched) {
      addError("invalid-command", parsedCommand.reason);
    } else {
      expectedCandidateSha = parsedCommand.expectedCandidateSha;
      expectedLingxifoxSha = parsedCommand.expectedLingxifoxSha;
    }
  } else {
    const dispatch = input.dispatchInputs;
    if (!dispatch) {
      addError("invalid-dispatch-inputs", "Missing workflow_dispatch inputs.");
    } else {
      const cand = dispatch.expectedCandidateSha.trim().toLowerCase();
      const target = dispatch.expectedLingxifoxSha.trim().toLowerCase();
      const prNum = Number.parseInt(dispatch.prNumber.trim(), 10);
      if (prNum !== input.pr.number) {
        addError(
          "pr-mismatch",
          `Dispatch pr_number (${dispatch.prNumber}) does not match PR #${input.pr.number}.`,
        );
      }
      if (!HEX_40_REGEX.test(cand) || !HEX_40_REGEX.test(target)) {
        addError(
          "invalid-dispatch-inputs",
          "workflow_dispatch requires 40-char hex SHAs for expected_candidate_sha and expected_lingxifox_sha.",
        );
      } else {
        expectedCandidateSha = cand;
        expectedLingxifoxSha = target;
      }
    }
  }

  if (input.pr.state !== "open") {
    addError("pr-not-open", `Review PR #${input.pr.number} is '${input.pr.state}', not 'open'.`);
  }
  if (
    input.pr.headRef !== SYNC_BRANCH_DEFAULT ||
    input.pr.headRepoFullName !== TRUSTED_REPOSITORY ||
    input.pr.baseRef !== TARGET_BRANCH_DEFAULT ||
    input.pr.baseRepoFullName !== TRUSTED_REPOSITORY
  ) {
    addError(
      "pr-branch-mismatch",
      `PR #${input.pr.number} must target ${TRUSTED_REPOSITORY}:${TARGET_BRANCH_DEFAULT} from ${TRUSTED_REPOSITORY}:${SYNC_BRANCH_DEFAULT}.`,
    );
  }

  const metadata = parseSyncMetadata(input.pr.body);
  if (!metadata || metadata.syncBranch !== SYNC_BRANCH_DEFAULT) {
    addError(
      "missing-metadata",
      `PR #${input.pr.number} is missing a valid lingxi-sync-metadata block.`,
    );
  }

  const remoteCandidateSha = input.remoteCandidateSha.trim().toLowerCase();
  const remoteLingxifoxSha = input.remoteLingxifoxSha.trim().toLowerCase();
  const prHeadSha = input.pr.headSha.trim().toLowerCase();

  if (!HEX_40_REGEX.test(remoteCandidateSha)) {
    addError(
      "candidate-changed",
      `Candidate branch '${SYNC_BRANCH_DEFAULT}' is missing on origin.`,
    );
  } else if (
    remoteCandidateSha !== prHeadSha ||
    (metadata && remoteCandidateSha !== metadata.candidateSha) ||
    (expectedCandidateSha && remoteCandidateSha !== expectedCandidateSha)
  ) {
    addError(
      "candidate-changed",
      `Candidate SHA drifted (remote=${remoteCandidateSha}, pr_head=${prHeadSha}, metadata=${metadata?.candidateSha ?? "missing"}, expected=${expectedCandidateSha ?? "none"}).`,
    );
  }

  if (!HEX_40_REGEX.test(remoteLingxifoxSha)) {
    addError(
      "target-branch-changed",
      `Target branch '${TARGET_BRANCH_DEFAULT}' SHA could not be resolved.`,
    );
  } else if (
    (metadata && remoteLingxifoxSha !== metadata.lingxifoxBeforeSha) ||
    (expectedLingxifoxSha && remoteLingxifoxSha !== expectedLingxifoxSha)
  ) {
    addError(
      "target-branch-changed",
      `Target branch '${TARGET_BRANCH_DEFAULT}' moved (remote=${remoteLingxifoxSha}, metadata=${metadata?.lingxifoxBeforeSha ?? "missing"}, expected=${expectedLingxifoxSha ?? "none"}).`,
    );
  }

  if (!input.isUpstreamAncestorOfCandidate) {
    addError("upstream-not-ancestor", "upstream/main is not an ancestor of the candidate commit.");
  }

  const orderedReviews = [...input.reviews]
    .map((review, index) => ({ review, index }))
    .toSorted((a, b) => {
      const cmp = a.review.submittedAt.localeCompare(b.review.submittedAt);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const latestByMaintainer = new Map<
    string,
    { readonly state: string; readonly commitId: string }
  >();
  for (const { review } of orderedReviews) {
    if (review.userType === "Bot") continue;
    const perm = input.reviewerPermissions[review.userLogin] ?? "none";
    if (!MAINTAIN_PERMISSIONS.has(perm)) continue;
    if (
      review.state === "APPROVED" ||
      review.state === "CHANGES_REQUESTED" ||
      review.state === "DISMISSED"
    ) {
      latestByMaintainer.set(review.userLogin, {
        state: review.state,
        commitId: review.commitId.toLowerCase(),
      });
    }
  }

  const validApprovers: Array<string> = [];
  const staleApprovers: Array<string> = [];
  const changeRequesters: Array<string> = [];

  for (const [login, decision] of latestByMaintainer.entries()) {
    if (decision.state === "CHANGES_REQUESTED") {
      changeRequesters.push(login);
    } else if (decision.state === "APPROVED") {
      if (HEX_40_REGEX.test(remoteCandidateSha) && decision.commitId === remoteCandidateSha) {
        validApprovers.push(login);
      } else {
        staleApprovers.push(login);
      }
    }
  }

  if (changeRequesters.length > 0) {
    addError(
      "changes-requested",
      `Maintainer(s) requested changes: ${changeRequesters.join(", ")}.`,
    );
  }
  if (validApprovers.length === 0) {
    if (staleApprovers.length > 0) {
      addError(
        "approval-stale-candidate",
        `Existing approval(s) from ${staleApprovers.join(", ")} targeted an older candidate commit, not ${remoteCandidateSha || "current HEAD"}. Re-approve the current candidate after CI passes.`,
      );
    } else {
      addError(
        "missing-approval",
        "No maintainer Approve review found for the current candidate commit.",
      );
    }
  }

  if (metadata) {
    if (metadata.verifyResult !== "success") {
      addError(
        "ci-not-passed",
        `Candidate verification result in PR metadata is '${metadata.verifyResult}', not 'success'.`,
      );
    }

    const matchingStatuses = input.commitStatuses.filter(
      (status) =>
        status.context === CANDIDATE_CI_STATUS_CONTEXT &&
        status.creatorLogin === TRUSTED_STATUS_CREATOR,
    );
    const latestStatus = matchingStatuses[0];
    const expectedRunSuffix = `/actions/runs/${metadata.syncRunId}`;
    if (
      !latestStatus ||
      latestStatus.state !== "success" ||
      !latestStatus.targetUrl.endsWith(expectedRunSuffix)
    ) {
      addError(
        "ci-status-invalid",
        `Commit status '${CANDIDATE_CI_STATUS_CONTEXT}' is missing, not 'success', or does not reference sync run ${metadata.syncRunId}.`,
      );
    }

    if (
      !input.syncRun ||
      String(input.syncRun.id) !== metadata.syncRunId ||
      input.syncRun.repositoryFullName !== TRUSTED_REPOSITORY ||
      input.syncRun.path !== TRUSTED_SYNC_WORKFLOW_PATH ||
      input.syncRun.headBranch !== TARGET_BRANCH_DEFAULT
    ) {
      addError(
        "ci-run-invalid",
        `Recorded sync run ${metadata.syncRunId} could not be verified against ${TRUSTED_SYNC_WORKFLOW_PATH} on ${TARGET_BRANCH_DEFAULT}.`,
      );
    } else if (
      HEX_40_REGEX.test(remoteLingxifoxSha) &&
      input.syncRun.headSha.toLowerCase() !== remoteLingxifoxSha
    ) {
      addError(
        "target-branch-changed",
        `Sync run ${metadata.syncRunId} ran against lingxifox ${input.syncRun.headSha}, but current origin/lingxifox is ${remoteLingxifoxSha}.`,
      );
    }

    const jobByName = new Map(input.syncRunJobs.map((job) => [job.name, job]));
    for (const requiredJobName of REQUIRED_VERIFY_JOB_NAMES) {
      const job = jobByName.get(requiredJobName);
      if (!job || job.status !== "completed" || job.conclusion !== "success") {
        addError(
          "ci-jobs-not-passed",
          `Required verification job '${requiredJobName}' did not complete with 'success' (got status=${job?.status ?? "missing"}, conclusion=${job?.conclusion ?? "missing"}).`,
        );
      }
    }
    for (const job of input.syncRunJobs) {
      if (
        job.name.startsWith("Verify Rebased Candidate /") &&
        (job.status !== "completed" || job.conclusion !== "success")
      ) {
        addError(
          "ci-jobs-not-passed",
          `Verification job '${job.name}' is not green (status=${job.status}, conclusion=${job.conclusion ?? "null"}).`,
        );
      }
    }
  }

  const ok = errors.length === 0;
  const isStale = codes.some(
    (code) =>
      code === "candidate-changed" ||
      code === "target-branch-changed" ||
      code === "approval-stale-candidate",
  );
  const isCiFailed = codes.some(
    (code) =>
      code === "ci-not-passed" ||
      code === "ci-status-invalid" ||
      code === "ci-run-invalid" ||
      code === "ci-jobs-not-passed",
  );

  const state: SyncLifecycleState = ok
    ? "synced"
    : isStale
      ? "approval-stale"
      : isCiFailed
        ? "ci-failed"
        : "verified-pending-approval";

  const candidateSha = metadata?.candidateSha ?? remoteCandidateSha;
  const lingxifoxBeforeSha = metadata?.lingxifoxBeforeSha ?? remoteLingxifoxSha;
  const upstreamSha = metadata?.upstreamSha ?? "";
  const baseSha = metadata?.baseSha ?? "";
  const syncBranch = metadata?.syncBranch ?? SYNC_BRANCH_DEFAULT;
  const behindCount = metadata?.behindCount ?? 0;
  const syncRunId = metadata?.syncRunId ?? "";

  const summaryLines: Array<string> = [
    ok
      ? "### Upstream Sync Approval Validated"
      : "### Upstream Sync Apply Blocked (Validation Failed)",
    "",
    `- **PR**: #${input.pr.number}`,
    `- **State**: \`${state}\``,
    `- **Actor**: \`${input.actor.login}\``,
    `- **Candidate SHA**: \`${candidateSha || "unknown"}\``,
    `- **lingxifox (expected)**: \`${lingxifoxBeforeSha || "unknown"}\``,
  ];
  if (validApprovers.length > 0) {
    summaryLines.push(`- **Valid Approvers**: ${validApprovers.map((a) => `\`${a}\``).join(", ")}`);
  }
  if (!ok) {
    summaryLines.push("", "#### Blocking Reasons", ...errors.map((err) => `- ${err}`));
  }
  const markdownSummary = `${summaryLines.join("\n")}\n`;

  const prComment = ok
    ? [
        `Applied approved upstream sync candidate \`${candidateSha}\` to \`${TARGET_BRANCH_DEFAULT}\` (from \`${lingxifoxBeforeSha}\`) via \`force-with-lease\`.`,
        "",
        `- **Approved by**: ${validApprovers.map((a) => `@${a}`).join(", ")}`,
        `- **Triggered by**: @${input.actor.login}`,
      ].join("\n")
    : [
        `Sync apply blocked (\`${state}\`). \`${TARGET_BRANCH_DEFAULT}\` was left untouched.`,
        "",
        ...errors.map((err) => `- ${err}`),
      ].join("\n");

  return {
    ok,
    state,
    codes,
    errors,
    candidateSha,
    lingxifoxBeforeSha,
    upstreamSha,
    baseSha,
    syncBranch,
    behindCount,
    syncRunId,
    approvers: validApprovers,
    markdownSummary,
    prComment,
  };
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

function requireArg(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function writeOptionalOutput(path: string | undefined, content: string) {
  if (!path) return;
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, content, "utf8");
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const args = parseCliArgs(rest);

  if (subcommand === "plan") {
    const plan = decidePostPreparePlan({
      behindCount: Number.parseInt(requireArg(args, "behind-count"), 10),
      dryRun: args["dry-run"] === "true",
      manualReviewRequired: args["manual-review-required"] === "true",
      candidatePushed: args["candidate-pushed"] === "true",
    });
    console.log(JSON.stringify(plan));
    return;
  }

  if (subcommand === "render-pr-body") {
    const statusRaw = requireArg(args, "status");
    if (
      statusRaw !== "verified-pending-approval" &&
      statusRaw !== "ci-failed" &&
      statusRaw !== "synced"
    ) {
      throw new Error(`Invalid --status: ${statusRaw}`);
    }
    const riskSummaryMarkdown =
      args["risk-summary-file"] && NodeFS.existsSync(args["risk-summary-file"])
        ? NodeFS.readFileSync(args["risk-summary-file"], "utf8")
        : undefined;
    const approvers = args.approvers
      ? args.approvers
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;
    const body = renderReviewPrBody({
      metadata: {
        syncBranch: args["sync-branch"] ?? SYNC_BRANCH_DEFAULT,
        candidateSha: requireArg(args, "candidate-sha").toLowerCase(),
        lingxifoxBeforeSha: requireArg(args, "lingxifox-before-sha").toLowerCase(),
        upstreamSha: requireArg(args, "upstream-sha").toLowerCase(),
        baseSha: requireArg(args, "base-sha").toLowerCase(),
        behindCount: Number.parseInt(requireArg(args, "behind-count"), 10),
        verifyResult: requireArg(args, "verify-result"),
        syncRunId: requireArg(args, "sync-run-id"),
      },
      runUrl: requireArg(args, "run-url"),
      prNumber: args["pr-number"] ? Number.parseInt(args["pr-number"], 10) : undefined,
      status: statusRaw,
      applyRunUrl: args["apply-run-url"],
      approvers,
      riskSummaryMarkdown,
    });
    if (args.out) {
      writeOptionalOutput(args.out, body);
    } else {
      process.stdout.write(body);
    }
    return;
  }

  if (subcommand === "parse-pr-metadata") {
    const body = NodeFS.readFileSync(requireArg(args, "body-file"), "utf8");
    const parsed = parseSyncMetadata(body);
    if (!parsed) {
      throw new Error("Could not parse lingxi-sync-metadata block from PR body.");
    }
    console.log(JSON.stringify(parsed));
    return;
  }

  if (subcommand === "validate-approval") {
    const input = JSON.parse(
      NodeFS.readFileSync(requireArg(args, "input"), "utf8"),
    ) as SyncApprovalValidationInput;
    const result = validateManualSyncApproval(input);
    writeOptionalOutput(args["json-out"], `${JSON.stringify(result, null, 2)}\n`);
    writeOptionalOutput(args["summary-out"], result.markdownSummary);
    writeOptionalOutput(args["comment-out"], `${result.prComment}\n`);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  main();
}
