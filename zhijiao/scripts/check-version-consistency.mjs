import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function packageManifestPaths(parentDirectory) {
  const absoluteParent = resolve(projectRoot, parentDirectory);
  const entries = await readdir(absoluteParent, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = resolve(absoluteParent, entry.name, "package.json");
    try {
      await access(manifestPath);
      paths.push(manifestPath);
    } catch {
      // Non-package directories are outside the version consistency boundary.
    }
  }
  return paths;
}

const manifestPaths = [
  resolve(projectRoot, "package.json"),
  ...await packageManifestPaths("apps"),
  ...await packageManifestPaths("packages"),
];

const manifests = await Promise.all(manifestPaths.map(async (manifestPath) => ({
  manifestPath,
  manifest: JSON.parse(await readFile(manifestPath, "utf8")),
})));
const rootVersion = manifests.find(
  ({ manifestPath }) => manifestPath === resolve(projectRoot, "package.json"),
)?.manifest.version;

if (typeof rootVersion !== "string" || rootVersion.length === 0) {
  throw new Error("根 package.json 缺少有效 version");
}

const errors = [];
for (const { manifestPath, manifest } of manifests) {
  if (manifest.version !== rootVersion) {
    errors.push(
      `${manifestPath}: version=${String(manifest.version)}，期望 ${rootVersion}`,
    );
  }
}

const contractsSource = await readFile(
  resolve(projectRoot, "packages/contracts/src/version.ts"),
  "utf8",
);
const productVersion = contractsSource.match(
  /export const ProductVersion = "([^"]+)" as const;/u,
)?.[1];
if (productVersion !== rootVersion) {
  errors.push(
    `ProductVersion=${String(productVersion)}，期望 ${rootVersion}`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`VERSION_MISMATCH ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `version consistency ok: ${rootVersion} (${manifestPaths.length} manifests)\n`,
  );
}
