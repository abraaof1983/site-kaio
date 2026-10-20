import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DesktopLifetime,
  createDesktopSession,
  desktopRequested,
  isApplicationTarget,
  profileDebugSocket,
} from "../desktop-window.js";

const id = "one-window-000000000000";
const other = "two-window-000000000000";
function clock() {
  let at = 0;
  const closed = [];
  const lifecycle = new DesktopLifetime({
    now: () => at,
    onClose: (reason) => closed.push(reason),
  });
  return {
    lifecycle,
    closed,
    advance(ms) {
      at += ms;
      lifecycle.check();
    },
  };
}

test("desktop mode is restricted to Windows app/explicit portable launcher", () => {
  assert.equal(
    desktopRequested({
      platform: "linux",
      env: { AOF_DESKTOP: "1" },
      isPackaged: true,
    }),
    false,
  );
  assert.equal(
    desktopRequested({ platform: "win32", env: {}, isPackaged: false }),
    false,
  );
  assert.equal(
    desktopRequested({
      platform: "win32",
      env: { AOF_DESKTOP: "1" },
      isPackaged: false,
    }),
    true,
  );
  assert.equal(
    desktopRequested({
      platform: "win32",
      env: { AOF_OPEN_BROWSER: "0" },
      isPackaged: true,
    }),
    false,
  );
});

test("closing the app waits for reload and keeps another app page alive", () => {
  const c = clock();
  c.lifecycle.heartbeat(id);
  c.lifecycle.closing(id);
  c.advance(2000);
  c.lifecycle.heartbeat(other);
  c.advance(2000);
  assert.deepEqual(c.closed, []);
  c.lifecycle.closing(other);
  c.advance(3501);
  assert.deepEqual(c.closed, ["window-closed"]);
  c.advance(5000);
  assert.equal(c.closed.length, 1);
});

test("page restore cancels a pending close", () => {
  const c = clock();
  c.lifecycle.heartbeat(id);
  c.lifecycle.closing(id);
  c.advance(2000);
  c.lifecycle.heartbeat(id);
  c.advance(5000);
  assert.deepEqual(c.closed, []);
});

test("Chromium launcher early exit does not close a live session", () => {
  const c = clock();
  c.lifecycle.processExited = true;
  c.lifecycle.heartbeat(id);
  c.advance(4000);
  c.lifecycle.heartbeat(id);
  c.advance(4000);
  assert.deepEqual(c.closed, []);
});

test("real page targets survive timer throttling; PDF-only targets do not", () => {
  const c = clock();
  c.lifecycle.observeWindows(1);
  c.advance(120000);
  c.lifecycle.observeWindows(1);
  c.advance(500);
  assert.deepEqual(c.closed, []);
  c.lifecycle.observeWindows(0);
  c.advance(3501);
  assert.deepEqual(c.closed, ["window-closed"]);
  const app = "http://localhost:3000/";
  assert.equal(
    isApplicationTarget({ type: "page", url: `${app}#/contratos/1` }, app),
    true,
  );
  assert.equal(
    isApplicationTarget(
      { type: "page", url: `${app}api/documents/1/pdf?inline=1` },
      app,
    ),
    false,
  );
  assert.equal(
    isApplicationTarget({ type: "page", url: "https://example.com" }, app),
    false,
  );
});

test("browser exit closes after reconnection grace and startup failure has a deadline", () => {
  const c = clock();
  c.lifecycle.observeWindows(1);
  c.lifecycle.processExited = true;
  c.lifecycle.connectionLost();
  c.advance(3501);
  assert.deepEqual(c.closed, ["browser-closed"]);
  const empty = clock();
  empty.advance(45001);
  assert.deepEqual(empty.closed, ["startup-timeout"]);
});

test("session token accepts only its exact secret; malformed input cannot throw", async () => {
  const session = createDesktopSession({});
  assert.equal(session.validToken(session.token), true);
  assert.equal(session.validToken(null), false);
  assert.equal(session.validToken("x".repeat(64)), false);
  assert.equal(session.validToken("ç".repeat(64)), false);
  await session.stop();
});

test("shutdown only accepts the matching loopback browser endpoint from its own profile", () => {
  const own = { port: 39200, browserPath: "/devtools/browser/own-window" };
  const socket = (url) =>
    profileDebugSocket({ webSocketDebuggerUrl: url }, own);
  assert.equal(
    socket("ws://127.0.0.1:39200/devtools/browser/own-window"),
    "ws://127.0.0.1:39200/devtools/browser/own-window",
  );
  assert.equal(
    socket("ws://127.0.0.1:39200/devtools/browser/another-browser"),
    null,
  );
  assert.equal(
    socket("ws://127.0.0.1:39201/devtools/browser/own-window"),
    null,
  );
  assert.equal(
    socket("ws://example.com:39200/devtools/browser/own-window"),
    null,
  );
});

test("a live page survives lost browser monitoring after an early launcher exit", () => {
  const c = clock();
  c.lifecycle.processExited = true;
  c.lifecycle.observeWindows(1);
  c.lifecycle.heartbeat(id);
  c.lifecycle.connectionLost();
  c.advance(5000);
  assert.deepEqual(c.closed, []);
  c.lifecycle.heartbeat(id);
  c.advance(5000);
  assert.deepEqual(c.closed, []);
  c.lifecycle.closing(id);
  c.advance(3501);
  assert.equal(c.closed.length, 1);
});
