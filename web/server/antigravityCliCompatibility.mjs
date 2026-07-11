const PROMPT_ARGUMENT_MIN_VERSION = [1, 1, 1];

export function parseAntigravityCliVersion(value = "") {
  const match = String(value).trim().match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\D|$)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

export function antigravityPromptTransport(cliVersion = "") {
  const parsed = parseAntigravityCliVersion(cliVersion);
  if (!parsed) return "argument";
  return versionAtLeast(parsed, PROMPT_ARGUMENT_MIN_VERSION) ? "argument" : "legacy-stdin";
}

export function antigravityPrintInvocation({
  cliVersion = "",
  model = "",
  printTimeout = "2m",
  prompt = "",
  securityArgs = [],
} = {}) {
  const promptTransport = antigravityPromptTransport(cliVersion);
  return {
    args: [
      ...securityArgs,
      "--model",
      model,
      `--print-timeout=${printTimeout}`,
      "-p",
      promptTransport === "argument" ? String(prompt || "") : "-",
    ],
    promptTransport,
    stdin: promptTransport === "legacy-stdin" ? String(prompt || "") : null,
    stdio: [promptTransport === "legacy-stdin" ? "pipe" : "ignore", "pipe", "pipe"],
  };
}
