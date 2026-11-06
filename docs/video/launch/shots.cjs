// node shots.cjs  -> shots/*.png : 2x element screenshots of the live dashboard (pnpm web on :3000)
// for the launch ad. Reads real testnet data; park a warn request first (WARN_USDC=16 pnpm demo:warn).
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const URL = process.env.APP_URL || "http://localhost:3000";
const out = path.join(__dirname, "shots");

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: "networkidle" });
  await p.waitForSelector("#approvals", { timeout: 30000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
    // Show owner-state buttons (the headless browser is not signed in) and drop the sign-in hint.
    document.querySelectorAll("#approvals button[disabled]").forEach((b) => b.removeAttribute("disabled"));
    document.querySelectorAll("#approvals p").forEach((n) => { if (/Connect the owner wallet/.test(n.textContent)) n.remove(); });
  });

  const grab = async (name, locator) => {
    await locator.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await locator.screenshot({ path: path.join(out, name + ".png") });
    console.log("shot", name);
  };
  // agent card in the showcase (the one with a glass background)
  await grab("agent-card", p.locator("section").nth(0).locator("div.shadow-card").first());
  await grab("approval", p.locator("#approvals .rise").first());
  await grab("audit", p.locator("#activity table"));
  await grab("policy", p.locator("#policy .shadow-card").first());
  await grab("stats", p.locator("header .grid").last());
  await b.close();
})();
