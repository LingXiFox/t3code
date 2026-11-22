import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import * as NpmRelease from "./npmRelease.ts";

const nightlyVersion = "0.1.5-nightly.20261030.1";
const stableVersion = "0.1.5";

const makeService = (handler: (url: string) => Response | Effect.Effect<Response>) =>
  NpmRelease.make().pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        expect(request.url).not.toContain("registry.npmjs.org");
        expect(request.url).not.toContain("pingdotgg/t3code");
        const result = handler(request.url);
        return Effect.isEffect(result)
          ? Effect.map(result, (res) => HttpClientResponse.fromWeb(request, res))
          : Effect.succeed(HttpClientResponse.fromWeb(request, result));
      }),
    ),
  );

it.effect(
  "resolves nightly and latest from LingXiFox/t3code update-feed pointers and caches for 1 minute",
  () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const service = yield* makeService((url) => {
        urls.push(url);
        if (
          url === "https://github.com/LingXiFox/t3code/releases/download/update-feed/nightly.json"
        ) {
          return new Response(
            JSON.stringify({
              tag_name: `v${nightlyVersion}`,
              body: `Notes\n<!-- lingxi-t3-release-meta: ${JSON.stringify({ databaseMigration: 105 })} -->`,
            }),
          );
        }
        if (
          url === "https://github.com/LingXiFox/t3code/releases/download/update-feed/latest.json"
        ) {
          return new Response(
            JSON.stringify({
              tag_name: `v${stableVersion}`,
              prerelease: false,
              t3code: { databaseMigration: 99 },
            }),
          );
        }
        return new Response("not found", { status: 404 });
      });

      expect(yield* service.get({ spec: "nightly" })).toEqual({
        version: nightlyVersion,
        databaseMigration: 105,
      });
      expect(yield* service.get({ spec: "nightly" })).toEqual({
        version: nightlyVersion,
        databaseMigration: 105,
      });
      expect(yield* service.get({ spec: "latest" })).toEqual({
        version: stableVersion,
        databaseMigration: 99,
      });
      expect(urls).toHaveLength(2);

      yield* TestClock.adjust("1 minute");
      expect(yield* service.get({ spec: "nightly" })).toEqual({
        version: nightlyVersion,
        databaseMigration: 105,
      });
      expect(urls).toHaveLength(3);
    }),
);

it.effect(
  "falls back to GitHub Releases API when update-feed pointers return 404 and returns null when unpublished",
  () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const service = yield* makeService((url) => {
        urls.push(url);
        if (url === "https://api.github.com/repos/LingXiFox/t3code/releases?per_page=30") {
          return new Response(
            JSON.stringify([
              {
                tag_name: `v${nightlyVersion}`,
                prerelease: true,
                body: '<!-- lingxi-t3-release-meta: {"databaseMigration":88} -->',
              },
              { tag_name: "v0.1.5-nightly.20261029.1", prerelease: true },
            ]),
          );
        }
        if (
          url === `https://api.github.com/repos/LingXiFox/t3code/releases/tags/v${stableVersion}`
        ) {
          return new Response(
            JSON.stringify({
              tag_name: `v${stableVersion}`,
              prerelease: false,
            }),
          );
        }
        return new Response("{}", { status: 404 });
      });

      expect(yield* service.get({ spec: "nightly" })).toEqual({
        version: nightlyVersion,
        databaseMigration: 88,
      });
      expect(yield* service.get({ spec: "latest" })).toBeNull();
      expect(yield* service.get({ spec: stableVersion })).toEqual({ version: stableVersion });
      expect(yield* service.get({ spec: "9.9.9" })).toBeNull();
      expect(urls).toEqual([
        "https://github.com/LingXiFox/t3code/releases/download/update-feed/nightly.json",
        "https://api.github.com/repos/LingXiFox/t3code/releases?per_page=30",
        "https://github.com/LingXiFox/t3code/releases/download/update-feed/latest.json",
        "https://api.github.com/repos/LingXiFox/t3code/releases/latest",
        `https://api.github.com/repos/LingXiFox/t3code/releases/tags/v${stableVersion}`,
        "https://api.github.com/repos/LingXiFox/t3code/releases/tags/v9.9.9",
      ]);
    }),
);

it.effect("fails with ServerNpmReleaseError on HTTP errors, invalid JSON, or timeout", () =>
  Effect.gen(function* () {
    const service = yield* makeService((url) => {
      if (url.endsWith("/nightly.json")) {
        return new Response("rate limited", { status: 403 });
      }
      if (url.endsWith("/latest.json")) {
        return new Response("not-json");
      }
      return new Response(new ReadableStream());
    });

    const forbidden = yield* service.get({ spec: "nightly" }).pipe(Effect.result);
    expect(Result.isFailure(forbidden)).toBe(true);
    if (Result.isFailure(forbidden)) {
      expect(forbidden.failure).toBeInstanceOf(ServerNpmReleaseError);
      expect(forbidden.failure.message).toContain("HTTP 403");
    }

    const malformed = yield* service.get({ spec: "latest" }).pipe(Effect.result);
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure).toBeInstanceOf(ServerNpmReleaseError);
    }

    const stalled = yield* service.get({ spec: "1.2.3" }).pipe(Effect.result, Effect.forkChild);
    yield* TestClock.adjust("15 seconds");
    const timedOut = yield* Fiber.join(stalled);
    expect(Result.isFailure(timedOut)).toBe(true);
    if (Result.isFailure(timedOut)) {
      expect(timedOut.failure).toBeInstanceOf(ServerNpmReleaseError);
    }
  }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "rejects invalid release specs before making HTTP requests: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* makeService(() => {
        throw new Error("invalid specs must not trigger HTTP requests");
      });
      expect(Result.isFailure(yield* service.get({ spec }).pipe(Effect.result))).toBe(true);
    }),
);
