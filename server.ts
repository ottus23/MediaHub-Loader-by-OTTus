import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Readable } from "stream";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// List of public Cobalt instances for redundancy
const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://cobalt.api.red",
  "https://co.wukko.me",
  "https://cobalt.v0.sh",
  "https://api.cobalt.club",
  "https://cobalt.k6.cx",
  "https://cobalt.unlocked.link",
  "https://cobalt.orion-dev.fr",
  "https://cobalt-api.lunes.host",
  "https://cobalt.smartgoku.net"
];

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Endpoint to resolve media metadata (title, source, type, thumbnail, etc.)
app.post("/api/media-info", async (req: express.Request, res: express.Response): Promise<any> => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    let title = "Unknown Media";
    let thumbnail = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80"; // Premium background placeholder
    let duration = 0; // seconds
    let source = "Generic Link";
    let fileType: "video" | "audio" = "video";

    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      source = "YouTube";
      let videoId = "";
      if (hostname.includes("youtu.be")) {
        videoId = parsedUrl.pathname.slice(1);
      } else {
        videoId = parsedUrl.searchParams.get("v") || "";
        if (!videoId && parsedUrl.pathname.includes("/embed/")) {
          videoId = parsedUrl.pathname.split("/embed/")[1]?.split("?")[0] || "";
        }
        if (!videoId && parsedUrl.pathname.includes("/shorts/")) {
          videoId = parsedUrl.pathname.split("/shorts/")[1]?.split("?")[0] || "";
        }
      }

      if (videoId) {
        thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      }

      try {
        // Scrape title from youtube video page
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        const html = await response.text();
        const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/<meta property="og:title" content="(.*?)"/i);
        if (titleMatch) {
          title = titleMatch[1].replace(" - YouTube", "").trim();
        } else {
          title = `YouTube Video (${videoId})`;
        }
      } catch (err) {
        title = `YouTube Video (${videoId})`;
      }
    } else if (hostname.includes("vimeo.com")) {
      source = "Vimeo";
      try {
        const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        if (response.ok) {
          const data = await response.json();
          title = data.title || "Vimeo Video";
          thumbnail = data.thumbnail_url || thumbnail;
          duration = data.duration || 0;
        }
      } catch (err) {
        title = "Vimeo Video";
      }
    } else if (hostname.includes("tiktok.com")) {
      source = "TikTok";
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        const html = await response.text();
        const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/i) || html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else {
          title = "TikTok Video";
        }
      } catch (err) {
        title = "TikTok Video";
      }
    } else if (hostname.includes("soundcloud.com")) {
      source = "SoundCloud";
      fileType = "audio";
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        const html = await response.text();
        const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/i) || html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else {
          title = "SoundCloud Audio";
        }
      } catch (err) {
        title = "SoundCloud Audio";
      }
    } else {
      // Check if direct link to audio/video
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.endsWith(".mp3") || lowerUrl.endsWith(".wav") || lowerUrl.endsWith(".m4a") || lowerUrl.endsWith(".aac") || lowerUrl.endsWith(".ogg")) {
        fileType = "audio";
        title = url.split("/").pop() || "Audio File";
        source = "Direct Audio Link";
      } else if (lowerUrl.endsWith(".mp4") || lowerUrl.endsWith(".webm") || lowerUrl.endsWith(".mkv") || lowerUrl.endsWith(".avi")) {
        fileType = "video";
        title = url.split("/").pop() || "Video File";
        source = "Direct Video Link";
      } else {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          });
          const html = await response.text();
          const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/<meta property="og:title" content="(.*?)"/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
          const imgMatch = html.match(/<meta property="og:image" content="(.*?)"/i);
          if (imgMatch) {
            thumbnail = imgMatch[1];
          }
        } catch (err) {
          title = "Web Media";
        }
      }
    }

    res.json({
      url,
      title,
      thumbnail,
      duration,
      source,
      fileType
    });
  } catch (error: any) {
    res.status(400).json({ error: "Invalid URL or failed to fetch metadata: " + error.message });
  }
});

// Endpoint to process download via Cobalt API (with fallbacks)
app.post("/api/download", async (req: express.Request, res: express.Response): Promise<any> => {
  const { url, videoQuality = "1080", audioFormat = "mp3", isAudioOnly = false, selectedServer, customServerUrl } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Build the array of Cobalt instances to try, prioritizing user configuration
  let instancesToTry = [...COBALT_INSTANCES];
  if (selectedServer && selectedServer !== "auto") {
    let targetServer = selectedServer;
    if (selectedServer === "custom" && customServerUrl) {
      targetServer = customServerUrl.trim();
    }
    
    // Ensure the targeted server has valid URL format
    if (targetServer.startsWith("http://") || targetServer.startsWith("https://")) {
      // Remove any trailing slash to ensure clean request concatenation
      targetServer = targetServer.replace(/\/+$/, "");
      instancesToTry = [targetServer, ...instancesToTry.filter(inst => inst !== targetServer)];
    }
  }

  // Fallback try loop across prioritized Cobalt instances
  let lastError = "";
  for (const instance of instancesToTry) {
    try {
      console.log(`Trying Cobalt instance: ${instance} for URL: ${url}`);
      const cobaltPayload = {
        url,
        videoQuality: videoQuality.toString(),
        audioFormat,
        isAudioOnly: !!isAudioOnly,
        filenamePattern: "classic",
        isNoTTWatermark: true
      };

      const response = await fetch(instance, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(cobaltPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Cobalt instance ${instance} failed:`, errorText);
        lastError = errorText || `HTTP error ${response.status}`;
        continue; // try next instance
      }

      const data = await response.json();
      if (data.status === "error") {
        console.error(`Cobalt error from ${instance}:`, data.text);
        lastError = data.text;
        continue; // try next instance
      }

      // Success! We received either a download URL or a picker list (like TikTok carousel images)
      return res.json({
        success: true,
        status: data.status,
        url: data.url, // For standard success, streaming, or redirects
        picker: data.picker, // Array of files (images/videos)
        audio: data.audio // Audio URL if separate
      });

    } catch (err: any) {
      console.error(`Network error with cobalt instance ${instance}:`, err.message);
      lastError = err.message;
    }
  }

  // If all Cobalt attempts fail, check if the link is a direct media link
  // If it is, we can offer direct downloads as an ultimate fallback
  const lowerUrl = url.toLowerCase();
  const isDirectLink = lowerUrl.endsWith(".mp4") || lowerUrl.endsWith(".webm") || 
                       lowerUrl.endsWith(".mp3") || lowerUrl.endsWith(".wav") || 
                       lowerUrl.endsWith(".m4a") || lowerUrl.endsWith(".aac");

  if (isDirectLink) {
    return res.json({
      success: true,
      status: "direct",
      url: url
    });
  }

  res.status(502).json({
    error: `Media processor is temporarily busy or rate-limited. Details: ${lastError || "Unknown service interruption."}`
  });
});

// Endpoint to proxy downloads to bypass CORS and force direct file saving in browser
app.get("/api/proxy-download", async (req: express.Request, res: express.Response): Promise<any> => {
  const fileUrl = req.query.url as string;
  const filename = (req.query.filename as string) || "downloaded-media";

  if (!fileUrl) {
    return res.status(400).send("Parameter 'url' is required");
  }

  try {
    const response = await fetch(fileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok || !response.body) {
      return res.status(502).send(`Failed to fetch media from source server (status: ${response.status})`);
    }

    // Set appropriate headers to force browser file-save
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }
    
    // Support UTF-8 encoded filenames
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`
    );

    Readable.fromWeb(response.body as any).pipe(res);
  } catch (error: any) {
    console.error("Proxy download error:", error);
    res.status(500).send(`Server-side proxy error: ${error.message}`);
  }
});

async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MediaDownloader] Server running on http://localhost:${PORT} under ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
