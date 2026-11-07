// Terminal schedules from the stamped live logs (logs/*.log: "<epoch>\t<line>"), at real speed.
// Dropped: long JSON dumps (policy/attestation views), the local file path line, and the agent's prose.
const fs = require("fs");
const { esc } = require(process.env.HOME + "/.claude/skills/pitch-video/scripts/schedules.js");
const SHORT = (s) => s.replace(/https:\/\/b70ac9918c321d4265d75f85db30e29a274eca4e-8787\.dstack-pha1-prod9\.phala\.network/g, "https://b70ac991…-8787.dstack-pha1-prod9.phala.network");
const drop = (t) => /^\s*(policy|attestation|signals):|^> wrote |^\s*agent says:|^\s*agent mode:|check the image digest above/.test(t);
function cls(t) {
  if (/^=+$/.test(t)) return "dim";
  if (/BAD_SIGNATURE|vault decision: BLOCK|checker verdict: BLOCK|no: verdicts are rejected/.test(t)) return "bad";
  if (/verified: TCB|checker attested:  yes|vault decision: ALLOW|checker verdict: ALLOW|Result: attacker received 0|TEE mode:\s+enforced|made inside the enclave|binds our nonce: yes|"ok": true/.test(t)) return "ok";
  if (/^\s*tx[: ]/.test(t)) return "link";
  if (/^>/.test(t)) return "kw";
  return "";
}
function session(file, t0, { cps = 55, maxGap = 1.6 } = {}) {
  const rows = fs.readFileSync(`logs/${file}.log`, "utf8").split("\n").filter(Boolean).map((l) => { const i = l.indexOf("\t"); return { ts: +l.slice(0, i), text: l.slice(i + 1) }; });
  const cmd = SHORT(rows[0].text.replace(/^\$ /, "")).replace(/^pnpm -s /, "pnpm ");
  const out = [{ t: t0, html: `<span class="p">➜</span> <span class="dim">chaperone</span> ${esc(cmd)}`, type: true, cps }];
  let t = t0 + cmd.length / cps + 0.5, prevTs = rows[0].ts;
  for (const r of rows.slice(1)) {
    if (!r.text.trim() || drop(r.text)) { continue; }
    t += Math.min(r.ts - prevTs, maxGap); prevTs = r.ts;
    let text = SHORT(r.text);
    if (/^\s*reason codes: /.test(text) && text.length > 125) text = text.slice(0, 124) + "…";
    const c = cls(text);
    out.push({ t: +t.toFixed(2), html: c ? `<span class="${c}">${esc(text)}</span>` : esc(text) });
    t += 0.08;
  }
  return { sched: out, end: t };
}
const write = (name, parts) => {
  let t = 0.5, all = [];
  for (const [file, opt] of parts) { const s = session(file, t, opt); all = all.concat(s.sched); t = s.end + 1.2; }
  fs.writeFileSync(`schedules/${name}.json`, JSON.stringify(all, null, 1));
  console.log(name, all.length, "lines, ends", t.toFixed(1) + "s");
};
write("attest", [["health"], ["attest", { maxGap: 2.0 }]]);
write("register", [["policy"], ["register"]]);
write("attack", [["attack", { maxGap: 2.2 }]]);
