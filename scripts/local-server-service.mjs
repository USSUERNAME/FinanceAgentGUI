#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = dirname(scriptPath);
const appRoot = resolve(scriptsDir, "..");
const webRoot = join(appRoot, "web");
const logsDir = join(appRoot, "logs");
const viteBin = join(webRoot, "node_modules", "vite", "bin", "vite.js");
const windowsRunner = join(scriptsDir, "start-vite-dev-5173.ps1");

const host = process.env.FINANCE_AGENT_GUI_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.FINANCE_AGENT_GUI_PORT || process.env.PORT || "5173", 10);
const nodeBin = process.env.NODE_BIN || process.execPath;
const label = process.env.FINANCE_AGENT_GUI_SERVICE_LABEL || "com.financeagentgui.devserver";
const linuxServiceName = process.env.FINANCE_AGENT_GUI_SERVICE_NAME || "finance-agent-gui-devserver.service";
const windowsTaskName = process.env.FINANCE_AGENT_GUI_SERVICE_TASK_NAME || "FinanceAgentGUI Dev Server";

const outLog = join(logsDir, "service-5173.out.log");
const errLog = join(logsDir, "service-5173.err.log");
const baseUrl = `http://${host}:${port}/`;

const command = process.argv[2] || "status";

function usage() {
  console.log(`FinanceAgentGUI local server service

Usage:
  node scripts/local-server-service.mjs <command>

Commands:
  install    Register and start the user-level service for this OS
  start      Start the registered service
  stop       Stop the registered service without removing it
  restart    Stop, start, and probe the service
  status     Show service and port status
  uninstall  Stop and remove the registered service

Environment:
  FINANCE_AGENT_GUI_HOST=127.0.0.1
  FINANCE_AGENT_GUI_PORT=5173
  NODE_BIN=${nodeBin}`);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requirePort() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid FINANCE_AGENT_GUI_PORT/PORT: ${port}`);
  }
}

function ensureProjectReady() {
  requirePort();
  mkdirSync(logsDir, { recursive: true });
  if (!existsSync(viteBin)) {
    throw new Error(`Missing Vite entrypoint at ${viteBin}. Run npm install from ${webRoot}.`);
  }
  if (!existsSync(nodeBin)) {
    throw new Error(`Node.js executable not found at ${nodeBin}. Set NODE_BIN to a valid Node.js path.`);
  }
}

function run(commandName, args = [], options = {}) {
  const result = spawnSync(commandName, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options.spawnOptions,
  });
  if (result.error && !options.allowFailure) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${commandName} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }
  return result;
}

function outputText(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function systemdEscapeValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\x20")
    .replace(/\t/g, "\\t");
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsArgument(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function probeHttp(timeoutMs = 5000) {
  return new Promise((resolveProbe) => {
    const req = http.request(baseUrl, { method: "HEAD", timeout: timeoutMs }, (res) => {
      res.resume();
      res.on("end", () => {
        resolveProbe({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolveProbe({ ok: false, error: "timeout" });
    });
    req.on("error", (error) => {
      resolveProbe({ ok: false, error: error.message });
    });
    req.end();
  });
}

async function waitForProbe(timeoutMs = 30000) {
  const started = Date.now();
  let lastProbe = { ok: false, error: "not probed" };
  while (Date.now() - started < timeoutMs) {
    lastProbe = await probeHttp();
    if (lastProbe.ok) return lastProbe;
    await sleep(500);
  }
  return lastProbe;
}

async function waitForPortRelease(timeoutMs = 8000) {
  const started = Date.now();
  let owner = portOwnerText();
  while (owner && Date.now() - started < timeoutMs) {
    await sleep(200);
    owner = portOwnerText();
  }
  if (owner) {
    throw new Error(`Port ${port} did not become available after stopping the previous service.\n${owner}`);
  }
}

function portOwnerText() {
  if (process.platform === "win32") {
    const script = [
      `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
      "if ($connections) {",
      "  $connections | ForEach-Object {",
      "    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue",
      "    [PSCustomObject]@{ LocalPort = $_.LocalPort; OwningProcess = $_.OwningProcess; ProcessName = $p.ProcessName }",
      "  } | ConvertTo-Json -Compress",
      "}",
    ].join("\n");
    return outputText(run("powershell.exe", ["-NoProfile", "-Command", script], { allowFailure: true }));
  }
  return outputText(run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { allowFailure: true }));
}

async function printCommonStatus(extra = {}) {
  const probe = await probeHttp();
  console.log(`platform: ${process.platform}`);
  console.log(`url: ${baseUrl}`);
  console.log(`appRoot: ${appRoot}`);
  console.log(`node: ${nodeBin}`);
  console.log(`logs: ${outLog} / ${errLog}`);
  if (extra.target) console.log(`target: ${extra.target}`);
  if (extra.installed !== undefined) console.log(`installed: ${extra.installed ? "yes" : "no"}`);
  if (extra.loaded !== undefined) console.log(`loaded: ${extra.loaded ? "yes" : "no"}`);
  if (extra.state) console.log(`state: ${extra.state}`);
  console.log(`http: ${probe.ok ? `ok ${probe.statusCode}` : `down ${probe.error || ""}`}`.trim());
  const owner = portOwnerText();
  if (owner) {
    console.log("port:");
    console.log(owner);
  }
}

function macConfig() {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("macOS LaunchAgent requires a user id.");
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(launchAgentsDir, `${label}.plist`);
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  return { launchAgentsDir, plistPath, domain, target };
}

export function isMacLaunchConfigFailure(value) {
  return /last exit code\s*=\s*78(?::\s*EX_CONFIG)?/i.test(String(value || ""));
}

export function preservedServiceLogPath(logPath, timestamp = Date.now()) {
  const stamp = new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${logPath}.pre-ex-config-${stamp}`;
}

function bootoutMacService(config) {
  run("launchctl", ["bootout", config.target], { allowFailure: true });
  run("launchctl", ["bootout", config.domain, config.plistPath], { allowFailure: true });
}

async function recoverMacLogOpenFailure(config) {
  await sleep(750);
  const print = run("launchctl", ["print", config.target], { allowFailure: true });
  if (!isMacLaunchConfigFailure(outputText(print))) return false;

  bootoutMacService(config);
  const timestamp = Date.now();
  const preserved = [];
  for (const logPath of [outLog, errLog]) {
    if (!existsSync(logPath)) continue;
    const preservedPath = preservedServiceLogPath(logPath, timestamp);
    renameSync(logPath, preservedPath);
    preserved.push(preservedPath);
  }
  if (!preserved.length) return false;

  console.log("macOS launchd EX_CONFIG detected; preserved stale service logs:");
  for (const preservedPath of preserved) console.log(`- ${preservedPath}`);
  run("launchctl", ["bootstrap", config.domain, config.plistPath]);
  return true;
}

const MAC_VITE_BOOTSTRAP = [
  'const { pathToFileURL } = require("node:url");',
  "const root = process.argv[1];",
  "const entry = process.argv[2];",
  "const host = process.argv[3];",
  "const port = process.argv[4];",
  "process.chdir(root);",
  'process.argv = [process.execPath, entry, "--host", host, "--port", port, "--strictPort"];',
  "import(pathToFileURL(entry).href).catch((error) => {",
  "  console.error(error);",
  "  process.exitCode = 1;",
  "});",
].join(" ");

export function macLaunchArguments() {
  const pathValue = process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return [
    "/usr/bin/env",
    "-i",
    `FINANCE_AGENT_GUI_HOST=${host}`,
    `FINANCE_AGENT_GUI_PORT=${port}`,
    `HOME=${homedir()}`,
    `PATH=${pathValue}`,
    `LANG=${process.env.LANG || "en_US.UTF-8"}`,
    `LC_CTYPE=${process.env.LC_CTYPE || "UTF-8"}`,
    "NODE_ENV=development",
    nodeBin,
    "-e",
    MAC_VITE_BOOTSTRAP,
    webRoot,
    viteBin,
    host,
    String(port),
  ];
}

export function macPlist() {
  const args = macLaunchArguments();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errLog)}</string>
</dict>
</plist>
`;
}

const macHandler = {
  write() {
    const config = macConfig();
    mkdirSync(config.launchAgentsDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(config.plistPath, macPlist(), "utf8");
    return config;
  },
  bootout(config) {
    bootoutMacService(config);
  },
  async install() {
    ensureProjectReady();
    const config = this.write();
    this.bootout(config);
    run("launchctl", ["bootstrap", config.domain, config.plistPath]);
    await recoverMacLogOpenFailure(config);
    console.log(`installed: ${config.plistPath}`);
  },
  async start() {
    ensureProjectReady();
    const config = macConfig();
    if (!existsSync(config.plistPath)) this.write();
    run("launchctl", ["bootstrap", config.domain, config.plistPath], { allowFailure: true });
    run("launchctl", ["kickstart", "-k", config.target], { allowFailure: true });
    await recoverMacLogOpenFailure(config);
  },
  stop() {
    const config = macConfig();
    this.bootout(config);
  },
  async restart() {
    ensureProjectReady();
    const config = this.write();
    this.bootout(config);
    await waitForPortRelease();
    run("launchctl", ["bootstrap", config.domain, config.plistPath]);
    await recoverMacLogOpenFailure(config);
  },
  uninstall() {
    const config = macConfig();
    this.bootout(config);
    rmSync(config.plistPath, { force: true });
  },
  async status() {
    const config = macConfig();
    const print = run("launchctl", ["print", config.target], { allowFailure: true });
    await printCommonStatus({
      target: config.target,
      installed: existsSync(config.plistPath),
      loaded: print.status === 0,
    });
  },
};

function linuxConfig() {
  const userUnitDir = join(homedir(), ".config", "systemd", "user");
  const unitPath = join(userUnitDir, linuxServiceName);
  return { userUnitDir, unitPath, serviceName: linuxServiceName };
}

function linuxUnit() {
  return `[Unit]
Description=FinanceAgentGUI local development server
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdEscapeValue(webRoot)}
ExecStart=${shellQuote(nodeBin)} ${shellQuote(viteBin)} --host ${shellQuote(host)} --port ${port} --strictPort
Restart=on-failure
RestartSec=5
Environment=FINANCE_AGENT_GUI_HOST=${host}
Environment=FINANCE_AGENT_GUI_PORT=${port}
Environment=NODE_ENV=development
StandardOutput=append:${systemdEscapeValue(outLog)}
StandardError=append:${systemdEscapeValue(errLog)}

[Install]
WantedBy=default.target
`;
}

const linuxHandler = {
  write() {
    const config = linuxConfig();
    mkdirSync(config.userUnitDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(config.unitPath, linuxUnit(), "utf8");
    return config;
  },
  install() {
    ensureProjectReady();
    const config = this.write();
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", config.serviceName]);
    console.log(`installed: ${config.unitPath}`);
  },
  start() {
    ensureProjectReady();
    const config = linuxConfig();
    if (!existsSync(config.unitPath)) this.write();
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "start", config.serviceName]);
  },
  stop() {
    const config = linuxConfig();
    run("systemctl", ["--user", "stop", config.serviceName], { allowFailure: true });
  },
  restart() {
    ensureProjectReady();
    const config = this.write();
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "restart", config.serviceName]);
  },
  uninstall() {
    const config = linuxConfig();
    run("systemctl", ["--user", "disable", "--now", config.serviceName], { allowFailure: true });
    rmSync(config.unitPath, { force: true });
    run("systemctl", ["--user", "daemon-reload"], { allowFailure: true });
  },
  async status() {
    const config = linuxConfig();
    const active = run("systemctl", ["--user", "is-active", config.serviceName], { allowFailure: true });
    await printCommonStatus({
      target: config.serviceName,
      installed: existsSync(config.unitPath),
      loaded: active.status === 0,
      state: outputText(active) || "unknown",
    });
  },
};

function windowsPowerShell(script) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

function windowsTaskActionArgs() {
  return [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    windowsArgument(windowsRunner),
    "-NodeBin",
    windowsArgument(nodeBin),
    "-HostName",
    windowsArgument(host),
    "-Port",
    String(port),
  ].join(" ");
}

const windowsHandler = {
  install() {
    ensureProjectReady();
    const script = [
      `$taskName = ${powershellSingleQuote(windowsTaskName)}`,
      `$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ${powershellSingleQuote(windowsTaskActionArgs())} -WorkingDirectory ${powershellSingleQuote(webRoot)}`,
      "$trigger = New-ScheduledTaskTrigger -AtLogOn",
      "$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 30) -MultipleInstances IgnoreNew",
      "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'FinanceAgentGUI local development server' -Force | Out-Null",
      "Start-ScheduledTask -TaskName $taskName",
    ].join("\n");
    windowsPowerShell(script);
    console.log(`installed: ${windowsTaskName}`);
  },
  start() {
    const script = `Start-ScheduledTask -TaskName ${powershellSingleQuote(windowsTaskName)}`;
    windowsPowerShell(script);
  },
  stop() {
    const script = `Stop-ScheduledTask -TaskName ${powershellSingleQuote(windowsTaskName)} -ErrorAction SilentlyContinue`;
    windowsPowerShell(script);
  },
  restart() {
    this.stop();
    this.start();
  },
  uninstall() {
    const script = `Unregister-ScheduledTask -TaskName ${powershellSingleQuote(windowsTaskName)} -Confirm:$false -ErrorAction SilentlyContinue`;
    windowsPowerShell(script);
  },
  async status() {
    const script = [
      `$task = Get-ScheduledTask -TaskName ${powershellSingleQuote(windowsTaskName)} -ErrorAction SilentlyContinue`,
      "if ($task) { $task | Select-Object TaskName, State | ConvertTo-Json -Compress }",
    ].join("\n");
    const status = run("powershell.exe", ["-NoProfile", "-Command", script], { allowFailure: true });
    await printCommonStatus({
      target: windowsTaskName,
      installed: Boolean(outputText(status)),
      loaded: /Running|Ready/i.test(outputText(status)),
      state: outputText(status) || "not registered",
    });
  },
};

function handlerForPlatform() {
  if (process.platform === "darwin") return macHandler;
  if (process.platform === "linux") return linuxHandler;
  if (process.platform === "win32") return windowsHandler;
  throw new Error(`Unsupported platform for durable service install: ${process.platform}`);
}

async function main() {
  if (command === "-h" || command === "--help" || command === "help") {
    usage();
    return;
  }

  const handler = handlerForPlatform();
  switch (command) {
    case "install":
      await handler.install();
      if (!(await waitForProbe()).ok) throw new Error(`Service did not become ready at ${baseUrl}`);
      await handler.status();
      return;
    case "start":
      await handler.start();
      if (!(await waitForProbe()).ok) throw new Error(`Service did not become ready at ${baseUrl}`);
      await handler.status();
      return;
    case "stop":
      await handler.stop();
      await sleep(500);
      await handler.status();
      return;
    case "restart":
      await handler.restart();
      if (!(await waitForProbe()).ok) throw new Error(`Service did not become ready at ${baseUrl}`);
      await handler.status();
      return;
    case "status":
      await handler.status();
      return;
    case "uninstall":
      await handler.uninstall();
      await sleep(500);
      await handler.status();
      return;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

if (resolve(process.argv[1] || "") === scriptPath) {
  main().catch((error) => {
    fail(error.message);
  });
}
