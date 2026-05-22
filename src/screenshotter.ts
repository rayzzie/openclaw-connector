/**
 * Headless screenshot helper using puppeteer-core + system Chrome.
 * Keeps one browser instance open for the process lifetime.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

let browser: import("puppeteer-core").Browser | null = null;
let page: import("puppeteer-core").Page | null = null;

async function ensureBrowser(executablePath: string): Promise<import("puppeteer-core").Page> {
  if (page) return page;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require("puppeteer-core") as typeof import("puppeteer-core");
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

export type ScreenshotOptions = {
  url: string;
  executablePath?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  waitMs?: number;
  quality?: number;
};

/**
 * Navigate to url (or reload if already there) and return JPEG bytes.
 * Reuses the same browser/page across calls.
 */
export async function takeScreenshot(opts: ScreenshotOptions): Promise<Buffer> {
  const executablePath = opts.executablePath ?? findChrome();
  const p = await ensureBrowser(executablePath);

  const current = p.url();
  if (current !== opts.url) {
    await p.goto(opts.url, {
      waitUntil: opts.waitUntil ?? "networkidle2",
      timeout: 12000,
    });
  } else {
    await p.reload({ waitUntil: opts.waitUntil ?? "networkidle2", timeout: 12000 });
  }

  if (opts.waitMs && opts.waitMs > 0) {
    await new Promise((r) => setTimeout(r, opts.waitMs));
  }

  const buf = await p.screenshot({ type: "jpeg", quality: opts.quality ?? 75 });
  return buf as Buffer;
}

function findChrome(): string {
  const { existsSync } = require("fs") as typeof import("fs");
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `No Chrome binary found. Set MOCK_CHROME_PATH or install Chrome. Searched: ${CHROME_PATHS.join(", ")}`
  );
}
