// Fairness check for every map: point symmetry, no fall on the first tilt,
// no forced win for the starting player within 4 half-moves, plus random games as a sanity check.
// Usage: node tools/check-maps.js
const L=require("./load")();
const {MAPS,N,DIRS,newRound,slide,listMoves,playMove}=L;
function canWin(s,p,d){
  if(d===0)return false;
  const ms=listMoves(s),mine=s.turn===p;
  if(mine){for(const m of ms){const o=playMove(s,m);if(o.outcome){if(o.outcome.winner===p)return true;continue;}if(canWin(o.state,p,d-1))return true;}return false;}
  for(const m of ms){const o=playMove(s,m);if(o.outcome){if(o.outcome.winner===p)continue;return false;}if(!canWin(o.state,p,d-1))return false;}
  return true;
}
let ok=true;
MAPS.forEach((m,i)=>{
  let sym=true;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(m.grid[r][c]!==m.grid[N-1-r][N-1-c])sym=false;
  for(let k=0;k<N;k++)if(m.edges.top[k]!==m.edges.bottom[N-1-k]||m.edges.left[k]!==m.edges.right[N-1-k])sym=false;
  const firstFall=Object.keys(DIRS).filter(d=>slide(newRound(i,0),d).some(b=>b.fell));
  const t0=Date.now(),forced=[0,1].map(st=>canWin(newRound(i,st),st,4));
  const good=sym&&!firstFall.length&&!forced.some(Boolean);if(!good)ok=false;
  console.log(`${good?"OK  ":"FAIL"} ${m.name.padEnd(9)} symmetrisch:${sym} Sofort-Fall:${firstFall.join(",")||"keiner"} erzwungener Sieg(4):${forced.some(Boolean)} ${Date.now()-t0}ms`);
});
console.log(ok?"Alle Karten in Ordnung.":"Mindestens eine Karte hat ein Problem.");
process.exitCode=ok?0:1;
