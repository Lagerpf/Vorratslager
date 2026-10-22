// EAN-13 / EAN-8 / UPC-A decoder over scanlines of a grayscale image.
function makeEanDecoder(){
  const L=["3211","2221","2122","1411","1132","1231","1114","1312","1213","3112"].map(s=>s.split("").map(Number));
  const G=L.map(p=>[...p].reverse());
  const PAR=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
  function digit(runs,i,sets){
    const S=runs[i]+runs[i+1]+runs[i+2]+runs[i+3]; let best=null,be=9;
    for(const [name,tab] of sets) for(let d=0;d<10;d++){
      const p=tab[d]; let e=0; for(let k=0;k<4;k++) e+=Math.abs(runs[i+k]*7/S-p[k]);
      if(e<be){be=e;best={d,name};}
    }
    return be<1.6?best:null;
  }
  function guardOk(runs,i,n,mod){ for(let k=0;k<n;k++){ const m=runs[i+k]/mod; if(m<0.4||m>2.2) return false; } return true; }
  function chk(code){ let s=0; for(let i=0;i<code.length-1;i++){ const w=((code.length-1-i)%2===1)?3:1; s+=(+code[i])*w; } return (10-s%10)%10===+code[code.length-1]; }
  // runs: alternating lengths, startsBlack tells colour of runs[0]
  function scanRuns(runs,startsBlack,out){
    for(let i=0;i<runs.length;i++){
      const black=((i%2===0)===startsBlack); if(!black) continue;
      // quiet zone before: previous white run should be wide
      // EAN-13
      if(i+59<=runs.length){
        let T=0; for(let k=0;k<59;k++) T+=runs[i+k]; const mod=T/95;
        if((i===0||runs[i-1]>mod*3) && guardOk(runs,i,3,mod)&&guardOk(runs,i+27,5,mod)&&guardOk(runs,i+56,3,mod)){
          let left="",par="",ok=true;
          for(let d=0;d<6;d++){ const r=digit(runs,i+3+d*4,[["L",L],["G",G]]); if(!r){ok=false;break;} left+=r.d; par+=r.name; }
          if(ok){ let right=""; for(let d=0;d<6;d++){ const r=digit(runs,i+32+d*4,[["R",L]]); if(!r){ok=false;break;} right+=r.d; }
            const first=PAR.indexOf(par);
            if(ok&&first>=0){ const code=first+left+right; if(chk(code)) out.push(code); } }
        }
      }
      // EAN-8
      if(i+43<=runs.length){
        let T=0; for(let k=0;k<43;k++) T+=runs[i+k]; const mod=T/67;
        if((i===0||runs[i-1]>mod*3) && guardOk(runs,i,3,mod)&&guardOk(runs,i+19,5,mod)&&guardOk(runs,i+40,3,mod)){
          let code="",ok=true;
          for(let d=0;d<4;d++){ const r=digit(runs,i+3+d*4,[["L",L]]); if(!r){ok=false;break;} code+=r.d; }
          for(let d=0;ok&&d<4;d++){ const r=digit(runs,i+24+d*4,[["R",L]]); if(!r){ok=false;break;} code+=r.d; }
          if(ok&&chk(code)) out.push(code);
        }
      }
    }
  }
  function line(vals,out){
    const n=vals.length; if(n<100) return;
    // light smoothing
    const s=new Float32Array(n); for(let i=0;i<n;i++) s[i]=(vals[Math.max(0,i-1)]+2*vals[i]+vals[Math.min(n-1,i+1)])/4;
    // local threshold: mean of min/max within a window
    const win=Math.max(16,Math.round(n/14)); const pref=new Float64Array(n+1);
    for(let i=0;i<n;i++) pref[i+1]=pref[i]+s[i];
    for(const mode of [0,1]){
      const bits=new Uint8Array(n);
      for(let i=0;i<n;i++){
        const a=Math.max(0,i-win),b=Math.min(n,i+win+1); const mean=(pref[b]-pref[a])/(b-a);
        bits[i]= s[i] < (mode? mean : mean-6) ? 1:0;
      }
      const runs=[]; let cur=bits[0],len=0;
      for(let i=0;i<n;i++){ if(bits[i]===cur) len++; else { runs.push(len); cur=bits[i]; len=1; } }
      runs.push(len);
      scanRuns(runs,bits[0]===1,out);
      scanRuns([...runs].reverse(),(runs.length%2===1)?bits[0]===1:bits[0]!==1,out);
    }
  }
  return function decode(gray,w,h){
    const out=[];
    const rowStep=Math.max(1,Math.floor(h/120)), colStep=Math.max(1,Math.floor(w/120));
    const row=new Float32Array(w), col=new Float32Array(h);
    for(let y=0;y<h;y+=rowStep){ for(let x=0;x<w;x++) row[x]=gray[y*w+x]; line(row,out); }
    for(let x=0;x<w;x+=colStep){ for(let y=0;y<h;y++) col[y]=gray[y*w+x]; line(col,out); }
    if(!out.length) return null;
    const c={}; out.forEach(v=>c[v]=(c[v]||0)+1);
    const best=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
    return {code: best[0].length===13&&best[0][0]==="0"&&false ? best[0].slice(1) : best[0], hits:best[1], all:c};
  };
}
if(typeof module!=="undefined") module.exports=makeEanDecoder;
