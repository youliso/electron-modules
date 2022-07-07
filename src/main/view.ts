import type { WebContents, BrowserViewConstructorOptions } from "electron";
import { app, BrowserView, ipcMain } from "electron";
import { windowInstance } from "./window";
import { logError } from "./log";

/**
 * 窗口打开预处理
 */
function viewOpenHandler(webContents: WebContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    webContents.loadURL(url);
    return { action: "deny" };
  });
}

export interface ViewOpt {
  key: string;
  winId: number;
  owh: [number, number];
  bvOptions: BrowserViewConstructorOptions;
  url: string;
  data: any;
}

export default class View {
  public views: {
    [key: string]: {
      isResize?: boolean;
      winId: number; // view所挂载的窗体
      owh: [number, number]; // view所在窗口宽高偏移量
      bv: BrowserView; // view主体
    };
  } = {};

  constructor() {}

  resizeHandler(key: string) {
    if (!this.views[key]) {
      throw new Error("[view resizeHandler] not view");
    }
    if (!this.views[key].isResize) return;
    const win = windowInstance.get(this.views[key].winId);
    if (!win) {
      throw new Error("[view resizeHandler] not win");
    }
    if (!win.isVisible()) return;
    const winBz = win.getBounds();
    const owh = this.views[key].owh;
    this.views[key].bv.setBounds({
      x: owh[0],
      y: owh[1],
      width: winBz.width - owh[0],
      height: winBz.height - owh[1],
    });
  }

  resize(key: string) {
    if (!this.views[key]) {
      throw new Error("[view resize] not view");
    }
    const win = windowInstance.get(this.views[key].winId);
    if (!win) {
      throw new Error("[view resize] not win");
    }
    this.views[key].isResize = true;
    win.on("resize", () => this.resizeHandler(key));
  }

  hide(key: string) {
    if (!this.views[key]) {
      throw new Error("[view hide] not view");
    }
    const win = windowInstance.get(this.views[key].winId);
    if (!win) {
      throw new Error("[view hide] not win");
    }
    this.views[key].isResize = false;
    win.setBrowserView(null);
  }

  show(key: string) {
    if (!this.views[key]) {
      throw new Error("[view show] not view");
    }
    const win = windowInstance.get(this.views[key].winId);
    if (!win) {
      throw new Error("[view show] not win");
    }
    this.views[key].isResize = true;
    win.setBrowserView(this.views[key].bv);
  }

  remove(key: string) {
    if (!this.views[key]) {
      throw new Error("[view remove] not view");
    }
    const win = windowInstance.get(this.views[key].winId);
    if (!win) {
      throw new Error("[view remove] not win");
    }
    win.setBrowserView(null);
    // @ts-ignore
    this.views[key].bv.webContents.destroy();
    delete this.views[key];
  }

  async create(opt: ViewOpt) {
    if (!opt) {
      throw new Error("[view create] not ViewOpt");
    }
    if (this.views[opt.key]) {
      this.show(opt.key);
      return;
    }
    const win = windowInstance.get(opt.winId);
    if (!win) {
      throw new Error("[view create] not win");
    }
    const winBz = win.getBounds();
    opt.bvOptions.webPreferences = Object.assign(
      {
        preload: windowInstance.defaultPreload,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: !app.isPackaged,
        webSecurity: false,
      },
      opt.bvOptions.webPreferences
    );
    let bvOpt: BrowserViewConstructorOptions = Object.assign(
      {
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
        minimizable: true,
        maximizable: true,
        frame: false,
        show: false,
        x: opt.owh[0],
        y: opt.owh[1],
        width: winBz.width - opt.owh[0],
        height: winBz.height - opt.owh[1],
      },
      opt.bvOptions
    );
    // @ts-ignore
    this.views[opt.key] = {
      winId: opt.winId,
      owh: opt.owh,
      isResize: false,
    };
    this.views[opt.key].bv = new BrowserView(bvOpt);
    viewOpenHandler(this.views[opt.key].bv.webContents);
    // 调试打开F12
    !app.isPackaged &&
      this.views[opt.key].bv.webContents.openDevTools({ mode: "detach" });
    // 初次参数
    this.views[opt.key].bv.webContents.on("did-finish-load", () =>
      this.views[opt.key].bv.webContents.send("window-load", {
        appVersion: app.getVersion(),
        appName: app.getName(),
        systemVersion: process.getSystemVersion(),
        platform: process.platform,
        data: opt.data,
      })
    );
    // 启动
    if (opt.url.startsWith("https://") || opt.url.startsWith("http://")) {
      await this.views[opt.key].bv.webContents.loadURL(opt.url).catch(logError);
    } else {
      await this.views[opt.key].bv.webContents
        .loadFile(opt.url)
        .catch(logError);
    }
    // 放入win
    win.setBrowserView(this.views[opt.key].bv);
    this.resize(opt.key);
    return this.views[opt.key].bv.webContents.id;
  }

  on() {
    ipcMain.handle("view-new", (event, args) => this.create(args.opt));
    ipcMain.handle("view-hide", async (event, args) => this.hide(args.key));
    ipcMain.handle("view-show", async (event, args) => this.show(args.key));
    ipcMain.handle("view-remove", async (event, args) => this.remove(args.key));
  }
}