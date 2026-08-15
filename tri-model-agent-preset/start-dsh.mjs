#!/usr/bin/env node
// start-dsh.mjs — one-click start for the DSH web profile (service + page in one).
//
//   node start-dsh.mjs [--profile web] [--url http://127.0.0.1:3080]
//
// Behaviour:
//   1. If the web page is already reachable -> just open the browser and exit.
//   2. Otherwise boot `dsh --profile web` detached (visible console window on
//      Windows), poll until the page answers, then open the browser.
//   3. dsh location: $DSH_BIN if set, else `dsh`/`dsh.cmd` on PATH.
//
// Windows note: .bat/.cmd files cannot be spawned directly (Node throws
// EINVAL); they must run through cmd.exe — see startDsh() below.
import { spawn, exec } from "node:child_process";
import { createConnection } from "node:net";

const args = process.argv.slice(2);
const profile = flag(args, "--profile") || "web";
const url = flag(args, "--url") || process.env.DSH_WEB_URL || "http://127.0.0.1:3080";
const host = new URL(url).hostname || "127.0.0.1";
const port = Number(new URL(url).port) || 3080;
const pollMs = 2000;
const maxTries = 45; // ~90s of waiting

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function isUp(hostname, p) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: hostname, port: p, timeout: 1500 });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
  });
}

function openBrowser(target) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const cmdArgs = isWin ? ["/c", "start", "", target] : [target];
  exec(`"${cmd}" ${cmdArgs.map((a) => `"${a}"`).join(" ")}`, () => {});
}

function dshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  return process.platform === "win32" ? "dsh.cmd" : "dsh";
}

function startDsh() {
  const bin = dshBin();
  if (process.platform === "win32") {
    // .bat/.cmd must go through cmd.exe; a bare spawn throws EINVAL on Node
    // for Windows. /d /s /c with the whole line as one argument handles
    // quotes in the binary path correctly.
    const command = `"${bin}" --profile "${profile}"`;
    return spawn("cmd.exe", ["/d", "/s", "/c", command], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
  }
  return spawn(bin, ["--profile", profile], { detached: true, stdio: "ignore" });
}

function fail(reason) {
  console.error(`[start-dsh] ${reason}`);
  if (process.platform === "win32") {
    console.error("[start-dsh] 把 dsh 所在目录加入 PATH，或用 DSH_BIN 指定，例如：");
    console.error("[start-dsh]   set DSH_BIN=C:\\path\\to\\deepseek-harness\\node_modules\\.bin\\dsh.cmd");
  } else {
    console.error("[start-dsh] add the dsh directory to PATH, or set DSH_BIN, e.g.:");
    console.error("[start-dsh]   export DSH_BIN=/path/to/node_modules/.bin/dsh");
  }
  process.exit(1);
}

console.log(`[start-dsh] profile=${profile} url=${url} bin=${dshBin()}`);

if (await isUp(host, port)) {
  console.log(`[start-dsh] 已在运行，直接打开 ${url}`);
  openBrowser(url);
  process.exit(0);
}

console.log(`[start-dsh] 启动 dsh --profile ${profile} ...`);
try {
  const child = startDsh();
  child.on("error", (error) => fail(`无法启动 dsh（${error.code || error.message}）`));
  child.unref();
} catch (error) {
  fail(`无法启动 dsh：${error.message}`);
}

for (let i = 1; i <= maxTries; i++) {
  await new Promise((r) => setTimeout(r, pollMs));
  if (await isUp(host, port)) {
    console.log(`[start-dsh] 服务已就绪，打开 ${url}`);
    openBrowser(url);
    process.exit(0);
  }
  if (i % 5 === 0) console.log(`[start-dsh] 等待服务启动… ${Math.round((i * pollMs) / 1000)}s`);
}

fail(`等待 ${(maxTries * pollMs) / 1000}s 后仍未连上 ${url}，请查看 dsh 控制台窗口日志`);
