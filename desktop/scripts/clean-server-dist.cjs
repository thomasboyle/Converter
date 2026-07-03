const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

if (process.platform === "win32") {
  try {
    execSync("taskkill /F /IM converter-server.exe /T", { stdio: "ignore" });
  } catch (_) {
    /* not running */
  }
}

const root = path.join(__dirname, "..");
const dirs = [
  path.join(root, "dist", "converter-server"),
  path.join(root, "build", "build_server"),
];

for (const dir of dirs) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      break;
    } catch (err) {
      if (attempt === 7) {
        console.error(
          "Could not remove",
          dir,
          "\nClose Converter / any running converter-server.exe, then retry.",
        );
        process.exit(1);
      }
      sleepSync(400 * (attempt + 1));
    }
  }
}
