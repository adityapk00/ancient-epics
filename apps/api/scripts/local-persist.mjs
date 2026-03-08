import path from "node:path";

export function resolveLocalPersistTo(apiRoot) {
  const persistTo = process.env.AE_LOCAL_PERSIST_TO?.trim();

  if (!persistTo) {
    return null;
  }

  return path.resolve(apiRoot, persistTo);
}

export function getLocalWranglerArgs(apiRoot) {
  const persistTo = resolveLocalPersistTo(apiRoot);
  return persistTo ? ["--persist-to", persistTo] : [];
}

export function getWranglerStateV3Dir(apiRoot) {
  const persistTo = resolveLocalPersistTo(apiRoot);
  const stateRoot = persistTo ?? path.join(apiRoot, ".wrangler", "state");
  return path.join(stateRoot, "v3");
}
