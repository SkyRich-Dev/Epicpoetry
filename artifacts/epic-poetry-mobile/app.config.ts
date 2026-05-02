import fs from "fs";
import path from "path";

import type { ConfigContext, ExpoConfig } from "expo/config";

function loadEnvIfPresent(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  try {
    process.loadEnvFile(filePath);
  } catch {
    // Ignore malformed or unreadable env files and continue with current process env.
  }
}

function normalizeDomain(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "")
    .replace(/\/api$/i, "");
}

const mobileRoot = __dirname;
loadEnvIfPresent(path.join(mobileRoot, ".env"));
loadEnvIfPresent(path.join(mobileRoot, "..", "..", ".env"));

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiDomain = normalizeDomain(process.env.EXPO_PUBLIC_DOMAIN) ?? undefined;

  return {
    ...config,
    name: "Platr",
    slug: "epic-poetry-mobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "epic-poetry-mobile",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/icon.png",
      resizeMode: "contain",
      backgroundColor: "#FBF8F4",
    },
    ios: {
      supportsTablet: false,
    },
    android: {},
    web: {
      favicon: "./assets/images/icon.png",
    },
    plugins: [
      [
        "expo-router",
        {
          origin: "https://replit.com/",
        },
      ],
      "expo-font",
      "expo-web-browser",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      ...(config.extra ?? {}),
      apiDomain,
      expoPublicDomain: apiDomain,
    },
  };
};
