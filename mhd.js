// MHD-Erkennung: Bildaufbereitung für Nadeldruck-Daten und Datumsauswertung.
// Reine Funktionen ohne Browser-Abhängigkeit (auch in Node testbar).
(function(root){
  // Graustufenbild skalieren (bilinear)
  function resize(g, w, h, nw){
    const nh = Math.max(1, Math.round(h * nw / w)), out = new Uint8Array(nw * nh), sx = w / nw, sy = h / nh;
    for(let y = 0; y < nh; y++){
      const fy = Math.min(h - 1.001, (y + .5) * sy - .5), y0 = Math.max(0, Math.floor(fy)), ty = fy - y0, y1 = Math.min(h - 1, y0 + 1);
      for(let x = 0; x < nw; x++){
        const fx = Math.min(w - 1.001, (x + .5) * sx - .5), x0 = Math.max(0, Math.floor(fx)), tx = fx - x0, x1 = Math.min(w - 1, x0 + 1);
        const a = g[y0*w+x0]*(1-tx) + g[y0*w+x1]*tx, b = g[y1*w+x0]*(1-tx) + g[y1*w+x1]*tx;
        out[y*nw+x] = a*(1-ty) + b*ty;
      }
    }
    return {g: out, w: nw, h: nh};
  }
  // Mittelwert über ein (2r+1)²-Fenster mit Integralbild
  function boxMean(g, w, h, r){
    const W = w + 1, I = new Float64Array(W * (h + 1));
    for(let y = 0; y < h; y++){ let row = 0; for(let x = 0; x < w; x++){ row += g[y*w+x]; I[(y+1)*W+x+1] = I[y*W+x+1] + row; } }
    const out = new Float32Array(w * h);
    for(let y = 0; y < h; y++){
      const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
      for(let x = 0; x < w; x++){
        const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        out[y*w+x] = (I[yb*W+xb] - I[ya*W+xb] - I[yb*W+xa] + I[ya*W+xa]) / ((yb-ya)*(xb-xa));
      }
    }
    return out;
  }
  // Dunkle Punkte vergrößern (Minimum-Filter), damit Nadeldruck-Punkte zu Ziffern verschmelzen
  function dilateDark(b, w, h, size){
    const r = size >> 1, tmp = new Uint8Array(w*h), out = new Uint8Array(w*h);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
      let v = 0; for(let k = -r; k <= r && !v; k++){ const xx = x + k; if(xx >= 0 && xx < w && b[y*w+xx]) v = 1; } tmp[y*w+x] = v;
    }
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
      let v = 0; for(let k = -r; k <= r && !v; k++){ const yy = y + k; if(yy >= 0 && yy < h && tmp[yy*w+x]) v = 1; } out[y*w+x] = v;
    }
    return out;
  }
  // Kleine Störflecken entfernen (zusammenhängende Flächen)
  function clean(b, w, h){
    const lab = new Int32Array(w*h), comps = [], stack = new Int32Array(w*h);
    let n = 0;
    for(let i = 0; i < w*h; i++){
      if(!b[i] || lab[i]) continue;
      n++; let sp = 0, cnt = 0, y0 = h, y1 = 0; stack[sp++] = i; lab[i] = n;
      while(sp){
        const p = stack[--sp], py = (p / w) | 0, px = p - py*w; cnt++;
        if(py < y0) y0 = py; if(py > y1) y1 = py;
        if(px > 0 && b[p-1] && !lab[p-1]){ lab[p-1] = n; stack[sp++] = p-1; }
        if(px < w-1 && b[p+1] && !lab[p+1]){ lab[p+1] = n; stack[sp++] = p+1; }
        if(py > 0 && b[p-w] && !lab[p-w]){ lab[p-w] = n; stack[sp++] = p-w; }
        if(py < h-1 && b[p+w] && !lab[p+w]){ lab[p+w] = n; stack[sp++] = p+w; }
      }
      comps.push({n, cnt, hgt: y1 - y0 + 1});
    }
    const hs = comps.filter(c => c.cnt > 30).map(c => c.hgt).sort((a,b) => a-b);
    const med = hs.length ? hs[Math.floor(hs.length*3/4)] : 10;
    const keep = new Uint8Array(n + 1);
    for(const c of comps) if(c.hgt >= med*0.5 || c.cnt > med*med*0.15) keep[c.n] = 1;
    const out = new Uint8Array(w*h);
    for(let i = 0; i < w*h; i++) out[i] = lab[i] && keep[lab[i]] ? 1 : 0;
    return out;
  }
  function rotate(b, w, h, deg){
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const nw = Math.ceil(Math.abs(w*c) + Math.abs(h*s)), nh = Math.ceil(Math.abs(w*s) + Math.abs(h*c));
    const out = new Uint8Array(nw*nh), cx = w/2, cy = h/2, ncx = nw/2, ncy = nh/2;
    for(let y = 0; y < nh; y++) for(let x = 0; x < nw; x++){
      const dx = x - ncx, dy = y - ncy, sx = Math.round(c*dx + s*dy + cx), sy = Math.round(-s*dx + c*dy + cy);
      if(sx >= 0 && sx < w && sy >= 0 && sy < h) out[y*nw+x] = b[sy*w+sx];
    }
    return {b: out, w: nw, h: nh};
  }
  // Schräge Schrift gerade drehen: Winkel mit den schärfsten Zeilenkanten suchen
  function deskew(b, w, h){
    let best = null;
    for(let deg = -12; deg <= 12; deg += 1){
      const r = rotate(b, w, h, deg), prof = new Float64Array(r.h);
      for(let y = 0; y < r.h; y++){ let s = 0; for(let x = 0; x < r.w; x++) s += r.b[y*r.w+x]; prof[y] = s; }
      let sc = 0; for(let y = 1; y < r.h; y++){ const d = prof[y] - prof[y-1]; sc += d*d; }
      if(!best || sc > best.sc) best = {sc, r};
    }
    return best.r;
  }
  // Komplette Aufbereitung → Schwarz/Weiß-Bild (0 = Schrift), auf Text zugeschnitten
  function prepare(gray, w, h, opts){
    const o = Object.assign({width: 600, k: 20, win: 31, dil: 5}, opts || {});
    let {g, w: W, h: H} = resize(gray, w, h, o.width);
    const bl = boxMean(g, W, H, 1);
    const mean = boxMean(bl, W, H, o.win >> 1);
    let b = new Uint8Array(W*H);
    for(let i = 0; i < W*H; i++) b[i] = bl[i] < mean[i] - o.k ? 1 : 0;
    if(o.dil > 1) b = dilateDark(b, W, H, o.dil);
    b = clean(b, W, H);
    const r = deskew(b, W, H);
    let x0 = r.w, x1 = -1, y0 = r.h, y1 = -1;
    for(let y = 0; y < r.h; y++) for(let x = 0; x < r.w; x++) if(r.b[y*r.w+x]){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    if(x1 < 0) return null;
    const pad = 15; x0 = Math.max(0, x0-pad); y0 = Math.max(0, y0-pad); x1 = Math.min(r.w-1, x1+pad); y1 = Math.min(r.h-1, y1+pad);
    const ow = x1-x0+1, oh = y1-y0+1, out = new Uint8Array(ow*oh);
    for(let y = 0; y < oh; y++) for(let x = 0; x < ow; x++) out[y*ow+x] = r.b[(y+y0)*r.w + x+x0] ? 0 : 255;
    return {g: out, w: ow, h: oh};
  }
  // Datum aus erkanntem Text lesen. Liefert "JJJJ-MM-TT" oder null.
  function parseDate(text, now){
    now = now || new Date();
    const cy = now.getFullYear();
    const t = String(text).replace(/[oO]/g,"0").replace(/[Il|]/g,"1").replace(/,/g,".").replace(/\s+/g,"");
    const ok = (y,m,d) => {
      if(y < cy - 2 || y > cy + 15 || m < 1 || m > 12 || d < 1) return null;
      const last = new Date(y, m, 0).getDate(); if(d > last) return null;
      return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    };
    const yr = s => s.length === 4 ? +s : 2000 + +s;
    const endOfMonth = (y,m) => ok(y, m, new Date(y, m, 0).getDate());
    let m;
    // TT.MM.JJJJ / T.M.JJ mit Trennern, danach TT.MM.JJ mit fehlenden Trennern
    for(const re of [/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/g, /(\d{2})[.\/-]?(\d{2})[.\/-]?(\d{4}|\d{2})/g]){
      while((m = re.exec(t))){
        const d = +m[1], mo = +m[2];
        let r = ok(yr(m[3]), mo, d);
        if(!r && m[3].length === 4) r = ok(yr(m[3].slice(0,2)), mo, d);
        if(r) return r;
        re.lastIndex = m.index + 1;
      }
    }
    // MM.JJJJ oder MM/JJ → Monatsende
    const re2 = /(\d{2})[.\/-](\d{4}|\d{2})(?!\d)/g;
    while((m = re2.exec(t))){ const r = endOfMonth(yr(m[2]), +m[1]); if(r) return r; re2.lastIndex = m.index + 1; }
    return null;
  }
  // Getippte Kurzform: TTMMJJ, TT.MM.JJ(JJ), MMJJ (→ Monatsende)
  function parseTyped(s, now){
    s = String(s).trim(); const digits = s.replace(/\D/g, "");
    if(digits.length === 4 && !/[.\/-]\d{2}[.\/-]/.test(s)){
      const cy = (now || new Date()).getFullYear(), y = 2000 + +digits.slice(2), mo = +digits.slice(0,2);
      if(mo >= 1 && mo <= 12 && y >= cy - 2 && y <= cy + 15) return `${y}-${String(mo).padStart(2,"0")}-${String(new Date(y, mo, 0).getDate()).padStart(2,"0")}`;
      return null;
    }
    return parseDate(s, now);
  }
  root.MHD = {prepare, parseDate, parseTyped};
  if(typeof module !== "undefined") module.exports = root.MHD;
})(typeof window !== "undefined" ? window : globalThis);
