import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import {
  CLI_RELEASE_REPOSITORY,
  desktopUpdateChannelOf,
  newestCliReleaseVersion,
  npmReleaseDatabaseMigration,
} from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const isServerNpmReleaseError = Schema.is(ServerNpmReleaseError);

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const decodeVersion = Schema.decodeUnknownOption(Version);
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

const GitHubReleasePayload = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  prerelease: Schema.optionalKey(Schema.Boolean),
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  t3code: Schema.optionalKey(Schema.Unknown),
});
type GitHubReleasePayload = typeof GitHubReleasePayload.Type;

const decodeReleasePayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(GitHubReleasePayload),
);
const decodeReleaseListPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(GitHubReleasePayload)),
);
const ReleaseMetaComment = Schema.Struct({
  databaseMigration: Schema.optionalKey(Schema.Int),
});
const decodeReleaseMetaComment = Schema.decodeUnknownOption(
  Schema.fromJsonString(ReleaseMetaComment),
);

const RELEASE_META_COMMENT_RE = /<!--\s*lingxi-t3-release-meta:\s*(\{[\s\S]*?\})\s*-->/;

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

function parseReleaseVersion(tagName: string): string | undefined {
  const normalized = tagName.trim().replace(/^v/, "");
  return Option.getOrUndefined(decodeVersion(normalized));
}

function extractDatabaseMigration(payload: GitHubReleasePayload): number | undefined {
  const direct = npmReleaseDatabaseMigration(payload);
  if (direct !== undefined) return direct;
  if (!payload.body) return undefined;
  const match = RELEASE_META_COMMENT_RE.exec(payload.body);
  if (!match?.[1]) return undefined;
  return Option.getOrUndefined(decodeReleaseMetaComment(match[1]))?.databaseMigration;
}

function toServerRelease(payload: GitHubReleasePayload): ServerNpmRelease | null {
  if (payload.draft) return null;
  const version = parseReleaseVersion(payload.tag_name);
  if (!version) return null;
  const databaseMigration = extractDatabaseMigration(payload);
  return {
    version,
    ...(databaseMigration === undefined ? {} : { databaseMigration }),
  };
}

export const make = Effect.fn("NpmRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;

  const fetchTextOrNotFound = Effect.fn("NpmRelease.fetchTextOrNotFound")(function* (url: string) {
    const unreachable = new ServerNpmReleaseError({
      reason: `Could not reach ${CLI_RELEASE_REPOSITORY} releases on GitHub.`,
    });
    return yield* Effect.gen(function* () {
      const request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeaders({
          Accept: "application/vnd.github+json",
          "User-Agent": "LingXi-T3",
        }),
      );
      const response = yield* http.execute(request);
      if (response.status === 404) return Option.none<string>();
      if (response.status < 200 || response.status >= 300) {
        return yield* new ServerNpmReleaseError({
          reason: `GitHub releases lookup returned HTTP ${response.status}.`,
        });
      }
      return Option.some(yield* response.text);
    }).pipe(
      Effect.timeout(Duration.seconds(15)),
      Effect.mapError((error) => (isServerNpmReleaseError(error) ? error : unreachable)),
    );
  });

  const invalidMetadata = () =>
    new ServerNpmReleaseError({
      reason: `${CLI_RELEASE_REPOSITORY} returned invalid release metadata.`,
    });

  const lookupLatest = Effect.fn("NpmRelease.lookupLatest")(function* () {
    const feedJson = yield* fetchTextOrNotFound(
      `https://github.com/${CLI_RELEASE_REPOSITORY}/releases/download/update-feed/latest.json`,
    );
    if (Option.isSome(feedJson)) {
      const payload = Option.getOrUndefined(decodeReleasePayload(feedJson.value));
      if (!payload) return yield* invalidMetadata();
      const release = toServerRelease(payload);
      if (!release || payload.prerelease || desktopUpdateChannelOf(release.version) !== "latest") {
        return yield* invalidMetadata();
      }
      return release;
    }

    const apiJson = yield* fetchTextOrNotFound(
      `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}/releases/latest`,
    );
    if (Option.isNone(apiJson)) return null;
    const payload = Option.getOrUndefined(decodeReleasePayload(apiJson.value));
    if (!payload) return yield* invalidMetadata();
    const release = toServerRelease(payload);
    if (!release || payload.prerelease || desktopUpdateChannelOf(release.version) !== "latest") {
      return null;
    }
    return release;
  });

  const lookupNightly = Effect.fn("NpmRelease.lookupNightly")(function* () {
    const feedJson = yield* fetchTextOrNotFound(
      `https://github.com/${CLI_RELEASE_REPOSITORY}/releases/download/update-feed/nightly.json`,
    );
    if (Option.isSome(feedJson)) {
      const payload = Option.getOrUndefined(decodeReleasePayload(feedJson.value));
      if (!payload) return yield* invalidMetadata();
      const release = toServerRelease(payload);
      if (!release || desktopUpdateChannelOf(release.version) !== "nightly") {
        return yield* invalidMetadata();
      }
      return release;
    }

    const listJson = yield* fetchTextOrNotFound(
      `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}/releases?per_page=30`,
    );
    if (Option.isNone(listJson)) return null;
    const payloads = Option.getOrUndefined(decodeReleaseListPayload(listJson.value));
    if (!payloads) return yield* invalidMetadata();
    const newestVersion = newestCliReleaseVersion(payloads, "nightly");
    if (!newestVersion) return null;
    const matching = payloads.find(
      (entry) => !entry.draft && parseReleaseVersion(entry.tag_name) === newestVersion,
    );
    return matching ? toServerRelease(matching) : { version: newestVersion };
  });

  const lookupExactVersion = Effect.fn("NpmRelease.lookupExactVersion")(function* (spec: string) {
    const apiJson = yield* fetchTextOrNotFound(
      `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}/releases/tags/v${spec}`,
    );
    if (Option.isNone(apiJson)) return null;
    const payload = Option.getOrUndefined(decodeReleasePayload(apiJson.value));
    if (!payload) return yield* invalidMetadata();
    const release = toServerRelease(payload);
    if (!release || release.version !== spec) {
      return yield* invalidMetadata();
    }
    return release;
  });

  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: Effect.fn("NpmRelease.lookup")(function* (spec: string) {
      if (spec === "latest") return yield* lookupLatest();
      if (spec === "nightly") return yield* lookupNightly();
      return yield* lookupExactVersion(spec);
    }),
  });

  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
