// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone signing verification CLI run during macOS packaging checks.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { extractFile } from "@electron/asar";

export interface VerifiedAsarManifest {
  readonly name?: string;
  readonly version?: string;
}

function parsePackageManifestObject(rawText: string, sourceLabel: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    throw new Error(
      `Invalid package.json JSON in ${sourceLabel}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid package.json object in ${sourceLabel}.`);
  }
  return parsed as Record<string, unknown>;
}

export function verifyUnpackedPackageJson(packageJsonPath: string): void {
  if (!NodeFS.existsSync(packageJsonPath)) {
    return;
  }
  let rawText: string;
  try {
    rawText = NodeFS.readFileSync(packageJsonPath, "utf8");
  } catch (cause) {
    throw new Error(
      `Failed to read unpacked package.json at ${packageJsonPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const manifest = parsePackageManifestObject(rawText, packageJsonPath);
  if (manifest.lingxiUnsignedMacBuild === true) {
    throw new Error(
      `Signed macOS build must not have lingxiUnsignedMacBuild === true in ${packageJsonPath}.`,
    );
  }
}

export function verifySignedMacAsarManifest(asarPath: string): VerifiedAsarManifest {
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.statSync(asarPath);
  } catch {
    throw new Error(`Missing app.asar at ${asarPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Expected regular file for app.asar at ${asarPath}`);
  }

  let extracted: Buffer;
  try {
    extracted = extractFile(asarPath, "package.json");
  } catch (cause) {
    throw new Error(
      `Failed to extract package.json from ${asarPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (extracted.length === 0) {
    throw new Error(`Empty package.json extracted from ${asarPath}`);
  }

  const manifest = parsePackageManifestObject(
    extracted.toString("utf8"),
    `${asarPath}:package.json`,
  );
  if (manifest.lingxiUnsignedMacBuild === true) {
    throw new Error(
      "Signed macOS build must not have lingxiUnsignedMacBuild === true in package.json.",
    );
  }

  return {
    ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
    ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
  };
}

function parseCliArgs(argv: ReadonlyArray<string>): {
  readonly asarPath: string;
  readonly unpackedPackageJsonPath: string | undefined;
} {
  let asarPath: string | undefined;
  let unpackedPackageJsonPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--unpacked-package-json") {
      unpackedPackageJsonPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token && !token.startsWith("--") && !asarPath) {
      asarPath = token;
    }
  }
  if (!asarPath) {
    throw new Error(
      "Usage: verify-macos-asar-manifest.ts <path-to-app.asar> [--unpacked-package-json <path>]",
    );
  }
  return { asarPath, unpackedPackageJsonPath };
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  try {
    const { asarPath, unpackedPackageJsonPath } = parseCliArgs(process.argv.slice(2));
    const manifest = verifySignedMacAsarManifest(asarPath);
    if (unpackedPackageJsonPath) {
      verifyUnpackedPackageJson(unpackedPackageJsonPath);
    }
    console.log(
      `[verify-macos-signing] app.asar package.json OK (${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
