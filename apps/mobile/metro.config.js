// Mobile is deliberately NOT an npm workspace (React isolation — see README),
// but it consumes @citrus/shared straight from source. Teach Metro where the
// package lives, since it sits outside this project root.
//
// The monorepo-root node_modules exists only where the web workspace has been
// installed (a dev Mac) — NOT on EAS builders, which install apps/mobile
// alone. Metro stat()s every watchFolder at startup, so referencing it
// unconditionally breaks the EAS bundle phase (ENOENT). Include it only when
// present; zod (shared's one dependency) is a direct mobile dependency, so
// nothing NEEDS the root install.

const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const rootNodeModules = path.join(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.join(workspaceRoot, "packages/shared"),
  ...(fs.existsSync(rootNodeModules) ? [rootNodeModules] : []),
];

// Map @citrus/shared straight to its source entry (mirrors the tsconfig path
// alias). extraNodeModules is not reliable here, so use an explicit resolver.
const sharedEntry = path.join(workspaceRoot, "packages/shared/src/index.ts");
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@citrus/shared") {
    return { type: "sourceFile", filePath: sharedEntry };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.nodeModulesPaths = [
  path.join(projectRoot, "node_modules"),
  ...(fs.existsSync(rootNodeModules) ? [rootNodeModules] : []),
];

// NOTE: `expo export` truncates watchFolders to the project root when Expo's
// on-demand filesystem is enabled, and its fallback refuses files outside it
// ("Failed to get the SHA-1 for ... packages/shared/src/index.ts"). That
// experiment is therefore disabled in app.json (`experiments.onDemandFilesystem`
// — the CLI force-overrides any resolver setting made here).

module.exports = config;
