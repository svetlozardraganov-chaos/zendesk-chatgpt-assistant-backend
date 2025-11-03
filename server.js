import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

const app = express();

// ====== Config via env ======
const PORT = process.env.PORT || 10000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== Middleware ======
// Accept JSON and x-www-form-urlencoded (the app uses urlencoded to avoid preflight)
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

// Always vary on Origin so caches behave
app.use((req, res, next) => {
  res.vary("Origin");
  next();
});

// ====== CORS allowlist (normalize + allow Zendesk app iframe host) ======
const normalize = (o) => (o || "").replace(/\/$/, "");

const listFromEnv = (val) =>
  (val || "")
    .split(",")
    .map((s) => normalize(s.trim()))
    .filter(Boolean);

const ALLOWED_ORIGINS = [
  ...listFromEnv(process.env.ZENDESK_ORIGINS), // comma-separated
  ...listFromEnv(process.env.ZENDESK_ORIGIN),  // single value still supported
  "http://localhost:3000",                     // optional local dev
];

app.use(
  cors({
    origin: (origin, cb) => {
      const o = normalize(origin);
      let host = "";
      try { host = o ? new URL(o).host : ""; } catch {}
      const ok =
        !o || // curl/Postman
        ALLOWED_ORIGINS.includes(o) ||
        host.endsWith(".apps.zdusercontent.com"); // Zendesk app iframe host
      cb(null, ok ? (o || true) : false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Preflight handler
app.options("*", cors());

// Basic request log (helps while setting CORS)
app.use((req, _res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.path} origin=${req.headers.origin || "none"}`
  );
  next();
});

// ====== Health check ======
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ====== OpenAI client ======
if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. /generate will return 500.");
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== POST /generate ======
// Body: { prompt: string } via JSON or x-www-form-urlencoded
// Reply: { reply: string }
app.post("/generate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const prompt =
      (req.body && (req.body.prompt ?? req.body["prompt"])) || "";
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' string in body" });
    }

    const params = {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful Tier 3 support assistant for Chaos (V-Ray, Phoenix, Vantage, Cloud).",
        },
        { role: "user", content: prompt },
      ],
      // NOTE: no temperature — some GPT-5 models only accept the default
    };

    const completion = await openai.chat.completions.create(params);
    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "(No content returned from model)";

    res.json({ reply });
  } catch (err) {
    const message = (err && err.message) || "OpenAI error";
    console.error("Error in /generate:", message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
  console.log("ALLOWED_ORIGINS:", ALLOWED_ORIGINS);
});
