// Only the dedicated Windows app receives this token. Ordinary browser/headless
// use never participates in the desktop lifecycle.
(() => {
  const url = new URL(location.href);
  let token = url.searchParams.get("aofDesktop");
  try {
    if (token) sessionStorage.setItem("aof.desktop.token", token);
    else token = sessionStorage.getItem("aof.desktop.token");
  } catch {}
  if (!/^[a-f0-9]{64}$/.test(token || "")) return;
  if (url.searchParams.has("aofDesktop")) {
    url.searchParams.delete("aofDesktop");
    history.replaceState(
      history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  const windowId = crypto.randomUUID();
  const payload = JSON.stringify({ token, windowId });
  let interval;
  const heartbeat = () =>
    fetch("/api/desktop/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  const start = () => {
    clearInterval(interval);
    heartbeat();
    interval = setInterval(heartbeat, 2000);
  };
  addEventListener("pagehide", () => {
    clearInterval(interval);
    const body = new Blob([payload], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/desktop/close", body)) {
      fetch("/api/desktop/close", {
        method: "POST",
        body,
        keepalive: true,
      }).catch(() => {});
    }
  });
  addEventListener("pageshow", start);
  addEventListener("visibilitychange", () => {
    if (!document.hidden) heartbeat();
  });
  start();
})();
