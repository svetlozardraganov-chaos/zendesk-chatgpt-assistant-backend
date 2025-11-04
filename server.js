import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

const app = express();

// ====== Config via env ======
const PORT = process.env.PORT || 10000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // pick a fast default
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== Allowed origins (Zendesk app iframes + local dev) ======
const STATIC_ALLOW = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
// Allow *.zendesk.com and *.zdusercontent.com
function originAllowed(origin) {
  if (!origin) return true; // allow health checks / curl
  try {
    const u = new URL(origin);
    const h = u.hostname;
    return (
      STATIC_ALLOW.includes(origin) ||
      h.endsWith(".zendesk.com") ||
      h.endsWith(".zdusercontent.com")
    );
  } catch {
    return false;
  }
}

app.use(cors({
  origin: (origin, cb) => {
    if (originAllowed(origin)) cb(null, true);
    else cb(new Error("CORS not allowed for this origin"));
  },
  credentials: true
}));

// ====== Middleware ======
// Accept JSON and x-www-form-urlencoded (the app uses urlencoded to avoid preflight)
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

// Basic health
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

// ====== OpenAI client ======
if (!OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY is not set. Set it in your env for real calls.");
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== Non-streaming endpoint (kept for compatibility) ======
app.post("/generate", async (req, res) => {
  try {
    const { messages, model = OPENAI_MODEL, temperature = 0.2, max_tokens = 800 } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens
    });

    const reply = completion?.choices?.[0]?.message?.content ?? "(No content returned from model)";
    res.json({ reply });
  } catch (err) {
    const message = (err && err.message) || "OpenAI error";
    console.error("Error in /generate:", message);
    res.status(500).json({ error: message });
  }
});

// ====== Streaming endpoint (SSE) ======
app.post("/chat-stream", async (req, res) => {
  try {
    const { messages, model = OPENAI_MODEL, temperature = 0.2, max_tokens = 800 } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.writeHead(400, {
        "Content-Type": "application/json"
      });
      return res.end(JSON.stringify({ error: "messages array is required" }));
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // helpful for proxies
    res.flushHeaders?.();

    // Heartbeat to keep the connection open on some proxies
    const heartbeat = setInterval(() => {
      res.write(`: keep-alive\n\n`);
    }, 15000);

    // Call OpenAI with streaming via SDK
    const stream = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        // SSE frame
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    // Signal end of stream
    res.write("data: [DONE]\n\n");
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    clearTimeout();
    const message = (err && err.message) || "OpenAI stream error";
    console.error("Error in /chat-stream:", message);
    // try to send error frame if headers sent
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
});
