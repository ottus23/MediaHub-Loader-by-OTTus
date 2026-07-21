import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Readable } from "stream";
import dotenv from "dotenv";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const DOWNLOADS_DIR = "/tmp/downloads";
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Clean up files in /tmp/downloads older than 15 minutes
function cleanOldDownloads() {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const expiryTime = 15 * 60 * 1000; // 15 minutes
    
    for (const file of files) {
      if (file === "." || file === "..") continue;
      const filePath = path.join(DOWNLOADS_DIR, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > expiryTime) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up expired local download: ${file}`);
        }
      }
    }
  } catch (err: any) {
    console.warn("Cleanup of old downloads failed:", err.message);
  }
}

// Normalize URLs for yt-dlp to bypass platform-specific extraction blocks
function normalizeUrlForYtDlp(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("vimeo.com") && !parsed.hostname.includes("player.vimeo.com")) {
      const match = parsed.pathname.match(/\/(\d+)(?:\/|\?|$)/);
      if (match) {
        const videoId = match[1];
        const h = parsed.searchParams.get("h");
        const query = h ? `?h=${h}` : parsed.search;
        return `https://player.vimeo.com/video/${videoId}${query}`;
      }
    }
  } catch (err) {
    // Ignore and return original
  }
  return url;
}

// Get metadata using yt-dlp as a fallback
async function getMetadataWithYtDlp(url: string) {
  try {
    const targetUrl = normalizeUrlForYtDlp(url);
    console.log(`Invoking yt-dlp metadata extraction for: ${targetUrl}`);
    const { stdout } = await execFileAsync("./yt-dlp", ["-j", "--no-playlist", "--js-runtimes", "node", targetUrl], { timeout: 12000 });
    const data = JSON.parse(stdout);
    
    let thumbnail = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80";
    if (data.thumbnail) {
      thumbnail = data.thumbnail;
    } else if (data.thumbnails && data.thumbnails.length) {
      thumbnail = data.thumbnails[data.thumbnails.length - 1].url;
    }

    return {
      title: data.title || data.fulltitle || "Unknown Media",
      thumbnail: thumbnail,
      duration: data.duration || 0,
      source: data.extractor_key || data.extractor || "Web Link",
      fileType: data.vcodec === "none" ? "audio" : "video"
    };
  } catch (error: any) {
    console.warn("yt-dlp fallback metadata extraction failed:", error.message);
    return null;
  }
}

// Download media using yt-dlp
async function downloadWithYtDlp(url: string, options: { isAudioOnly: boolean; videoQuality?: string; audioFormat?: string; jobId: string }) {
  const { isAudioOnly, videoQuality = "1080", audioFormat = "mp3", jobId } = options;
  const args = ["--no-playlist", "--js-runtimes", "node"];
  
  if (isAudioOnly) {
    args.push("-x");
    const mappedFormat = audioFormat === "ogg" ? "opus" : audioFormat;
    args.push("--audio-format", mappedFormat);
    args.push("--audio-quality", "0");
    args.push("-o", `${DOWNLOADS_DIR}/${jobId}.%(ext)s`);
  } else {
    const qualityStr = videoQuality === "2160" ? "2160" : videoQuality;
    args.push("-f", `bestvideo[height<=${qualityStr}]+bestaudio/best[ext=m4a]/best`);
    args.push("--merge-output-format", "mp4");
    args.push("-o", `${DOWNLOADS_DIR}/${jobId}.%(ext)s`);
  }

  const targetUrl = normalizeUrlForYtDlp(url);
  args.push(targetUrl);

  console.log(`Running local yt-dlp download with args:`, args);
  
  await execFileAsync("./yt-dlp", args, { timeout: 180000 });
  
  const files = fs.readdirSync(DOWNLOADS_DIR);
  const prefix = `${jobId}.`;
  const matchedFile = files.find(f => f.startsWith(prefix));
  
  if (!matchedFile) {
    throw new Error("Downloaded file not found on disk");
  }

  const ext = matchedFile.substring(prefix.length);
  return {
    filePath: path.join(DOWNLOADS_DIR, matchedFile),
    ext
  };
}

// Custom fetch helper with AbortController to enforce tight timeouts on external metadata endpoints
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

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
        const response = await fetchWithTimeout(url, {
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
        const response = await fetchWithTimeout(oembedUrl);
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
        const response = await fetchWithTimeout(url, {
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
        const response = await fetchWithTimeout(url, {
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
          const response = await fetchWithTimeout(url, {
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

    if (title === "Unknown Media" || source === "Generic Link" || title === "Web Media") {
      const ytDlpMeta = await getMetadataWithYtDlp(url);
      if (ytDlpMeta) {
        title = ytDlpMeta.title;
        thumbnail = ytDlpMeta.thumbnail;
        duration = ytDlpMeta.duration;
        source = ytDlpMeta.source;
        fileType = ytDlpMeta.fileType as any;
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
    console.warn("API media-info scraper failed, trying yt-dlp fallback:", error.message);
    const ytDlpMeta = await getMetadataWithYtDlp(url);
    if (ytDlpMeta) {
      return res.json({
        url,
        title: ytDlpMeta.title,
        thumbnail: ytDlpMeta.thumbnail,
        duration: ytDlpMeta.duration,
        source: ytDlpMeta.source,
        fileType: ytDlpMeta.fileType
      });
    }
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
      instancesToTry = [targetServer, ...instancesToTry.filter(inst => inst !== targetServer)];
    }
  }

  // Fallback try loop across prioritized Cobalt instances
  let lastError = "";
  for (const instance of instancesToTry) {
    const baseUrl = instance.trim().replace(/\/+$/, "");
    // Try root (v7/v10), /api/json (v6), and /api as safe redundant fallbacks
    const endpoints = [baseUrl, `${baseUrl}/api/json`, `${baseUrl}/api`];

    for (const endpoint of endpoints) {
      try {
        console.log(`Trying Cobalt endpoint: ${endpoint} for URL: ${url}`);
        
        // Multi-version unified payload (combining both old and new Cobalt fields)
        const cobaltPayload = {
          url,
          videoQuality: videoQuality.toString(),
          vQuality: videoQuality.toString(),
          audioFormat,
          aFormat: audioFormat,
          isAudioOnly: !!isAudioOnly,
          audioOnly: !!isAudioOnly,
          downloadMode: isAudioOnly ? "audio" : "video",
          filenamePattern: "classic",
          isNoTTWatermark: true,
          tiktokH265: true,
          dubLang: false
        };

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            // Mimic high-trust modern Chrome browser to bypass Cloudflare and WAF protections on public mirrors
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://cobalt.tools",
            "Referer": "https://cobalt.tools/",
            "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site"
          },
          body: JSON.stringify(cobaltPayload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`Cobalt endpoint ${endpoint} failed with HTTP ${response.status}:`, errorText.substring(0, 200));
          lastError = errorText || `HTTP error ${response.status}`;
          continue; // try next endpoint/instance
        }

        const data: any = await response.json();
        if (data.status === "error") {
          console.warn(`Cobalt error payload from ${endpoint}:`, data.text);
          lastError = data.text;
          continue; // try next endpoint/instance
        }

        // Success! We received either a download URL or a picker list (like TikTok carousel images)
        console.log(`Successfully extracted download URL using endpoint: ${endpoint}`);
        return res.json({
          success: true,
          status: data.status,
          url: data.url, // For standard success, streaming, or redirects
          picker: data.picker, // Array of files (images/videos)
          audio: data.audio // Audio URL if separate
        });

      } catch (err: any) {
        console.warn(`Network/parsing error on ${endpoint}:`, err.message);
        lastError = err.message;
      }
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

  // Fall back to our super powerful local yt-dlp binary!
  try {
    console.log(`Cobalt mirrors failed or returned rate limits. Falling back to local yt-dlp...`);
    
    // Clean up downloads folder to manage disk space
    cleanOldDownloads();
    
    const serverJobId = Math.random().toString(36).substring(2, 10);
    
    const ytDlpResult = await downloadWithYtDlp(url, {
      isAudioOnly: !!isAudioOnly,
      videoQuality: videoQuality ? videoQuality.toString() : "1080",
      audioFormat: audioFormat ? audioFormat.toString() : "mp3",
      jobId: serverJobId
    });

    console.log(`Local yt-dlp download completed successfully! File is saved at: ${ytDlpResult.filePath}`);
    
    return res.json({
      success: true,
      status: "redirect",
      url: `/api/local-media?id=${serverJobId}&ext=${ytDlpResult.ext}`
    });
  } catch (ytDlpError: any) {
    console.error("Local yt-dlp download fallback also failed:", ytDlpError.message);
    res.status(502).json({
      error: `Media processor is temporarily busy or rate-limited. Details: ${lastError || "Unknown service interruption."} (Local Fallback Error: ${ytDlpError.message})`
    });
  }
});

// Endpoint to proxy downloads to bypass CORS and force direct file saving in browser
app.get("/api/proxy-download", async (req: express.Request, res: express.Response): Promise<any> => {
  const fileUrl = req.query.url as string;
  const filename = (req.query.filename as string) || "downloaded-media";

  if (!fileUrl) {
    return res.status(400).send("Parameter 'url' is required");
  }

  try {
    let targetUrl = fileUrl;
    if (fileUrl.startsWith("/")) {
      targetUrl = `http://127.0.0.1:${PORT}${fileUrl}`;
    }
    
    const response = await fetch(targetUrl, {
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

// Endpoint to serve local downloads produced by the yt-dlp fallback
app.get("/api/local-media", (req: express.Request, res: express.Response): any => {
  const { id, ext, filename } = req.query;
  if (!id || !ext) {
    return res.status(400).send("Parameters 'id' and 'ext' are required");
  }

  const filePath = path.join(DOWNLOADS_DIR, `${id}.${ext}`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Requested media file not found or has expired");
  }

  const downloadName = filename ? (filename.toString().endsWith(`.${ext}`) ? filename.toString() : `${filename}.${ext}`) : `downloaded-media.${ext}`;
  // Force direct attachment download with the correct extension
  res.download(filePath, downloadName);
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
