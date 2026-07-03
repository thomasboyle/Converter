const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let pythonProcess = null;

function pythonExecutable() {
  return process.platform === "win32" ? "python" : "python3";
}

function bundledServerPath() {
  const name = process.platform === "win32" ? "converter-server.exe" : "converter-server";
  return path.join(process.resourcesPath, "converter-server", name);
}

function startPythonServer() {
  const packaged = app.isPackaged;
  const serverRoot = packaged
    ? path.join(process.resourcesPath, "converter-server")
    : path.join(__dirname, "..");
  const cwd = serverRoot;
  let command;
  let args;
  if (packaged) {
    command = bundledServerPath();
    args = ["--electron"];
  } else {
    command = pythonExecutable();
    const serverScript = path.join(__dirname, "..", "server.py");
    args = [serverScript, "--electron"];
  }
  const env = {
    ...process.env,
    CONVERTER_USER_DATA: app.getPath("userData"),
    CONVERTER_FAST: "1",
  };
  if (packaged) {
    const ffmpegBin = path.join(process.resourcesPath, "ffmpeg-bin");
    env.PATH = `${ffmpegBin}${path.delimiter}${env.PATH || ""}`;
  }
  const proc = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pythonProcess = proc;
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const done = (fn) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const timer = setTimeout(
      () => done(() => reject(new Error("Timed out waiting for DESKTOP_PORT"))),
      30000,
    );
    const onData = (data) => {
      buf += data.toString();
      const m = buf.match(/DESKTOP_PORT=(\d+)/);
      if (m) {
        proc.stdout.off("data", onData);
        done(() => resolve({ port: parseInt(m[1], 10), proc }));
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (d) => console.error("[python]", d.toString()));
    proc.on("error", (err) => done(() => reject(err)));
    proc.on("exit", (code) => {
      if (!settled && code !== 0 && code !== null) {
        done(() => reject(new Error(`Python server exited with code ${code}`)));
      }
    });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 820,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.ELECTRON_DEV === "1";

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  try {
    const { port } = await startPythonServer();
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  } catch (e) {
    console.error(e);
    const hint = app.isPackaged
      ? "Reinstall the application or report this error."
      : "Ensure Python is installed and run: pip install -r desktop/requirements.txt";
    dialog.showErrorBox("Converter", `Could not start the app backend.\n\n${hint}\n\n${e.message}`);
    app.quit();
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});
