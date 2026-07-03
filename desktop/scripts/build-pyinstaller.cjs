/**
 * Build converter-server with PyInstaller using a dedicated venv so the bundle
 * does not include unrelated packages from the system Python (matplotlib, numpy,
 * PyQt, IPython, etc.).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const desktop = path.join(__dirname, "..");
const venvDir = path.join(desktop, ".venv");

function venvPython() {
  return os.platform() === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function listWindowsPythonExes() {
  const out = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const base = path.join(local, "Programs", "Python");
    if (fs.existsSync(base)) {
      try {
        for (const name of fs.readdirSync(base)) {
          if (/^Python\d+/i.test(name)) {
            const exe = path.join(base, name, "python.exe");
            if (fs.existsSync(exe)) out.push(exe);
          }
        }
      } catch (_) {}
    }
  }
  const pf = process.env.ProgramFiles;
  if (pf) {
    const nested = path.join(pf, "Python");
    if (fs.existsSync(nested)) {
      try {
        for (const name of fs.readdirSync(nested)) {
          const exe = path.join(nested, name, "python.exe");
          if (fs.existsSync(exe)) out.push(exe);
        }
      } catch (_) {}
    }
    for (const dir of ["Python312", "Python311", "Python310", "Python313"]) {
      const exe = path.join(pf, dir, "python.exe");
      if (fs.existsSync(exe)) out.push(exe);
    }
  }
  return [...new Set(out)];
}

/** @returns {{ cmd: string, argvPrefix: string[] } | null} */
function findSystemPython() {
  const tryProbe = (cmd, argvPrefix = []) => {
    const r = spawnSync(cmd, [...argvPrefix, "-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      shell: false,
    });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return { cmd, argvPrefix };
    }
    return null;
  };

  const envPy = process.env.PYTHON || process.env.PYTHON3;
  if (envPy && fs.existsSync(envPy)) {
    const t = tryProbe(envPy);
    if (t) return t;
  }

  if (os.platform() === "win32") {
    const py3 = tryProbe("py", ["-3"]);
    if (py3) return py3;
    const py = tryProbe("py", []);
    if (py) return py;
    for (const exe of listWindowsPythonExes()) {
      const t = tryProbe(exe);
      if (t) return t;
    }
  }

  const p3 = tryProbe("python3");
  if (p3) return p3;
  const p = tryProbe("python");
  if (p) return p;

  return null;
}

function ensureVenv() {
  const py = venvPython();
  if (!fs.existsSync(py)) {
    const found = findSystemPython();
    if (!found) {
      console.error(
        "No Python 3.11+ found. Set PYTHON to your python.exe, install Python from python.org, " +
          "or ensure py/python is on PATH.",
      );
      process.exit(1);
    }
    const r = spawnSync(found.cmd, [...found.argvPrefix, "-m", "venv", venvDir], {
      cwd: desktop,
      stdio: "inherit",
      shell: false,
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const pipInstall = spawnSync(py, ["-m", "pip", "install", "--upgrade", "pip", "-q"], {
    cwd: desktop,
    stdio: "inherit",
    shell: false,
  });
  if (pipInstall.status !== 0) process.exit(pipInstall.status ?? 1);

  const reqs = spawnSync(
    py,
    ["-m", "pip", "install", "-q", "-r", "requirements.txt", "-r", "requirements-build.txt"],
    { cwd: desktop, stdio: "inherit", shell: false },
  );
  if (reqs.status !== 0) process.exit(reqs.status ?? 1);
}

ensureVenv();
const py = venvPython();
const r = spawnSync(py, ["-m", "PyInstaller", "--noconfirm", "--clean", "build_server.spec"], {
  cwd: desktop,
  stdio: "inherit",
  shell: false,
});
process.exit(r.status ?? 1);
