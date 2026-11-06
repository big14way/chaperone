// node render.cjs preview [t1,t2,...] -> preview/pNN.jpg ; node render.cjs all -> frames/0000.jpg..1079.jpg (36 s @ 30 fps)
const path = require("path"); const fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
(async () => {
  const mode = process.argv[2] || "preview";
  const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p.goto("file://" + path.join(__dirname, "ad.html")); await p.evaluate(() => window.ready); await p.waitForTimeout(800);
  const out = path.join(__dirname, mode === "all" ? "frames" : "preview"); fs.mkdirSync(out, { recursive: true });
  const times = mode === "all" ? [...Array(1080).keys()].map((f) => f / 30)
    : (process.argv[3] ? process.argv[3].split(",").map(Number) : [2.6, 5.6, 8.6, 11.6, 14.6, 17.6, 20.4, 23.6, 26.6, 29.6, 32.6, 35.0]);
  const t0 = Date.now();
  for (let i = 0; i < times.length; i++) {
    await p.evaluate((t) => window.render(t), times[i]);
    await p.screenshot({ path: path.join(out, (mode === "all" ? String(i).padStart(4, "0") : "p" + String(i).padStart(2, "0")) + ".jpg"), type: "jpeg", quality: 93 });
    if (mode === "all" && i % 180 === 0) console.log("frame", i, ((Date.now() - t0) / 1000).toFixed(1) + "s");
  }
  await b.close(); console.log("done", times.length, "frames", ((Date.now() - t0) / 1000).toFixed(1) + "s");
})();
