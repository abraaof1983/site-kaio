import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_NAME, dataDir, packaged } from "./app-env.js";

export function desktopRequested({
  platform = process.platform,
  env = process.env,
  isPackaged = packaged,
} = {}) {
  return (
    platform === "win32" &&
    (env.AOF_DESKTOP === "1" || (isPackaged && env.AOF_OPEN_BROWSER !== "0"))
  );
}

export function desktopLogPath() {
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(local, APP_NAME, "logs", "app.log");
}

function desktopMessage(message, icon) {
  if (process.platform !== "win32" || process.env.AOF_DESKTOP_DIALOG === "0")
    return;
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:AOF_MESSAGE, $env:AOF_TITLE, 'OK', $env:AOF_ICON) | Out-Null",
    ],
    {
      env: {
        ...process.env,
        AOF_MESSAGE: message,
        AOF_TITLE: APP_NAME,
        AOF_ICON: icon,
      },
      windowsHide: true,
      stdio: "ignore",
    },
  );
}

export function showDesktopNotice(message) {
  desktopMessage(message, "Information");
}

/** Also works when Explorer starts the GUI executable without stdout/stderr. */
export function reportDesktopError(error, { dialog = true } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const path = desktopLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${new Date().toISOString()} ${error?.stack || message}\n`,
      "utf8",
    );
  } catch {}
  console.error(message);
  if (dialog) desktopMessage(`${message}\n\nDetalhes em:\n${path}`, "Error");
}

/** Pure lifecycle policy, independently testable without a Windows/browser. */
export class DesktopLifetime {
  constructor({
    now = Date.now,
    onClose = () => {},
    closeGraceMs = 3500,
    heartbeatTimeoutMs = 90000,
    startupTimeoutMs = 45000,
  } = {}) {
    this.now = now;
    this.onClose = onClose;
    this.closeGraceMs = closeGraceMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.startedAt = now();
    this.clients = new Map();
    this.hadHeartbeat = false;
    this.hadRemoteWindow = false;
    this.remoteLastSeen = null;
    this.remoteEmptySince = null;
    this.remoteLostSince = null;
    this.processExited = false;
    this.finished = false;
  }

  heartbeat(id) {
    if (this.finished || !/^[a-zA-Z0-9-]{16,100}$/.test(String(id || "")))
      return false;
    this.clients.set(id, { seen: this.now(), closing: null });
    this.hadHeartbeat = true;
    return true;
  }

  closing(id) {
    const client = this.clients.get(id);
    if (!client || this.finished) return false;
    client.closing = this.now();
    return true;
  }

  observeWindows(count) {
    this.remoteLostSince = null;
    this.remoteLastSeen = this.now();
    if (count > 0) {
      this.hadRemoteWindow = true;
      this.remoteEmptySince = null;
    } else if (this.hadRemoteWindow && this.remoteEmptySince === null) {
      this.remoteEmptySince = this.now();
    }
  }

  connectionLost() {
    if (this.remoteLostSince === null) this.remoteLostSince = this.now();
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.onClose(reason);
  }

  check() {
    if (this.finished) return;
    const now = this.now();
    // DevTools observes real page targets and is unaffected by background-tab
    // timer throttling. A PDF target does not keep the application alive.
    if (
      this.remoteEmptySince !== null &&
      now - this.remoteEmptySince >= this.closeGraceMs
    )
      return this.finish("window-closed");
    if (
      this.hadRemoteWindow &&
      this.remoteLostSince !== null &&
      this.processExited &&
      now - this.remoteLostSince >= this.closeGraceMs
    )
      return this.finish("browser-closed");
    if (
      this.hadRemoteWindow &&
      this.remoteLostSince === null &&
      now - this.remoteLastSeen < 5000
    )
      return;
    for (const [id, client] of this.clients) {
      if (
        (client.closing !== null &&
          now - client.closing >= this.closeGraceMs) ||
        now - client.seen >= this.heartbeatTimeoutMs
      )
        this.clients.delete(id);
    }
    if (this.hadHeartbeat && this.clients.size === 0)
      return this.finish("window-closed");
    if (
      !this.hadHeartbeat &&
      !this.hadRemoteWindow &&
      now - this.startedAt >= this.startupTimeoutMs
    )
      return this.finish("startup-timeout");
  }
}

export function browserCandidates(env = process.env) {
  const roots = [
    env["ProgramFiles(x86)"],
    env.ProgramFiles,
    env.LOCALAPPDATA,
  ].filter(Boolean);
  return [
    env.AOF_BROWSER_PATH,
    ...roots.map((root) =>
      join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    ),
    ...roots.map((root) =>
      join(root, "Google", "Chrome", "Application", "chrome.exe"),
    ),
  ].filter(Boolean);
}

export function isApplicationTarget(target, appUrl) {
  if (target?.type !== "page") return false;
  try {
    const targetUrl = new URL(target.url);
    const expected = new URL(appUrl);
    return (
      targetUrl.origin === expected.origin &&
      ["/", "/index.html"].includes(targetUrl.pathname)
    );
  } catch {
    return false;
  }
}

function debugLocation(profile) {
  const [portText, browserPath] = readFileSync(
    join(profile, "DevToolsActivePort"),
    "utf8",
  )
    .trim()
    .split(/\r?\n/);
  const port = Number(portText);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath || "")
  )
    throw Error("DevTools indisponível");
  return { port, browserPath };
}

/** Rejects stale ports that now belong to a different browser/process. */
export function profileDebugSocket(info, expected) {
  try {
    const url = new URL(info.webSocketDebuggerUrl);
    return url.protocol === "ws:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      Number(url.port) === expected.port &&
      url.pathname === expected.browserPath
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function closeProfile(profile) {
  const expected = debugLocation(profile);
  const response = await fetch(
    `http://127.0.0.1:${expected.port}/json/version`,
    { signal: AbortSignal.timeout(1200) },
  );
  if (!response.ok) return false;
  const socketUrl = profileDebugSocket(await response.json(), expected);
  if (!socketUrl) return false;
  return new Promise((resolve) => {
    const socket = new WebSocket(socketUrl);
    let requested = false;
    const finish = (closed) => {
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      resolve(closed);
    };
    const timeout = setTimeout(() => finish(false), 1500);
    socket.addEventListener("open", () => {
      requested = true;
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    });
    socket.addEventListener("message", (event) => {
      try {
        if (JSON.parse(event.data).id === 1) finish(true);
      } catch {}
    });
    socket.addEventListener("close", () => finish(requested));
    socket.addEventListener("error", () => finish(false));
  });
}

/** Owns only an isolated app browser profile; never terminates a user's browser. */
export function createDesktopSession({
  onClose,
  log = console.error,
  profileBase,
} = {}) {
  const token = randomBytes(32).toString("hex");
  let stopped = false;
  let timer = null;
  let polling = false;
  let appUrl = null;
  let child = null;
  const data = dataDir();
  const identity = createHash("sha256")
    .update(data.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const profile =
    profileBase || join(dirname(data), ".cache", `desktop-profile-${identity}`);
  const lifetime = new DesktopLifetime({
    onClose(reason) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (reason === "startup-timeout")
        reportDesktopError(
          new Error(
            "A janela do sistema não conseguiu abrir. Confira se o Microsoft Edge ou Google Chrome está disponível.",
          ),
        );
      Promise.resolve()
        .then(() => onClose?.(reason))
        .catch((error) => log(error.message));
    },
  });

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const { port } = debugLocation(profile);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1200),
      });
      if (!response.ok) throw Error("DevTools indisponível");
      const pages = await response.json();
      if (!Array.isArray(pages)) throw Error("DevTools indisponível");
      lifetime.observeWindows(
        pages.filter((target) => isApplicationTarget(target, appUrl)).length,
      );
    } catch {
      // Some company policies disable DevTools. The session-scoped heartbeat
      // remains available, including when Chromium's launcher exits early.
      lifetime.connectionLost();
    } finally {
      polling = false;
      if (!stopped) lifetime.check();
    }
  }

  return {
    token,
    validToken(value) {
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        return false;
      return timingSafeEqual(Buffer.from(value), Buffer.from(token));
    },
    heartbeat: (id) => lifetime.heartbeat(id),
    closing: (id) => lifetime.closing(id),
    async open(url) {
      if (process.platform !== "win32")
        throw Error("A janela de aplicativo está disponível no Windows.");
      if (child || stopped)
        throw Error("A sessão do aplicativo já foi iniciada ou encerrada.");
      const browser = browserCandidates().find((path) => existsSync(path));
      if (!browser)
        throw Error(
          "Instale ou solicite ao suporte o Microsoft Edge ou Google Chrome para abrir a janela do sistema.",
        );
      mkdirSync(profile, { recursive: true });
      appUrl = url;
      const target = new URL(url);
      target.searchParams.set("aofDesktop", token);
      child = spawn(
        browser,
        [
          `--app=${target.href}`,
          `--user-data-dir=${profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-mode",
          "--disable-session-crashed-bubble",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
        ],
        { windowsHide: false, stdio: "ignore" },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.once("exit", () => {
        lifetime.processExited = true;
      });
      child.unref();
      timer = setInterval(poll, 500);
      await poll();
    },
    async stop() {
      stopped = true;
      lifetime.finished = true;
      clearInterval(timer);
      if (!child) return;
      // Only the browser endpoint recorded in this isolated profile is allowed.
      // Browser.close also releases PDF tabs belonging to the application.
      let closed = false;
      try {
        closed = await closeProfile(profile);
      } catch {}
      if (!closed && child.exitCode === null && !child.killed) {
        // Enterprise policies can disable DevTools. At most terminate our own
        // directly spawned PID, never search for or kill the user's browsers.
        child.kill();
      }
    },
  };
}
