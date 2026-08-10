const EXTENSION_SOURCE_PATTERN = /(?:chrome|moz|safari-web)-extension:\/\//i;
const KNOWN_EXTENSION_NOISE = [
  /failed to connect to metamask/i,
];

function errorText(error) {
  return [error?.stack, error?.message, error]
    .filter(Boolean)
    .map((value) => String(value))
    .join("\n");
}

export function shouldDisplayRuntimeError(error, source = "") {
  const text = errorText(error);
  if (EXTENSION_SOURCE_PATTERN.test(String(source || ""))) return false;
  if (EXTENSION_SOURCE_PATTERN.test(text)) return false;
  if (KNOWN_EXTENSION_NOISE.some((pattern) => pattern.test(text))) return false;
  return true;
}
