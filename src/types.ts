export type JobStatus = 
  | "idle" 
  | "analyzing" 
  | "ready" 
  | "fetching" 
  | "downloading" 
  | "completed" 
  | "failed";

export interface DownloadOptions {
  videoQuality: "1080" | "720" | "480" | "360" | "2160";
  audioFormat: "mp3" | "wav" | "ogg" | "m4a";
  isAudioOnly: boolean;
}

export interface PickerItem {
  type: "photo" | "video";
  url: string;
}

export interface DownloadJob {
  id: string;
  url: string;
  status: JobStatus;
  error?: string;
  title: string;
  thumbnail: string;
  source: string;
  fileType: "video" | "audio";
  duration: number; // in seconds
  options: DownloadOptions;
  progress: number; // 0 to 100
  speed: string; // e.g., "1.4 MB/s"
  sizeBytes: number; // estimated or real size
  downloadUrl?: string; // Cobalt download URL or direct
  pickerItems?: PickerItem[];
  fileName?: string;
}

export interface GlobalSettings {
  defaultQuality: "2160" | "1080" | "720" | "480";
  defaultAudioFormat: "mp3" | "wav" | "m4a";
  defaultMode: "video" | "audio";
  autoDownload: boolean; // if true, starts processing immediately upon adding
}
