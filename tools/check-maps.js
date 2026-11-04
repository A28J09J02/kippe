const fs=require("fs");
const src=fs.readFileSync(process.argv[2]||require("path").join(__dirname,"..","index.html"),"utf8");
const code=src.split("// ===== LOGIC START =====")[1].split("// ===== LOGIC END =====")[0];
const L=new Function(code+";return {MAPS,newRound,slide,tiltLegal,applyTilt,applyBuild,listMoves,playMove,DIRS,N,SHRINK_ORDER};")();
const {MAPS,newRound,slide,listMoves,playMove,DIRS,N}=L;
function canWin(s,p,d){
  if(d===0)return false;
  const ms=listMoves(s),mine=s.turn===p;
  if(mine){for(const m of ms){const o=playMove(s,m);if(o.outcome){if(o.outcome.winner===p)return m;continue;}if(canWin(o.state,p,d-1))return m;}return false;}
  for(const m of ms){const o=playMove(s,m);if(o.outcome){if(o.outcome.winner===p)continue;return false;}if(!canWin(o.state,p,d-1))return false;}
  return true;
}
let ok=true;
console.log("shrink order",L.SHRINK_ORDER.length);
MAPS.forEach((m,i)=>{
  let sym=true;for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(m.grid[r][c]!==m.grid[6-r][6-c])sym=false;
  for(let k=0;k<7;k++){if(m.edges.top[k]!==m.edges.bottom[6-k]||m.edges.left[k]!==m.edges.right[6-k])sym=false;}
  const s=newRound(i,0);
  const firstFall=Object.keys(DIRS).filter(d=>slide(s,d).some(b=>b.fell));
  const t0=Date.now();
  const w=[0,1].map(st=>{const s2=newRound(i,st);return canWin(s2,st,4);});
  console.log(m.name,"sym",sym,"firstFall",firstFall,"forcedWin4",w.map(x=>!!x),(Date.now()-t0)+"ms", w.map(x=>x&&x!==true?JSON.stringify({...x,res:undefined}):""));
  if(!sym||firstFall.length||w.some(Boolean))ok=false;
});
// random playout sanity
let ends={},len=[];
for(let gme=0;gme<300;gme++){let s=newRound(gme%4,gme%2),n=0,out;
  for(;;){const ms=listMoves(s);const m=ms[Math.floor(Math.random()*ms.length)];out=playMove(s,m);n++;if(out.outcome)break;s=out.state;}
  const k=out.outcome.draw?"draw":out.outcome.reason+(out.outcome.off?"-off":"");ends[k]=(ends[k]||0)+1;len.push(n);}
console.log("random playouts",ends,"avg moves",(len.reduce((a,b)=>a+b)/len.length).toFixed(1),"max",Math.max(...len));
console.log(ok?"ALL OK":"PROBLEMS");
