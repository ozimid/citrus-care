// Mobile is deliberately NOT an npm workspace (React isolation — see README),
// but it consumes @citrus/shared straight from source. Teach Metro where the
// package and the monorepo-root node_modules (zod, hoisted for the web app)
// live, since both sit outside this project root.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.join(workspaceRoot, "packages/shared"),
  path.join(workspaceRoot, "node_modules"),
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
  path.join(workspaceRoot, "node_modules"),
];

// NOTE: `expo export` truncates watchFolders to the project root when Expo's
// on-demand filesystem is enabled, and its fallback refuses files outside it
// ("Failed to get the SHA-1 for ... packages/shared/src/index.ts"). That
// experiment is therefore disabled in app.json (`experiments.onDemandFilesystem`
// — the CLI force-overrides any resolver setting made here).

module.exports = config;
