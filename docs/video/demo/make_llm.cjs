const fs = require("fs");
const { fromCommand } = require(process.env.HOME + "/.claude/skills/pitch-video/scripts/schedules.js");
const style = (t) => /^>/.test(t) ? { text: t, cls: "kw", gap: 1.0 } : /BLOCK|PENDING_EXISTS/.test(t) ? { text: t, cls: "bad", gap: 0.8 } : /attestation|binds our nonce: yes/.test(t) ? { text: t, cls: "ok", gap: 1.2 } : /^#/.test(t) ? { text: t, cls: "dim", gap: 0.8 } : { text: t, gap: 0.7 };
const lines = fs.readFileSync("llm.log", "utf8").split("\n").filter((l) => l.trim()).map(style);
fs.writeFileSync("schedules/llm.json", JSON.stringify(fromCommand("NEAR_NETWORK=testnet CHECKER_URL=https://getchaperone.vercel.app/api pnpm demo:attack", lines, { dir: "chaperone", gap: 0.8 }), null, 1));
const s = JSON.parse(fs.readFileSync("schedules/llm.json")); console.log("llm", s.length, "lines, ends", s.at(-1).t.toFixed(1) + "s");
