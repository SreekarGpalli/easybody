// Pose sanity check for every exercise animation in index.html.
// Run: node tools/check-poses.mjs   (exit 1 on any failure)
// Checks every clip at 120 sampled frames plus each keyframe:
//  - reach: hands/feet pinned to equipment or floor can actually get there (IK gap)
//  - floor: no joint, sole, hand or head goes through the floor
//  - solids: no limb, torso or sole passes through benches/steps listed in `solids`
//  - joints (side views): knees only bend forward, elbows never bend backwards
//  - modes: a limb is pinned by target (t) in every pose of a clip or in none, so in-between frames interpolate
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.indexOf("/* ================= APP"));
const ctx = { console, Math, JSON, Object, Array, Set, Number, String, Error };
vm.createContext(ctx);
vm.runInContext(js + ";Object.assign(this,{EX,Stage,compute,FY,L,limbSign,solePts,sub,len});", ctx);
const { EX, Stage, compute, FY, L, limbSign, solePts, sub, len } = ctx;

const cross = (a, b) => (a[0] * b[1] - a[1] * b[0]) / ((len(a) || 1) * (len(b) || 1));
const inside = (p, r, m = 1.5) => p[0] > r[0] + m && p[0] < r[2] - m && p[1] > r[1] + m && p[1] < r[3] - m;
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

let fails = 0, clips = 0, frames = 0;
for (const ex of EX) {
  if (ex.render && ex.render !== "rig") continue;
  ex.clips.forEach((c, ci) => {
    clips++;
    const st = Object.create(Stage.prototype); st.c = c;
    const total = c.ph.reduce((a, p) => a + p.d, 0);
    const ts = [];
    for (let k = 0; k <= 120; k++) ts.push((total * k) / 120);
    let acc = 0; for (const p of c.ph) { acc += p.d; ts.push(Math.max(0, acc - 1e-4)); }
    const solids = c.solids || ex.solids || [];
    const errs = new Map();
    const poses = Object.values(c.poses);
    for (const part of ["legs", "arms"]) for (let i = 0; i < 2; i++) {
      const modes = new Set(poses.map(p => !!p[part][i].t));
      if (modes.size > 1) { fails++; console.log(`FAIL ${ex.id} / ${c.name}: ${part}[${i}] mixes target and angle poses`); }
    }
    const bad = (key, t, v) => { const e = errs.get(key); if (!e || v > e.v) errs.set(key, { t, v }); };
    for (const t of ts) {
      frames++;
      const s = st.state(t), p = s.pose, J = compute(p), front = !!p.front, side = !front && !p.top;
      if (J.gap > 0.6) bad("limb cannot reach its target (gap px)", t, J.gap);
      if (!ex.noFloor) {
        const pts = [J.H, J.S, ...J.knees, ...J.hips, ...J.elbows];
        if (!p.hideLegs) pts.push(...J.ankles);
        for (const q of pts) if (q[1] > FY + 1) bad("joint below floor (px)", t, q[1] - FY);
        for (const h of J.hands) if (h[1] + 3.5 > FY + 1) bad("hand through floor (px)", t, h[1] + 3.5 - FY);
        if (J.HC[1] + L.hr > FY + 1.5) bad("head through floor (px)", t, J.HC[1] + L.hr - FY);
        if (!p.hideLegs) for (let i = 0; i < 2; i++) if (p.legs[i].fl >= 0.2) for (const q of solePts(J, i, p, front)) if (q[1] > FY + 1.5) bad(`foot ${i} through floor (px)`, t, q[1] - FY);
      }
      for (const r of solids) {
        const segs = [[J.H, J.S]];
        for (let i = 0; i < 2; i++) { segs.push([J.shs[i], J.elbows[i]], [J.elbows[i], J.hands[i]]); if (!p.hideLegs) segs.push([J.hips[i], J.knees[i]], [J.knees[i], J.ankles[i]]); }
        for (const [a, b] of segs) for (let k = 0; k <= 8; k++) { const q = lerp2(a, b, k / 8); if (inside(q, r)) bad(`body inside solid [${r}]`, t, 1); }
        if (!p.hideLegs) for (let i = 0; i < 2; i++) for (const q of solePts(J, i, p, front)) if (inside(q, r, 2)) bad(`foot ${i} inside solid [${r}]`, t, 1);
      }
      if (side) {
        const sg = limbSign(p);
        for (let i = 0; i < 2; i++) {
          if (!p.hideLegs) { const k = cross(sub(J.knees[i], J.hips[i]), sub(J.ankles[i], J.knees[i])) * sg; if (k < -0.06) bad(`knee ${i} bends backwards (sin)`, t, -k); }
          const e = cross(sub(J.elbows[i], J.shs[i]), sub(J.hands[i], J.elbows[i])) * sg; if (e > 0.06) bad(`elbow ${i} bends backwards (sin)`, t, e);
        }
      }
    }
    for (const [k, { t, v }] of errs) { fails++; console.log(`FAIL ${ex.id} / ${c.name}: ${k} = ${v.toFixed(2)} at t=${t.toFixed(2)}s`); }
  });
}
console.log(`${fails ? "FAILED" : "OK"}: ${clips} clips, ${frames} frames checked, ${fails} problems`);
process.exit(fails ? 1 : 0);
