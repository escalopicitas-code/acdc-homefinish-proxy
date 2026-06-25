const express = require("express");

const app = express();
const port = process.env.PORT || 8080;
const allowedHosts = new Set(["homefinish.com.br", "www.homefinish.com.br"]);

function isAuthorized(req) {
  const expected = process.env.PROXY_KEY || "";
  const provided = req.get("X-Proxy-Key") || req.query.key || "";
  return Boolean(expected) && provided === expected;
}

function parseTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL ausente");
  }

  const target = new URL(rawUrl);
  const host = target.hostname.toLowerCase();

  if (target.protocol !== "https:" || !allowedHosts.has(host)) {
    throw new Error("URL nao permitida");
  }

  return target;
}

function requestHeaders(mode) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept":
      mode === "image"
        ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.homefinish.com.br/",
    "Upgrade-Insecure-Requests": "1"
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "acdc-homefinish-proxy" });
});

app.get("/fetch", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).send("Unauthorized");
  }

  let target;
  try {
    target = parseTarget(req.query.url);
  } catch (error) {
    return res.status(400).send(error.message);
  }

  const mode = req.query.mode === "image" ? "image" : "html";

  try {
    const upstream = await fetchWithTimeout(
      target.toString(),
      {
        method: "GET",
        headers: requestHeaders(mode),
        redirect: "follow"
      },
      mode === "image" ? 30000 : 60000
    );

    const contentType = upstream.headers.get("content-type") || (mode === "image" ? "application/octet-stream" : "text/html; charset=utf-8");
    const body = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Upstream-Status", String(upstream.status));
    res.setHeader("X-Relay-Mode", mode);
    res.setHeader("Cache-Control", mode === "image" ? "public, max-age=3600" : "no-store");

    return res.status(upstream.status).send(body);
  } catch (error) {
    console.error("Fetch error:", error && error.message ? error.message : error);
    return res.status(502).send("Fetch failed");
  }
});

app.get("/", (req, res) => {
  res.status(200).send("ACDC Home Finish relay online");
});

app.listen(port, () => {
  console.log(`ACDC Home Finish relay running on port ${port}`);
});
