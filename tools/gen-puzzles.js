// Finds new "Gewinn in 2" puzzles: positions from bot games where the side to move forces a win
// within its next 2 moves (exact search over all moves), but cannot win at once.
// Usage: node tools/gen-puzzles.js [count] [seconds]   → prints JSON lines in the PUZZLES format
const L=require("./load")();
const {N,listMoves,playMove,chooseMove,newRound}=L;
const fs=require("fs"),path=require("path");
const want=+process.argv[2]||20,budget=(+process.argv[3]||600)*1000,t0=Date.now();
const html=fs.readFileSync(path.join(__dirname,"..","_app","index.html"),"utf8");
const known=JSON.parse(html.split("const PUZZLES=")[1].split(";\n")[0]);
const seen=new Set(known.map(p=>p.g+JSON.stringify(p.b)));
let nodes=0;const LIMIT=4e6,ABORT={};
function winIn(s,att,d){
  if(d<=0)return false;if(++nodes>LIMIT)throw ABORT;
  const ms=listMoves(s);
  if(s.turn===att){
    ms.sort((a,b)=>(b.type==="tilt")-(a.type==="tilt"));
    for(const m of ms){const o=playMove(s,m);if(o.outcome){if(!o.outcome.draw&&o.outcome.winner===att)return true;continue;}if(winIn(o.state,att,d-1))return true;}return false;}
  if(!ms.length)return false;
  for(const m of ms){const o=playMove(s,m);if(o.outcome){if(!o.outcome.draw&&o.outcome.winner===att)continue;return false;}if(!winIn(o.state,att,d-1))return false;}
  return true;
}
// how many first moves win: a real puzzle has only one or two
function keys(s,att){let n=0;for(const m of listMoves(s)){const o=playMove(s,m);if(!o.outcome&&winIn(o.state,att,2))n++;if(n>2)break;}return n;}
const enc=t=>t.t==="C"?"abc"[t.hp-1]:t.t==="S"?(t.o?"xyz":"pqr")[t.hp-1]:t.t==="W"&&t.hp?"abc"[t.hp-1]:t.t;
function encode(s){
  return {m:s.mapIdx,t:s.turn,mv:s.moves,lt:s.lastTilt||"",si:s.shrinkIdx,b:s.balls.map(b=>[b.r,b.c]),
    st:[s.stock.S[0],s.stock.S[1],s.stock.H[0],s.stock.H[1]],
    g:s.cells.map(r=>r.map(enc).join("")).join(""),e:["top","right","bottom","left"].map(k=>s.edges[k].map(enc).join("")).join("")};
}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const out=[];const perMap=[0,0,0,0,0];
for(let g=1;out.length<want&&Date.now()-t0<budget;g++){
  const R=rng(g*977+13),map=g%5;
  if(perMap[map]>=Math.ceil(want/5)+1)continue;
  let s=newRound(map,g%2);const lv=["easy","medium","medium"][g%3];
  for(let ply=0;ply<60;ply++){
    if(ply>=6&&s.balls.every(b=>b.alive)){
      const att=s.turn,key=null;
      try{nodes=0;
        if(!winIn(s,att,1)&&winIn(s,att,3)&&keys(s,att)<=2){
          const p=encode(s),k=p.g+JSON.stringify(p.b);
          if(!seen.has(k)){seen.add(k);out.push(p);perMap[map]++;console.error(`#${out.length} map ${map} move ${s.moves} (${((Date.now()-t0)/1000)|0}s)`);break;}
        }
      }catch(e){if(e!==ABORT)throw e;}
    }
    const m=chooseMove(s,lv,null,{ms:30,nodes:6000,rand:R});if(!m)break;
    const o=playMove(s,m);if(o.outcome)break;s=o.state;
  }
}
console.log(JSON.stringify(out));
