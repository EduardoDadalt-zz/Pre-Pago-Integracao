//#region electron
const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const server = require("./server");

require("update-electron-app")({
  repo: "EduardoDadalt/Pre-Pago-Integracao",
  logger: require("electron-log"),
});

if (require("electron-squirrel-startup")) {
  app.quit();
}
var mainWindow = null,
  isQuiting = false,
  tray = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));
    mainWindow.setMenu(null);
    mainWindow.on("minimize", function (event) {
      event.preventDefault();
      mainWindow.hide();
    });

    mainWindow.on("close", function (event) {
      if (!isQuiting) {
        event.preventDefault();
        mainWindow.hide();
      }

      return false;
    });
  };

  app.on("ready", () => {
    tray = new Tray(path.resolve(__dirname, "logo.png"));
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Abrir",
        type: "normal",
        click: (_e) => {
          mainWindow.show();
        },
      },
      {
        label: "Esconder",
        type: "normal",
        click: (_e) => {
          mainWindow.hide();
        },
      },
      {
        label: "Fechar",
        type: "normal",
        click: (_e) => {
          isQuiting = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip("Foody Delivery Integration");
    tray.setContextMenu(contextMenu);

    createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  server();
}
