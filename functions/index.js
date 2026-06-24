const functions = require("firebase-functions/v1");

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
