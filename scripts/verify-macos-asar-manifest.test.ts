import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { assert, describe, it } from "@effect/vitest";

import {
  verifySignedMacAsarManifest,
  verifyUnpackedPackageJson,
} from "./verify-macos-asar-manifest.ts";

async function withTempAsar(
  files: Readonly<Record<string, string>>,
  run: (asarPath: string, tempDir: string) => Promise<void> | void,
): Promise<void> {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lingxi-asar-test-"));
  const srcDir = NodePath.join(tempDir, "src");
  const asarPath = NodePath.join(tempDir, "app.asar");
  NodeFS.mkdirSync(srcDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = NodePath.join(srcDir, relativePath);
    NodeFS.mkdirSync(NodePath.dirname(fullPath), { recursive: true });
    NodeFS.writeFileSync(fullPath, content, "utf8");
  }
  try {
    if (Object.keys(files).length > 0) {
      await createPackageWithOptions(srcDir, asarPath, {});
    }
    await run(asarPath, tempDir);
  } finally {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("verify-macos-asar-manifest", () => {
  it("allows signed builds when lingxiUnsignedMacBuild is absent from package.json", async () => {
    await withTempAsar(
      {
        "package.json": JSON.stringify({ name: "lingxit3", version: "0.1.11-nightly.20261122.1" }),
        "apps/desktop/dist-electron/boot.cjs": "console.log('boot');",
      },
      (asarPath) => {
        const verified = verifySignedMacAsarManifest(asarPath);
        assert.deepStrictEqual(verified, {
          name: "lingxit3",
          version: "0.1.11-nightly.20261122.1",
        });
      },
    );
  });

  it("rejects unsigned builds when package.json sets lingxiUnsignedMacBuild === true", async () => {
    await withTempAsar(
      {
        "package.json": JSON.stringify({
          name: "lingxit3",
          version: "0.1.11",
          lingxiUnsignedMacBuild: true,
        }),
      },
      (asarPath) => {
        assert.throws(
          () => verifySignedMacAsarManifest(asarPath),
          /lingxiUnsignedMacBuild === true/u,
        );
      },
    );
  });

  it("allows signed builds when bundled JS code mentions lingxiUnsignedMacBuild but package.json does not", async () => {
    await withTempAsar(
      {
        "package.json": JSON.stringify({
          name: "lingxit3",
          version: "0.1.11-nightly.20261122.1",
        }),
        "apps/desktop/dist-electron/main.cjs":
          'export const isUnsigned = Boolean(pkg && pkg["lingxiUnsignedMacBuild"] === true);',
      },
      (asarPath) => {
        const verified = verifySignedMacAsarManifest(asarPath);
        assert.equal(verified.name, "lingxit3");
      },
    );
  });

  it("fails explicitly when app.asar is missing, corrupted, missing package.json, or contains invalid JSON", async () => {
    await withTempAsar({}, (missingAsarPath) => {
      assert.throws(() => verifySignedMacAsarManifest(missingAsarPath), /Missing app\.asar/u);
    });

    await withTempAsar({}, (corruptedAsarPath) => {
      NodeFS.writeFileSync(corruptedAsarPath, "not-a-valid-asar-archive", "utf8");
      assert.throws(
        () => verifySignedMacAsarManifest(corruptedAsarPath),
        /Failed to extract package\.json/u,
      );
    });

    await withTempAsar(
      {
        "apps/desktop/dist-electron/boot.cjs": "console.log('only js');",
      },
      (noManifestAsarPath) => {
        assert.throws(
          () => verifySignedMacAsarManifest(noManifestAsarPath),
          /Failed to extract package\.json/u,
        );
      },
    );

    await withTempAsar(
      {
        "package.json": "{not-valid-json",
      },
      (badJsonAsarPath, tempDir) => {
        assert.throws(
          () => verifySignedMacAsarManifest(badJsonAsarPath),
          /Invalid package\.json JSON/u,
        );

        const unpackedBad = NodePath.join(tempDir, "unpacked.package.json");
        NodeFS.writeFileSync(unpackedBad, "{bad", "utf8");
        assert.throws(() => verifyUnpackedPackageJson(unpackedBad), /Invalid package\.json JSON/u);
      },
    );
  });
});
