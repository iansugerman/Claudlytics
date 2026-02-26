const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 3031;
const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");

// Pricing per 1M tokens (Claude Sonnet 4.6)
const PRICING = {
  input: 3.0,
  output: 15.0,
  cache_creation_1h: 3.75,
  cache_creation_5m: 3.0,
  cache_read: 0.30,
};

function calcCost(usage) {
  return (
    ((usage.input_tokens || 0) * PRICING.input) / 1e6 +
    ((usage.output_tokens || 0) * PRICING.output) / 1e6 +
    (((usage.cache_creation || {}).ephemeral_1h_input_tokens || 0) * PRICING.cache_creation_1h) / 1e6 +
    (((usage.cache_creation || {}).ephemeral_5m_input_tokens || 0) * PRICING.cache_creation_5m) / 1e6 +
    ((usage.cache_read_input_tokens || 0) * PRICING.cache_read) / 1e6
  );
}

function parseUsageFromDir(sinceMs) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  if (!fs.existsSync(CLAUDE_DIR)) return totals;

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".jsonl")) {
        try {
          const lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type !== "assistant" || !obj.message?.usage) continue;
              const ts = new Date(obj.timestamp).getTime();
              if (ts < sinceMs) continue;
              const u = obj.message.usage;
              totals.input += u.input_tokens || 0;
              totals.output += u.output_tokens || 0;
              totals.cacheRead += u.cache_read_input_tokens || 0;
              totals.cacheWrite += (u.cache_creation_input_tokens || 0);
              totals.cost += calcCost(u);
              totals.messages++;
            } catch {}
          }
        } catch {}
      }
    }
  }
  walk(CLAUDE_DIR);
  return totals;
}

function getCurrentSession() {
  let latest = { mtime: 0, file: null };
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (entry.endsWith(".jsonl") && stat.mtimeMs > latest.mtime) {
        latest = { mtime: stat.mtimeMs, file: full };
      }
    }
  }
  walk(CLAUDE_DIR);
  if (!latest.file) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };

  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  try {
    const lines = fs.readFileSync(latest.file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "assistant" || !obj.message?.usage) continue;
        const u = obj.message.usage;
        totals.input += u.input_tokens || 0;
        totals.output += u.output_tokens || 0;
        totals.cacheRead += u.cache_read_input_tokens || 0;
        totals.cacheWrite += (u.cache_creation_input_tokens || 0);
        totals.cost += calcCost(u);
        totals.messages++;
      } catch {}
    }
  } catch {}
  return totals;
}

function fetchAnthropicUsage(apiKey) {
  return new Promise((resolve) => {
    if (!apiKey) return resolve(null);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const startStr = start.toISOString().split("T")[0];
    const endStr = now.toISOString().split("T")[0];
    const opts = {
      hostname: "api.anthropic.com",
      path: `/v1/usage?start_date=${startStr}&end_date=${endStr}`,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
    const req = https.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

function fetchPlanLimits(sessionKey) {
  return new Promise((resolve) => {
    if (!sessionKey) return resolve(null);
    const opts = {
      hostname: "api.claude.ai",
      path: "/api/usage_limit",
      headers: {
        "Cookie": `sessionKey=${sessionKey}`,
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    };
    const req = https.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function getUsage() {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 6); startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

  const session = getCurrentSession();
  const today = parseUsageFromDir(startOfDay.getTime());
  const week = parseUsageFromDir(startOfWeek.getTime());
  const month = parseUsageFromDir(startOfMonth.getTime());

  const cycleDay = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const cycleProgress = cycleDay / daysInMonth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const sessionKey = process.env.CLAUDE_SESSION_KEY;
  const [apiUsage, planLimits] = await Promise.all([
    fetchAnthropicUsage(apiKey),
    fetchPlanLimits(sessionKey),
  ]);

  return { session, today, week, month, cycleDay, daysInMonth, cycleProgress, apiUsage, planLimits };
}

const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/usage") {
    try {
      const data = await getUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log(`Claude Usage running at http://localhost:${PORT}`);
});
