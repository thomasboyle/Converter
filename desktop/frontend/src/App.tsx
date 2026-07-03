import { useCallback, useEffect, useRef, useState } from "react";
import { TrimTimeline } from "./TrimTimeline";

type Tab = "compress" | "trim";

type ProgressPayload = {
  status: string;
  message?: string;
  gif_url?: string;
  video_url?: string;
  format?: string;
  params?: Record<string, unknown>;
  error?: string;
};

const FORMATS = ["gif", "webp", "mp4", "av1", "avif"] as const;

const FORMAT_LABELS: Record<(typeof FORMATS)[number], string> = {
  av1: "AV1 (best quality, includes sound)",
  avif: "AVIF (best quality)",
  mp4: "MP4 (good quality, includes sound)",
  webp: "WebP",
  gif: "GIF",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function UploadIcon() {
  return (
    <div className="upload-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 14l5-5 5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12 19V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

async function pollUntilDone(
  jobId: string,
  progressPath: (id: string) => string,
  onUpdate: (p: ProgressPayload) => void,
  signal: AbortSignal,
): Promise<ProgressPayload> {
  let interval = 800;
  let errs = 0;
  const maxErrs = 5;
  while (!signal.aborted) {
    try {
      const res = await fetch(progressPath(jobId), {
        headers: { "Cache-Control": "no-cache" },
        signal,
      });
      if (!res.ok) {
        throw new Error(res.statusText);
      }
      const data = (await res.json()) as ProgressPayload;
      errs = 0;
      interval = 800;
      onUpdate(data);
      const st = data.status;
      if (st === "done" || st === "error" || st === "cancelled") {
        return data;
      }
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        throw new Error("Cancelled");
      }
      errs++;
      interval = Math.min(interval * 1.5, 30000);
      if (errs >= maxErrs) {
        throw new Error("Connection lost while waiting for the job.");
      }
      onUpdate({ status: "running", message: "Retrying…" });
    }
    await wait(interval);
  }
  throw new Error("Cancelled");
}

export default function App() {
  const [tab, setTab] = useState<Tab>("compress");
  const compressPollAbort = useRef<AbortController | null>(null);
  const trimPollAbort = useRef<AbortController | null>(null);
  const compressJobIdRef = useRef<string | null>(null);
  const trimJobIdRef = useRef<string | null>(null);
  const cInputRef = useRef<HTMLInputElement>(null);
  const tInputRef = useRef<HTMLInputElement>(null);
  const [cDrag, setCDrag] = useState(false);
  const [tDrag, setTDrag] = useState(false);

  useEffect(() => {
    return () => {
      compressPollAbort.current?.abort();
      trimPollAbort.current?.abort();
    };
  }, []);

  const [cFile, setCFile] = useState<File | null>(null);
  const [cFmt, setCFmt] = useState<string>("av1");
  const [cMaxMb, setCMaxMb] = useState(8);
  const [cBusy, setCBusy] = useState(false);
  const [cMsg, setCMsg] = useState("");
  const [cErr, setCErr] = useState(false);
  const [cResultUrl, setCResultUrl] = useState<string | null>(null);
  const [cResultFmt, setCResultFmt] = useState<string | null>(null);

  const startCompress = useCallback(async () => {
    if (!cFile) {
      setCMsg("Choose a video file.");
      setCErr(true);
      return;
    }
    compressPollAbort.current?.abort();
    compressPollAbort.current = new AbortController();
    const signal = compressPollAbort.current.signal;
    compressJobIdRef.current = null;
    setCBusy(true);
    setCErr(false);
    setCMsg("Uploading…");
    setCResultUrl(null);
    setCResultFmt(null);
    try {
      const fd = new FormData();
      fd.append("video", cFile);
      fd.append("format", cFmt);
      fd.append("filename", cFile.name);
      fd.append("max_size_mb", String(cMaxMb));
      const startRes = await fetch("/start", { method: "POST", body: fd, signal });
      if (!startRes.ok) {
        const j = await startRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || startRes.statusText);
      }
      const { job_id, format } = (await startRes.json()) as { job_id: string; format: string };
      compressJobIdRef.current = job_id;
      const final = await pollUntilDone(
        job_id,
        (id) => `/progress/${id}`,
        (p) => setCMsg(p.message || p.status || "…"),
        signal,
      );
      compressJobIdRef.current = null;
      if (final.status === "error" || final.status === "cancelled") {
        throw new Error(final.message || final.error || final.status);
      }
      if (!final.gif_url) {
        throw new Error("No output URL in response.");
      }
      setCResultUrl(final.gif_url);
      setCResultFmt((final.format || format || cFmt).toLowerCase());
      setCMsg("Done.");
    } catch (e) {
      compressJobIdRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "Cancelled") {
        setCErr(true);
        setCMsg(msg);
      } else {
        setCMsg("Cancelled.");
      }
    } finally {
      setCBusy(false);
    }
  }, [cFile, cFmt, cMaxMb]);

  const cancelCompress = useCallback(async () => {
    const id = compressJobIdRef.current;
    if (id) {
      try {
        await fetch(`/cancel/${id}`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    compressPollAbort.current?.abort();
    setCMsg("Cancelling…");
  }, []);

  const [tFile, setTFile] = useState<File | null>(null);
  const [tStart, setTStart] = useState(0);
  const [tEnd, setTEnd] = useState(60);
  const [tBusy, setTBusy] = useState(false);
  const [tMsg, setTMsg] = useState("");
  const [tErr, setTErr] = useState(false);
  const [tResultUrl, setTResultUrl] = useState<string | null>(null);

  const startTrim = useCallback(async () => {
    if (!tFile) {
      setTMsg("Choose a video file.");
      setTErr(true);
      return;
    }
    if (tEnd <= tStart) {
      setTMsg("End must be greater than start.");
      setTErr(true);
      return;
    }
    trimPollAbort.current?.abort();
    trimPollAbort.current = new AbortController();
    const signal = trimPollAbort.current.signal;
    trimJobIdRef.current = null;
    setTBusy(true);
    setTErr(false);
    setTMsg("Uploading…");
    setTResultUrl(null);
    try {
      const fd = new FormData();
      fd.append("video", tFile);
      fd.append("start_time", String(tStart));
      fd.append("end_time", String(tEnd));
      const startRes = await fetch("/clip/start", { method: "POST", body: fd, signal });
      if (!startRes.ok) {
        const j = await startRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || startRes.statusText);
      }
      const { job_id } = (await startRes.json()) as { job_id: string };
      trimJobIdRef.current = job_id;
      const final = await pollUntilDone(
        job_id,
        (id) => `/clip/progress/${id}`,
        (p) => setTMsg(p.message || p.status || "…"),
        signal,
      );
      trimJobIdRef.current = null;
      if (final.status === "error" || final.status === "cancelled") {
        throw new Error(final.message || final.error || final.status);
      }
      if (!final.video_url) {
        throw new Error("No output URL in response.");
      }
      setTResultUrl(final.video_url);
      setTMsg("Done.");
    } catch (e) {
      trimJobIdRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "Cancelled") {
        setTErr(true);
        setTMsg(msg);
      } else {
        setTMsg("Cancelled.");
      }
    } finally {
      setTBusy(false);
    }
  }, [tFile, tStart, tEnd]);

  const onTrimDurationLoaded = useCallback((d: number) => {
    setTStart(0);
    setTEnd(d);
    setTErr(false);
    setTMsg("");
  }, []);

  const cancelTrim = useCallback(async () => {
    const id = trimJobIdRef.current;
    if (id) {
      try {
        await fetch(`/cancel/${id}`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    trimPollAbort.current?.abort();
    setTMsg("Cancelling…");
  }, []);

  const isVideoPreview = cResultFmt === "mp4" || cResultFmt === "av1";

  const title = tab === "compress" ? "Compress For Discord" : "Clip That";
  const blurb =
    tab === "compress"
      ? "Compress, convert & share easily — optimized for web and social."
      : "Trim your videos with precision — set start and end times below.";

  return (
    <div className="app-root">
      <div className="container">
        <header className="page-header">
          <h1>{title}</h1>
          <p className="subtitle">{blurb}</p>
        </header>

        <nav className="mode-tabs" aria-label="Tool">
          <button
            type="button"
            className={tab === "compress" ? "mode-tab active" : "mode-tab"}
            onClick={() => setTab("compress")}
          >
            Compress
          </button>
          <button type="button" className={tab === "trim" ? "mode-tab active" : "mode-tab"} onClick={() => setTab("trim")}>
            Trim
          </button>
        </nav>

        {tab === "compress" && (
          <div className="panel-block">
            <div
              className={`upload-area${cDrag ? " dragover" : ""}`}
              onClick={() => cInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  cInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault();
                setCDrag(true);
              }}
              onDragLeave={() => setCDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setCDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setCFile(f);
              }}
            >
              <input
                ref={cInputRef}
                id="cv"
                type="file"
                accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.wmv,.flv,.mpeg,.mpg,video/*"
                hidden
                onChange={(e) => setCFile(e.target.files?.[0] ?? null)}
              />
              <UploadIcon />
              <p className="upload-text">Drag & drop your video</p>
              <p className="upload-subtext">or click to browse files</p>
              {cFile && <p className="file-name">{cFile.name}</p>}
            </div>

            <div className="settings-output-container">
              <div className="smart-settings">
                <div className="settings-header">
                  <span>Includes</span>
                  <span className="info-icon" title="What we optimize for">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                      <path d="M12 16v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                </div>
                <div className="setting-item">
                  <span>Ultra fast encoding</span>
                  <span className="checkmark" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
                <div className="setting-item">
                  <span>
                    ≤ {cMaxMb} MB output
                  </span>
                  <span className="checkmark" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
                <div className="setting-item">
                  <span>≥ 12 fps</span>
                  <span className="checkmark" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
                <div className="setting-item">
                  <span>Social media ready</span>
                  <span className="checkmark" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              </div>

              <div className="output-section">
                <h3>Output</h3>
                <div className="output-field">
                  <label htmlFor="fmt">Format</label>
                  <select id="fmt" value={cFmt} onChange={(e) => setCFmt(e.target.value)}>
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="output-field">
                  <label htmlFor="mb">Max size (MB)</label>
                  <input
                    id="mb"
                    type="number"
                    min={1}
                    max={512}
                    value={cMaxMb}
                    onChange={(e) => setCMaxMb(Number(e.target.value) || 8)}
                  />
                </div>
              </div>
            </div>

            <div className="action-form">
              <button type="button" className="convert-button" disabled={cBusy} onClick={startCompress}>
                Convert Video
              </button>
              <button
                type="button"
                className={`reset-button${cBusy ? " processing" : ""}`}
                disabled={!cBusy}
                onClick={cancelCompress}
              >
                Cancel
              </button>
            </div>
            <div
              className={`status-line${cErr ? " error" : ""}${cMsg === "Done." ? " success" : ""}`}
              role="status"
            >
              {cMsg || " "}
            </div>
            {cResultUrl && (
              <div className="result-container">
                {isVideoPreview ? (
                  <video src={cResultUrl} controls playsInline />
                ) : (
                  <img src={cResultUrl} alt="Compressed output" />
                )}
                <div className="download-section">
                  <a href={cResultUrl} download>
                    Download
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "trim" && (
          <div className="panel-block clip-section">
            <div
              className={`upload-area${tDrag ? " dragover" : ""}`}
              onClick={() => tInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault();
                setTDrag(true);
              }}
              onDragLeave={() => setTDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setTDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setTFile(f);
              }}
            >
              <input
                ref={tInputRef}
                id="tv"
                type="file"
                accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.wmv,.flv,.mpeg,.mpg,video/*"
                hidden
                onChange={(e) => setTFile(e.target.files?.[0] ?? null)}
              />
              <UploadIcon />
              <p className="upload-text">Drag & drop your video</p>
              <p className="upload-subtext">or click to browse files</p>
              {tFile && <p className="file-name">{tFile.name}</p>}
            </div>

            <TrimTimeline
              file={tFile}
              startTime={tStart}
              endTime={tEnd}
              onStartChange={setTStart}
              onEndChange={setTEnd}
              onDurationLoaded={onTrimDurationLoaded}
              onLoadError={(msg) => {
                setTErr(true);
                setTMsg(msg);
              }}
            />

            <div className="action-form">
              <button type="button" className="clip-button" disabled={tBusy} onClick={startTrim}>
                Clip that!
              </button>
              <button
                type="button"
                className={`reset-button${tBusy ? " processing" : ""}`}
                disabled={!tBusy}
                onClick={cancelTrim}
              >
                Cancel
              </button>
            </div>
            <div
              className={`status-line${tErr ? " error" : ""}${tMsg === "Done." ? " success" : ""}`}
              role="status"
            >
              {tMsg || " "}
            </div>
            {tResultUrl && (
              <div className="result-container">
                <video src={tResultUrl} controls playsInline />
                <div className="download-section">
                  <a href={tResultUrl} download>
                    Download
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
