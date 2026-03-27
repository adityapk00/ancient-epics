import versionData from "../app-version.json";

const configuredVersion = import.meta.env.VITE_APP_VERSION;
const parsedConfiguredVersion = configuredVersion ? Number.parseInt(configuredVersion, 10) : Number.NaN;

export const appVersion =
  Number.isFinite(parsedConfiguredVersion) && parsedConfiguredVersion > 0
    ? parsedConfiguredVersion
    : versionData.version;

export const appVersionLabel = `v${appVersion}`;
