
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { OpenAI } from "openai";

const app = express();

// ====== Config via env ======
const PORT = process.env.PORT || 10000;
const ZENDESK_ORIGIN = process.env.ZENDESK_ORIGIN || ""; // e.g. https://yourcompany.zendesk.com
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. The service will 500.");
}

// ====== Middleware ======
// Accept JSON and x-www-form-urlencoded (the app uses urlencoded to avoid CORS preflight)
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "1mb" }));

app.use(
  cors({
    origin: (origin, cb) => {
      // Permit Zendesk iframe origin or localhost dev; allow empty origin for curl
      const ok =
        !origin ||
        origin === ZENDESK_ORIGIN ||
        origin === "http://localhost:3000";
      cb(null, ok ? true : false);
    },
    credentials: true,
  })
);

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ====== OpenAI client ======
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== POST /generate ======
// Request: { prompt: string } via JSON or application/x-www-form-urlencoded
// Response: { reply: string }
app.post("/generate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const prompt = (req.body && (req.body.prompt || req.body["prompt"])) || "";
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' string in body" });
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful Tier 3 support assistant for Chaos (V-Ray, Phoenix, Vantage, Cloud).",
        },
        { role: "user", content: prompt },
      ],
    });

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
});
