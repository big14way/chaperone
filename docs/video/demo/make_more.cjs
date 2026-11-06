const fs = require("fs");
const { fromCommand } = require(process.env.HOME + "/.claude/skills/pitch-video/scripts/schedules.js");
const style = (t) => /^>/.test(t) ? { text: t, cls: "kw", gap: 0.9 } : /BLOCK/.test(t) ? { text: t, cls: "bad", gap: 0.8 } : /ALLOW|FunctionCall|No full-access/.test(t) ? { text: t, cls: "ok", gap: 0.7 } : /^#/.test(t) ? { text: t, cls: "dim", gap: 0.6 } : { text: t, gap: 0.55 };
const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map(style);
const curl = `curl -s https://test.rpc.fastnear.com -d '{"method":"query","params":{"request_type":"view_access_key_list","account_id":"chaperone.testnet"}}'`;
fs.writeFileSync("schedules/keys.json", JSON.stringify(fromCommand(curl, lines("keys.log"), { dir: "chaperone", gap: 0.5 }), null, 1));
fs.writeFileSync("schedules/swap.json", JSON.stringify(fromCommand("pnpm demo:swap   # NEAR Intents 1Click, dry quotes", lines("swap.log"), { dir: "chaperone", gap: 0.8 }), null, 1));
fs.writeFileSync("schedules/mcp.json", JSON.stringify(fromCommand("pnpm mcp   # Chaperone as an MCP server for any agent", lines("mcp.log"), { dir: "chaperone", gap: 0.8 }), null, 1));
for (const n of ["keys", "swap", "mcp"]) { const s = JSON.parse(fs.readFileSync(`schedules/${n}.json`)); console.log(n, s.length, "lines, ends", s.at(-1).t.toFixed(1) + "s"); }
