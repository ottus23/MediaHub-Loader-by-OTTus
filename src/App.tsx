import React, { useState, useEffect, useRef } from "react";
import { 
  Download, 
  Plus, 
  Trash2, 
  Play, 
  FileVideo, 
  FileAudio, 
  Music, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Settings, 
  Sliders, 
  Sparkles, 
  Youtube, 
  CloudLightning,
  Video,
  Database,
  HelpCircle,
  X,
  Volume2,
  ListRestart,
  HardDrive,
  ListPlus,
  Compass
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DownloadJob, DownloadOptions, GlobalSettings, JobStatus } from "./types";

export default function App() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [rawLinks, setRawLinks] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"download" | "batch" | "guide">("download");
  
  // Global settings for batch processing
  const [settings, setSettings] = useState<GlobalSettings>({
    defaultQuality: "1080",
    defaultAudioFormat: "mp3",
    defaultMode: "video",
    autoDownload: false
  });

  // Modal stats for downloaded media
  const [totalDataSaved, setTotalDataSaved] = useState<number>(0); // in MB
  const [activeDownloadsCount, setActiveDownloadsCount] = useState<number>(0);

  // Preview Modal state
  const [previewJob, setPreviewJob] = useState<DownloadJob | null>(null);

  // Track active animation intervals
  const downloadIntervals = useRef<{ [key: string]: NodeJS.Timeout }>({});

  useEffect(() => {
    // Count active downloads
    const activeCount = jobs.filter(
      j => j.status === "fetching" || j.status === "downloading"
    ).length;
    setActiveDownloadsCount(activeCount);
  }, [jobs]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(downloadIntervals.current).forEach(clearInterval);
    };
  }, []);

  // Format Helper for byte sizing
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "Calculating...";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Helper to estimate file size based on duration, quality, and mode
  const estimateFileSize = (duration: number, options: DownloadOptions): number => {
    const mins = duration > 0 ? duration / 60 : 3.5; // Default to 3.5 minutes if unknown
    
    if (options.isAudioOnly) {
      if (options.audioFormat === "wav") {
        return mins * 10 * 1024 * 1024; // WAV ~ 10MB/min
      }
      return mins * 1.2 * 1024 * 1024; // MP3/M4A ~ 1.2MB/min
    } else {
      switch (options.videoQuality) {
        case "2160": return mins * 35 * 1024 * 1024; // 4K ~ 35MB/min
        case "1080": return mins * 12 * 1024 * 1024; // 1080p ~ 12MB/min
        case "720":  return mins * 6 * 1024 * 1024;  // 720p ~ 6MB/min
        case "480":  return mins * 3 * 1024 * 1024;  // 480p ~ 3MB/min
        case "360":  return mins * 1.5 * 1024 * 1024; // 360p ~ 1.5MB/min
        default:     return mins * 12 * 1024 * 1024;
      }
    }
  };

  // Extract links from input string (supports spaces, commas, newlines)
  const parseLinks = (text: string): string[] => {
    const urlRegex = /(https?:\/\/[^\s,]+)/gi;
    const matches = text.match(urlRegex) || [];
    return matches.map(m => m.trim());
  };

  // Create a new empty job
  const createJob = (url: string): DownloadJob => {
    const id = Math.random().toString(36).substring(2, 9);
    const isAudioOnly = settings.defaultMode === "audio";
    
    return {
      id,
      url,
      status: "idle",
      title: "Analyzing Link...",
      thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
      source: "Resolving...",
      fileType: isAudioOnly ? "audio" : "video",
      duration: 0,
      options: {
        videoQuality: settings.defaultQuality as any,
        audioFormat: settings.defaultAudioFormat as any,
        isAudioOnly
      },
      progress: 0,
      speed: "0 KB/s",
      sizeBytes: 0
    };
  };

  // Add individual single URL
  const handleAddSingleUrl = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const singleUrl = (data.get("singleUrl") as string || "").trim();
    if (!singleUrl) return;

    // Validate URL structure
    try {
      new URL(singleUrl);
    } catch (_) {
      alert("Please enter a valid URL (starting with http:// or https://)");
      return;
    }

    const job = createJob(singleUrl);
    setJobs(prev => [job, ...prev]);
    e.currentTarget.reset();

    // Analyze immediately
    analyzeJob(job.id, singleUrl);
  };

  // Add multiple links at once
  const handleAddBatchUrls = () => {
    const extracted = parseLinks(rawLinks);
    if (extracted.length === 0) {
      alert("No valid URLs found in the text area.");
      return;
    }

    const newJobs = extracted.map(url => createJob(url));
    setJobs(prev => [...newJobs, ...prev]);
    setRawLinks("");
    setActiveTab("download"); // switch back to view list

    // Trigger analysis for all new links
    newJobs.forEach(job => {
      analyzeJob(job.id, job.url);
    });
  };

  // Fetch metadata from server
  const analyzeJob = async (jobId: string, url: string) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "analyzing" } : j));

    try {
      const response = await fetch("/api/media-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error("Failed to resolve URL meta information");
      }

      const meta = await response.json();
      
      setJobs(prev => prev.map(j => {
        if (j.id === jobId) {
          const sizeBytes = estimateFileSize(meta.duration || 0, j.options);
          return {
            ...j,
            status: "ready",
            title: meta.title || "Untitled Media",
            thumbnail: meta.thumbnail || j.thumbnail,
            source: meta.source || "Web Link",
            fileType: meta.fileType || j.fileType,
            duration: meta.duration || 0,
            sizeBytes,
            fileName: generateFileName(meta.title || "Untitled Media", j.options)
          };
        }
        return j;
      }));

      // If autoDownload is checked, trigger start download immediately
      if (settings.autoDownload) {
        setTimeout(() => triggerDownload(jobId), 300);
      }

    } catch (err: any) {
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        status: "failed", 
        error: "Unable to analyze media page. Check link format or platform availability." 
      } : j));
    }
  };

  // Helper to generate sanitized output file name
  const generateFileName = (title: string, options: DownloadOptions): string => {
    const sanitized = title.replace(/[/\\?%*:|"<>]/g, "").substring(0, 60).trim();
    if (options.isAudioOnly) {
      return `${sanitized}.${options.audioFormat}`;
    } else {
      return `${sanitized}.mp4`; // standard mp4 wrapper
    }
  };

  // Handle configuration changes on individual job cards
  const updateJobOptions = (jobId: string, updates: Partial<DownloadOptions>) => {
    setJobs(prev => prev.map(j => {
      if (j.id === jobId) {
        const newOptions = { ...j.options, ...updates };
        const fileType = newOptions.isAudioOnly ? "audio" : "video";
        const sizeBytes = estimateFileSize(j.duration, newOptions);
        const fileName = generateFileName(j.title, newOptions);
        return {
          ...j,
          options: newOptions,
          fileType,
          sizeBytes,
          fileName
        };
      }
      return j;
    }));
  };

  // Start Downloading
  const triggerDownload = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "fetching", error: undefined, progress: 0 } : j));

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: job.url,
          videoQuality: job.options.videoQuality,
          audioFormat: job.options.audioFormat,
          isAudioOnly: job.options.isAudioOnly
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Media downloader service rate limit reached.");
      }

      const downloadResult = await response.json();

      // Check for direct, success or redirect status
      let finalDownloadUrl = downloadResult.url;
      let pickerItems = downloadResult.picker;

      // Update state to downloading and initiate high-fidelity progress animation
      setJobs(prev => prev.map(j => {
        if (j.id === jobId) {
          return {
            ...j,
            status: "downloading",
            downloadUrl: finalDownloadUrl,
            pickerItems: pickerItems
          };
        }
        return j;
      }));

      // Initiate realistic download sequence simulation
      startProgressSimulation(jobId, finalDownloadUrl, job.fileName || "downloaded-media", job.sizeBytes);

    } catch (err: any) {
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        status: "failed", 
        error: err.message || "Failed to compile media format." 
      } : j));
    }
  };

  // Progress simulation that outputs visual chunk speeds, files sizes, and triggers browser file save
  const startProgressSimulation = (jobId: string, downloadUrl: string, fileName: string, sizeBytes: number) => {
    if (downloadIntervals.current[jobId]) {
      clearInterval(downloadIntervals.current[jobId]);
    }

    let progress = 0;
    const totalSize = sizeBytes || 5 * 1024 * 1024; // fallback to 5MB

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 8) + 4; // increment 4% to 12%
      
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        delete downloadIntervals.current[jobId];

        // Mark as completed
        setJobs(prev => prev.map(j => j.id === jobId ? { 
          ...j, 
          status: "completed", 
          progress: 100,
          speed: "Done" 
        } : j));

        // Increment data saved
        const fileMb = totalSize / (1024 * 1024);
        setTotalDataSaved(prev => prev + fileMb);

        // Initiate client-side save using our CORS proxy endpoint
        triggerBrowserSave(downloadUrl, fileName);
      } else {
        // Calculate random speed fluctuation (e.g. 3.2 MB/s to 12.5 MB/s)
        const currentSpeed = (3.5 + Math.random() * 8.5).toFixed(1) + " MB/s";
        setJobs(prev => prev.map(j => j.id === jobId ? { 
          ...j, 
          progress: progress, 
          speed: currentSpeed 
        } : j));
      }
    }, 250);

    downloadIntervals.current[jobId] = interval;
  };

  // Helper to trigger standard browser download file saving via proxy
  const triggerBrowserSave = (directUrl: string, fileName: string) => {
    if (!directUrl) return;
    
    // Create direct proxy URL which overrides header to attachment download
    const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(fileName)}`;
    
    const anchor = document.createElement("a");
    anchor.href = proxyUrl;
    anchor.setAttribute("download", fileName);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  // Retry failed downloads
  const handleRetryJob = (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (job.status === "failed") {
      if (job.title === "Analyzing Link...") {
        analyzeJob(jobId, job.url);
      } else {
        triggerDownload(jobId);
      }
    }
  };

  // Delete Job from list
  const handleDeleteJob = (jobId: string) => {
    if (downloadIntervals.current[jobId]) {
      clearInterval(downloadIntervals.current[jobId]);
      delete downloadIntervals.current[jobId];
    }
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  // Trigger download on all ready jobs (Batch Action)
  const handleDownloadAllReady = () => {
    const readyJobs = jobs.filter(j => j.status === "ready");
    if (readyJobs.length === 0) {
      alert("No ready links found. Add and analyze some links first!");
      return;
    }
    readyJobs.forEach(job => {
      triggerDownload(job.id);
    });
  };

  // Clear completed jobs
  const handleClearCompleted = () => {
    setJobs(prev => prev.filter(j => j.status !== "completed"));
  };

  // Clear all jobs
  const handleClearAll = () => {
    // Clear all active timers
    Object.values(downloadIntervals.current).forEach(clearInterval);
    downloadIntervals.current = {};
    setJobs([]);
  };

  // Apply batch global setting changes to all idle/ready jobs
  const handleApplyGlobalSettings = (format: "mp3" | "wav" | "m4a" | "video") => {
    setJobs(prev => prev.map(j => {
      if (j.status === "idle" || j.status === "ready") {
        const isAudioOnly = format !== "video";
        const audioFormat = isAudioOnly ? format : j.options.audioFormat;
        const newOptions = {
          ...j.options,
          isAudioOnly,
          audioFormat
        };
        const sizeBytes = estimateFileSize(j.duration, newOptions);
        const fileName = generateFileName(j.title, newOptions);
        return {
          ...j,
          options: newOptions,
          fileType: isAudioOnly ? "audio" : "video" as any,
          sizeBytes,
          fileName
        };
      }
      return j;
    }));
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex flex-col selection:bg-black selection:text-white" id="main_root">
      
      {/* Top Glassmorphic Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100 px-4 py-4 sm:px-12 flex items-center justify-between" id="app_header">
        <div className="flex items-center space-x-3">
          <div className="bg-black p-2 rounded-lg shadow-sm">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-display font-semibold text-xl tracking-tight text-black">
              MediaHub Loader
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200/80 font-mono">
              v1.5 PRO
            </span>
          </div>
        </div>

        {/* Global Dashboard Metrics */}
        <div className="flex items-center space-x-3 sm:space-x-6">
          <div className="hidden md:flex items-center space-x-2 bg-gray-50/80 py-1.5 px-3 rounded-lg border border-gray-150">
            <Database className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500">Total Saved:</span>
            <span className="font-mono text-xs font-semibold text-black">
              {totalDataSaved.toFixed(1)} MB
            </span>
          </div>
          <div className="flex items-center space-x-2 bg-gray-50/80 py-1.5 px-3 rounded-lg border border-gray-150">
            <CloudLightning className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500">Queue:</span>
            <span className="font-mono text-xs font-semibold text-black">
              {jobs.length} files
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6" id="dashboard_body">
        
        {/* Left Side: Inputs & Settings Panel (Span 5 on Large Screens) */}
        <section className="lg:col-span-5 space-y-6">
          
          {/* Main Tab Controls */}
          <div className="flex bg-white p-1 rounded-xl border border-gray-200">
            <button
              onClick={() => setActiveTab("download")}
              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-xs sm:text-sm transition-all duration-200 flex items-center justify-center space-x-2 ${
                activeTab === "download" 
                  ? "bg-black text-white shadow-sm" 
                  : "text-gray-500 hover:text-black"
              }`}
              id="tab_single"
            >
              <Plus className="w-4 h-4" />
              <span>Add Links</span>
            </button>
            <button
              onClick={() => setActiveTab("batch")}
              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-xs sm:text-sm transition-all duration-200 flex items-center justify-center space-x-2 ${
                activeTab === "batch" 
                  ? "bg-black text-white shadow-sm" 
                  : "text-gray-500 hover:text-black"
              }`}
              id="tab_batch"
            >
              <ListPlus className="w-4 h-4" />
              <span>Batch Input</span>
            </button>
            <button
              onClick={() => setActiveTab("guide")}
              className={`flex-1 py-2.5 px-4 rounded-lg font-medium text-xs sm:text-sm transition-all duration-200 flex items-center justify-center space-x-2 ${
                activeTab === "guide" 
                  ? "bg-black text-white shadow-sm" 
                  : "text-gray-500 hover:text-black"
              }`}
              id="tab_guide"
            >
              <HelpCircle className="w-4 h-4" />
              <span>Platforms</span>
            </button>
          </div>

          {/* Tab Content Panels */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05)] relative overflow-hidden">
            
            {/* Panel 1: Single URL Quick Adder */}
            {activeTab === "download" && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-display font-medium text-lg text-black flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-black" />
                    <span>Quick Media Adder</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Paste a single video, audio, or social link to parse resolution and download options automatically.
                  </p>
                </div>

                <form onSubmit={handleAddSingleUrl} className="space-y-3">
                  <div className="relative">
                    <input
                      name="singleUrl"
                      type="url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      required
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-4 pr-12 text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all font-mono"
                      id="input_single_url"
                    />
                    <button
                      type="submit"
                      className="absolute right-2 top-2 p-1.5 bg-black hover:bg-gray-800 text-white rounded-lg transition-colors duration-200 cursor-pointer"
                      title="Add Media"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </form>

                <div className="pt-3 border-t border-gray-150">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                    <Settings className="w-3.5 h-3.5 text-black" />
                    <span>Global Default Import Settings</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] text-gray-400 font-mono mb-1 uppercase">Media Mode</label>
                      <select
                        value={settings.defaultMode}
                        onChange={(e) => setSettings(p => ({ ...p, defaultMode: e.target.value as any }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs text-black focus:outline-none focus:ring-1 focus:ring-black"
                      >
                        <option value="video">🎥 High Quality Video</option>
                        <option value="audio">🎵 High Quality Audio</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 font-mono mb-1 uppercase">Default Quality</label>
                      <select
                        value={settings.defaultQuality}
                        onChange={(e) => setSettings(p => ({ ...p, defaultQuality: e.target.value as any }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs text-black focus:outline-none focus:ring-1 focus:ring-black"
                      >
                        <option value="2160">2160p (4K UHD)</option>
                        <option value="1080">1080p (Full HD)</option>
                        <option value="720">720p (HD)</option>
                        <option value="480">480p (SD)</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border border-gray-250">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-black">Auto-Download on Paste</span>
                      <span className="text-[10px] text-gray-500">Automatically run and compile upon adding URL</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.autoDownload}
                        onChange={(e) => setSettings(p => ({ ...p, autoDownload: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black peer-checked:after:bg-white peer-checked:after:border-black"></div>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Panel 2: Batch URL Multi-Line Input */}
            {activeTab === "batch" && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-display font-medium text-lg text-black flex items-center space-x-2">
                    <ListPlus className="w-4 h-4 text-black" />
                    <span>Batch URL Paste Zone</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Paste multiple links (one per line, or separated by commas/spaces) to import them in parallel.
                  </p>
                </div>

                <div className="space-y-2">
                  <textarea
                    rows={6}
                    placeholder="https://www.youtube.com/watch?v=12345&#10;https://soundcloud.com/artist/track&#10;https://www.tiktok.com/@user/video/..."
                    value={rawLinks}
                    onChange={(e) => setRawLinks(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs sm:text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-black focus:border-black font-mono resize-y min-h-[140px]"
                    id="input_batch_links"
                  />
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>Parsed Links Count: <b className="text-black font-mono">{parseLinks(rawLinks).length}</b></span>
                    <span>Supports multi-platform queueing</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddBatchUrls}
                  className="w-full bg-black hover:bg-gray-800 text-white rounded-xl py-3 text-sm font-medium transition-colors duration-250 flex items-center justify-center space-x-2 cursor-pointer shadow-sm"
                  id="btn_import_batch"
                >
                  <Plus className="w-4 h-4" />
                  <span>Import & Analyze Queue</span>
                </button>
              </motion.div>
            )}

            {/* Panel 3: Supported Platforms & Formats */}
            {activeTab === "guide" && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-display font-medium text-base text-black">
                    Supported Platforms & Resolutions
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Extract media seamlessly from any of the following platforms in maximum quality:
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200 flex items-center space-x-2.5">
                    <div className="bg-red-500/10 p-1.5 rounded-lg text-red-500">
                      <Youtube className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block font-medium text-black">YouTube</span>
                      <span className="text-[10px] text-gray-500">Up to 4K UHD</span>
                    </div>
                  </div>

                  <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200 flex items-center space-x-2.5">
                    <div className="bg-blue-500/10 p-1.5 rounded-lg text-blue-500">
                      <Video className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block font-medium text-black">Vimeo</span>
                      <span className="text-[10px] text-gray-500">Up to 1080p HD</span>
                    </div>
                  </div>

                  <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200 flex items-center space-x-2.5">
                    <div className="bg-violet-500/10 p-1.5 rounded-lg text-violet-500">
                      <Music className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block font-medium text-black">SoundCloud</span>
                      <span className="text-[10px] text-gray-500">WAV & 320kbps MP3</span>
                    </div>
                  </div>

                  <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200 flex items-center space-x-2.5">
                    <div className="bg-gray-200 p-1.5 rounded-lg text-gray-700">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block font-medium text-black">Direct Links</span>
                      <span className="text-[10px] text-gray-500">Fast CDN bypass</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200">
                  <h4 className="text-xs font-semibold text-black uppercase tracking-wider mb-1">How it works:</h4>
                  <ol className="list-decimal list-inside text-[11px] text-gray-600 space-y-1">
                    <li>Add your media links via single or batch inputs</li>
                    <li>Choose your format (e.g. video MP4, or audio MP3)</li>
                    <li>Select resolution quality (up to 4K resolution)</li>
                    <li>Download instantly, directly processed by server proxy!</li>
                  </ol>
                </div>
              </motion.div>
            )}

          </div>

          {/* Quick-Action Queue Controller Panel */}
          {jobs.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05)]">
              <h3 className="font-display font-semibold text-xs text-gray-500 uppercase tracking-wider">
                Batch Commands
              </h3>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleDownloadAllReady}
                  className="bg-black hover:bg-gray-800 text-white text-xs font-semibold py-2.5 px-3 rounded-lg transition-colors flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Start All Ready ({jobs.filter(j => j.status === 'ready').length})</span>
                </button>
                <button
                  onClick={handleClearCompleted}
                  className="bg-white hover:bg-gray-50 text-black text-xs font-semibold py-2.5 px-3 rounded-lg border border-gray-250 transition-colors flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Completed</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 border-t border-gray-200 pt-3">
                <button
                  onClick={() => handleApplyGlobalSettings("mp3")}
                  className="bg-gray-50 hover:bg-gray-100 text-[10px] text-black py-1.5 px-2 rounded-md border border-gray-200 transition-colors cursor-pointer"
                >
                  Set all: MP3
                </button>
                <button
                  onClick={() => handleApplyGlobalSettings("wav")}
                  className="bg-gray-50 hover:bg-gray-100 text-[10px] text-black py-1.5 px-2 rounded-md border border-gray-200 transition-colors cursor-pointer"
                >
                  Set all: WAV
                </button>
                <button
                  onClick={() => handleApplyGlobalSettings("video")}
                  className="bg-gray-50 hover:bg-gray-100 text-[10px] text-black py-1.5 px-2 rounded-md border border-gray-200 transition-colors cursor-pointer"
                >
                  Set all: Video
                </button>
              </div>

              <button
                onClick={handleClearAll}
                className="w-full text-center text-xs text-rose-600 hover:text-rose-700 transition-colors py-1 cursor-pointer font-medium"
              >
                Clear Entire Queue
              </button>
            </div>
          )}

        </section>

        {/* Right Side: Interactive Queue Grid / List (Span 7 on Large Screens) */}
        <section className="lg:col-span-7 flex flex-col space-y-4" id="queue_section">
          
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg text-black flex items-center space-x-2">
              <CloudLightning className="w-4 h-4 text-black" />
              <span>Downloader Queue ({jobs.length})</span>
            </h2>
            <span className="text-xs text-gray-500 font-mono">
              Status monitor
            </span>
          </div>

          <div className="flex-1 min-h-[450px] bg-gray-50/50 border border-gray-200 rounded-2xl p-4 md:p-6 overflow-y-auto space-y-4 max-h-[750px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)]">
            <AnimatePresence initial={false}>
              {jobs.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20"
                >
                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <Download className="w-8 h-8 text-black mx-auto" />
                  </div>
                  <div className="max-w-sm">
                    <p className="text-sm font-medium text-black">Your download queue is empty</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Paste a URL above or import multiple URLs in the Batch tab to trigger high quality video/audio downloads.
                    </p>
                  </div>
                </motion.div>
              ) : (
                jobs.map((job) => (
                  <motion.div
                    key={job.id}
                    layoutId={`job-card-${job.id}`}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col space-y-3 relative overflow-hidden group hover:border-gray-300 transition-all shadow-sm"
                  >
                    
                    {/* Upper card core information */}
                    <div className="flex space-x-4">
                      
                      {/* Media Thumbnail representation */}
                      <div className="relative w-24 h-16 sm:w-28 sm:h-20 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                        <img 
                          src={job.thumbnail} 
                          alt={job.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          onError={(e) => {
                            // fallback on image error
                            e.currentTarget.src = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80";
                          }}
                        />
                        {/* Overlay platform badge */}
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/85 backdrop-blur-sm uppercase tracking-wider">
                          {job.source}
                        </div>
                        {/* Overlay duration badge if exists */}
                        {job.duration > 0 && (
                          <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[8px] font-mono text-white bg-black/75">
                            {Math.floor(job.duration / 60)}:{(job.duration % 60).toString().padStart(2, '0')}
                          </div>
                        )}
                      </div>
                      
                      {/* Title & Path description */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <h4 className="text-xs sm:text-sm font-semibold text-black truncate pr-6" title={job.title}>
                            {job.title}
                          </h4>
                          <span className="block text-[10px] text-gray-400 font-mono mt-0.5 truncate max-w-xs sm:max-w-md">
                            {job.url}
                          </span>
                        </div>

                        {/* Dropdowns / config options inside individual cards */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          
                          {/* File format toggler [Video] vs [Audio] */}
                          <div className="inline-flex bg-gray-50 p-0.5 rounded-lg border border-gray-200">
                            <button
                              onClick={() => updateJobOptions(job.id, { isAudioOnly: false })}
                              disabled={job.status !== "idle" && job.status !== "ready"}
                              className={`p-1 px-2 rounded-md text-[10px] font-medium transition-colors flex items-center space-x-1 cursor-pointer ${
                                !job.options.isAudioOnly
                                  ? "bg-black text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              <FileVideo className="w-3 h-3" />
                              <span>Video</span>
                            </button>
                            <button
                              onClick={() => updateJobOptions(job.id, { isAudioOnly: true })}
                              disabled={job.status !== "idle" && job.status !== "ready"}
                              className={`p-1 px-2 rounded-md text-[10px] font-medium transition-colors flex items-center space-x-1 cursor-pointer ${
                                job.options.isAudioOnly
                                  ? "bg-black text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              <FileAudio className="w-3 h-3" />
                              <span>Audio</span>
                            </button>
                          </div>

                          {/* Extra Format Options Dropdown */}
                          {job.options.isAudioOnly ? (
                            <select
                              value={job.options.audioFormat}
                              onChange={(e) => updateJobOptions(job.id, { audioFormat: e.target.value as any })}
                              disabled={job.status !== "idle" && job.status !== "ready"}
                              className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-[10px] text-black focus:outline-none focus:ring-1 focus:ring-black"
                            >
                              <option value="mp3">MP3 (320kbps)</option>
                              <option value="wav">WAV (Lossless)</option>
                              <option value="m4a">M4A (AAC)</option>
                              <option value="ogg">OGG (Opus)</option>
                            </select>
                          ) : (
                            <select
                              value={job.options.videoQuality}
                              onChange={(e) => updateJobOptions(job.id, { videoQuality: e.target.value as any })}
                              disabled={job.status !== "idle" && job.status !== "ready"}
                              className="bg-gray-50 border border-gray-200 rounded-lg py-1 px-2 text-[10px] text-black focus:outline-none focus:ring-1 focus:ring-black"
                            >
                              <option value="2160">2160p (4K UHD)</option>
                              <option value="1080">1080p (Full HD)</option>
                              <option value="720">720p (HD)</option>
                              <option value="480">480p (SD)</option>
                              <option value="360">360p (Mobile)</option>
                            </select>
                          )}

                          {/* Render estimated file size */}
                          {job.sizeBytes > 0 && (
                            <span className="text-[10px] text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded-lg border border-gray-200">
                              Est: {formatBytes(job.sizeBytes)}
                            </span>
                          )}

                        </div>
                      </div>

                      {/* Card Delete Button */}
                      <button
                        onClick={() => handleDeleteJob(job.id)}
                        className="absolute top-3 right-3 text-gray-400 hover:text-rose-600 transition-colors p-1 cursor-pointer"
                        title="Remove from queue"
                      >
                        <X className="w-4 h-4" />
                      </button>

                    </div>

                    {/* Progress Monitor Layout (Only visible when starting analysis/download) */}
                    {(job.status !== "idle" && job.status !== "ready") && (
                      <div className="pt-2 border-t border-gray-100 space-y-1.5">
                        
                        {/* Live labels for downloading/converting */}
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="font-mono text-gray-500 flex items-center space-x-1">
                            {job.status === "analyzing" && (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                                <span>Scraping video metadata...</span>
                              </>
                            )}
                            {job.status === "fetching" && (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                                <span>Encoding server stream...</span>
                              </>
                            )}
                            {job.status === "downloading" && (
                              <>
                                <Download className="w-3.5 h-3.5 text-black animate-bounce" />
                                <span>Downloading: <b className="text-black font-mono">{job.speed}</b></span>
                              </>
                            )}
                            {job.status === "completed" && (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-600 font-semibold">Ready - Saved to Device!</span>
                              </>
                            )}
                            {job.status === "failed" && (
                              <>
                                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span className="text-rose-600 font-medium">Bypassed/Rate-Limited</span>
                              </>
                            )}
                          </span>

                          {/* Progress Percentage */}
                          {(job.status === "downloading" || job.status === "completed") && (
                            <span className="font-mono font-semibold text-black">
                              {job.progress}%
                            </span>
                          )}
                        </div>

                        {/* Interactive dynamic progress bar */}
                        {(job.status === "downloading" || job.status === "completed") && (
                          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                            <motion.div 
                              className="bg-black h-full rounded-full"
                              initial={{ width: "0%" }}
                              animate={{ width: `${job.progress}%` }}
                              transition={{ duration: 0.2 }}
                            />
                          </div>
                        )}

                        {/* Display error information */}
                        {job.status === "failed" && job.error && (
                          <p className="text-[10px] text-rose-600 leading-relaxed bg-rose-50 p-2 rounded border border-rose-100">
                            {job.error}
                          </p>
                        )}

                      </div>
                    )}

                    {/* Footer Action buttons on individual cards */}
                    <div className="flex items-center justify-end space-x-2 pt-1 border-t border-gray-100">
                      
                      {job.status === "analyzing" && (
                        <div className="text-[11px] text-gray-400 italic pr-2">Connecting to platform headers...</div>
                      )}

                      {job.status === "ready" && (
                        <button
                          onClick={() => triggerDownload(job.id)}
                          className="bg-black hover:bg-gray-800 text-white text-xs font-medium py-2 px-4 rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Generate Download Link</span>
                        </button>
                      )}

                      {job.status === "failed" && (
                        <>
                          <button
                            onClick={() => handleRetryJob(job.id)}
                            className="bg-gray-100 hover:bg-gray-200 text-black text-xs font-medium py-1.5 px-3 rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                          
                          {/* Fallback button if bypassed/blocked */}
                          <a
                            href={`https://cobalt.tools`}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-gray-50 hover:bg-gray-100 text-black border border-gray-200 text-xs font-medium py-1.5 px-3 rounded-lg flex items-center space-x-1.5 transition-colors"
                          >
                            <span>Open Web Bypass</span>
                          </a>
                        </>
                      )}

                      {job.status === "completed" && (
                        <>
                          {/* Preview media player button */}
                          {job.downloadUrl && (
                            <button
                              onClick={() => setPreviewJob(job)}
                              className="bg-gray-100 hover:bg-gray-200 text-black text-xs font-medium py-1.5 px-3 rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Preview Player</span>
                            </button>
                          )}
                          
                          <button
                            onClick={() => {
                              if (job.downloadUrl) {
                                triggerBrowserSave(job.downloadUrl, job.fileName || "media");
                              }
                            }}
                            className="bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 border border-emerald-200 text-xs font-medium py-1.5 px-3 rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Save File Again</span>
                          </button>
                        </>
                      )}

                    </div>

                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

        </section>

      </main>

      {/* Integrated HTML Audio/Video Preview Player Modal */}
      <AnimatePresence>
        {previewJob && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-gray-200 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl"
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-150 flex items-center justify-between bg-gray-50">
                <div className="flex items-center space-x-2">
                  <Play className="w-4 h-4 text-black animate-pulse" />
                  <span className="font-display font-semibold text-black">Media Preview Player</span>
                </div>
                <button
                  onClick={() => setPreviewJob(null)}
                  className="text-gray-400 hover:text-black p-1 rounded-lg hover:bg-gray-150 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Player Body */}
              <div className="p-6 flex flex-col items-center justify-center space-y-4">
                
                {previewJob.options.isAudioOnly ? (
                  /* Audio player layout */
                  <div className="w-full text-center space-y-6 py-6">
                    <div className="mx-auto w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center border border-gray-200 relative">
                      <Music className="w-10 h-10 text-black" />
                      <div className="absolute inset-0 border border-gray-250 rounded-full animate-ping opacity-75"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-black text-base">{previewJob.title}</h4>
                      <p className="text-xs text-gray-500 font-mono mt-1">Source: {previewJob.source} • Format: {previewJob.options.audioFormat.toUpperCase()}</p>
                    </div>
                    <audio 
                      controls 
                      autoPlay
                      className="w-full h-12 rounded-lg"
                      src={`/api/proxy-download?url=${encodeURIComponent(previewJob.downloadUrl || "")}&filename=${encodeURIComponent(previewJob.fileName || "audio")}`}
                    >
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                ) : (
                  /* Video player layout */
                  <div className="w-full space-y-4">
                    <div className="aspect-video w-full bg-black rounded-lg overflow-hidden border border-gray-200 relative">
                      <video
                        controls
                        autoPlay
                        className="w-full h-full"
                        src={`/api/proxy-download?url=${encodeURIComponent(previewJob.downloadUrl || "")}&filename=${encodeURIComponent(previewJob.fileName || "video")}`}
                      >
                        Your browser does not support the video element.
                      </video>
                    </div>
                    <div>
                      <h4 className="font-semibold text-black text-sm truncate">{previewJob.title}</h4>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">Source: {previewJob.source} • Quality: {previewJob.options.videoQuality}p HD</p>
                    </div>
                  </div>
                )}

              </div>

              {/* Actions Footer */}
              <div className="p-4 border-t border-gray-150 bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-400 font-mono">
                  Streaming directly via local server proxy
                </span>
                <button
                  onClick={() => {
                    if (previewJob.downloadUrl) {
                      triggerBrowserSave(previewJob.downloadUrl, previewJob.fileName || "media");
                      setPreviewJob(null);
                    }
                  }}
                  className="bg-black hover:bg-gray-800 text-white text-xs font-semibold py-2 px-4 rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download File</span>
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Standard Footer */}
      <footer className="bg-white border-t border-gray-150 py-6 px-4 text-center text-gray-400 text-xs space-y-2 mt-auto" id="app_footer_info">
        <div className="flex items-center justify-center space-x-4">
          <span>⚡ Multi-Thread API Scraping</span>
          <span>•</span>
          <span>🔒 Secure Server Proxy</span>
          <span>•</span>
          <span>🎨 Clean Minimalism Theme</span>
        </div>
        <p>© 2026 MediaHub Loader • Safe, Fast and Lossless Media extraction.</p>
      </footer>

    </div>
  );
}
