const fs = require("fs");
const path = require("path");

const ffmpegPath = require("ffmpeg-static");
const { path: ffprobePath } = require("ffprobe-static");

const outDir = path.join(__dirname, "..", "resources", "ffmpeg-bin");
fs.mkdirSync(outDir, { recursive: true });

const destFfmpeg = path.join(
  outDir,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const destFfprobe = path.join(
  outDir,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
);

function copyExec(src, dest) {
  fs.copyFileSync(src, dest);
  if (process.platform !== "win32") {
    fs.chmodSync(dest, 0o755);
  }
}

copyExec(ffmpegPath, destFfmpeg);
copyExec(ffprobePath, destFfprobe);
