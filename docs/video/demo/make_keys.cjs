const fs = require("fs");
const { fromCommand } = require(process.env.HOME + "/.claude/skills/pitch-video/scripts/schedules.js");
const lines = fs.readFileSync("keys.log", "utf8").split("\n").map((t) => /FunctionCall/.test(t) ? { text: t, cls: "ok", gap: 0.5 } : /method_names|receiver_id|allowance/.test(t) ? { text: t, cls: "kw", gap: 0.35 } : { text: t, cls: "dim", gap: 0.5 });
lines.unshift({ text: "# access keys on the vault account, read from NEAR testnet RPC (view_access_key_list)", cls: "dim", gap: 0.7 });
fs.writeFileSync("schedules/keys.json", JSON.stringify(fromCommand("curl -s https://test.rpc.fastnear.com -d '{\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"account_id\":\"chaperone.testnet\"}}'", lines, { dir: "chaperone", gap: 0.5 }), null, 1));
