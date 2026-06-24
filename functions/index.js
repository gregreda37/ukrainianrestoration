const functions = require("firebase-functions/v1");
const { GoogleAuth } = require("google-auth-library");

const CLOUD_RUN_URL = "https://myclaim-backend-fr6sb3q2na-ue.a.run.app";
const _auth = new GoogleAuth();

const CORS_ORIGINS = new Set([
  "https://ukrainianrestoration.com",
  "https://www.ukrainianrestoration.com",
  "https://ukrainianrestoration-50993.web.app",
  "https://ukrainianrestoration-50993.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

/**
 * Proxy all requests to the Flask backend on Cloud Run.
 * Cloud Run blocks allUsers (org policy), so the Function's App Engine SA
 * identity (which has roles/run.invoker) fetches an ID token and attaches it.
 */
exports.backendProxy = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const origin = req.headers.origin;
    if (CORS_ORIGINS.has(origin)) res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    try {
      const client = await _auth.getIdTokenClient(CLOUD_RUN_URL);
      const authHeaders = await client.getRequestHeaders();

      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const targetUrl = `${CLOUD_RUN_URL}${req.path}${query}`;

      const fetchOptions = {
        method: req.method,
        headers: { ...authHeaders, "Content-Type": "application/json" },
      };
      if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const upstream = await fetch(targetUrl, fetchOptions);
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error("backendProxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });

/**
 * Serves the Google Maps JS API URL with the key injected server-side.
 * Secret is set via: firebase functions:secrets:set GOOGLE_MAPS_KEY
 * Accessible via the /api/maps-loader Firebase Hosting rewrite.
 */
exports.mapsLoader = functions
  .runWith({ secrets: ["GOOGLE_MAPS_KEY"] })
  .https.onRequest((req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      console.error("GOOGLE_MAPS_KEY secret is not set");
      res.status(500).json({ error: "Maps key not configured" });
      return;
    }

    res.set("Cache-Control", "private, max-age=3600");
    res.json({
      src: `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`,
    });
  });
