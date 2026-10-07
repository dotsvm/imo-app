// Expo's defaults, plus what Privy's SDK needs to resolve in React Native:
// two packages without their `exports` map, and jose's browser build.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("isows") || moduleName.startsWith("zustand"))
    return context.resolveRequest({ ...context, unstable_enablePackageExports: false }, moduleName, platform);
  if (moduleName === "jose")
    return context.resolveRequest({ ...context, unstable_conditionNames: ["browser"] }, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
