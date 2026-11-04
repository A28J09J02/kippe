// Bot against bot on the standard board.
// Usage: node tools/bot-arena.js <levelA> <levelB> [games=20] [msPerMove=400] [map=0]
// levelA always moves first, so "A wins" against an equal opponent measures the starting-player advantage.
const L=require("./load")();
const [a="hard",b="hard",games=20,ms=400,map=L.STANDARD]=process.argv.slice(2).map((x,i)=>i>=2?+x:x);
for(const k in L.BOT_LEVELS)L.BOT_LEVELS[k].time=Math.min(L.BOT_LEVELS[k].time,ms);
let aWins=0,draws=0,len=0;const why={};
for(let g=0;g<games;g++){
  const st=g%2;let s=L.newRound(map,st),out,n=0;
  for(;;){out=L.playMove(s,L.chooseMove(s,s.turn===st?a:b));n++;if(out.outcome||n>150)break;s=out.state;}
  len+=n;const o=out.outcome||{draw:true};
  if(o.draw)draws++;else{if(o.winner===st)aWins++;const k=o.reason+(o.off?"-kante":"");why[k]=(why[k]||0)+1;}
}
console.log(`${a} (beginnt) gegen ${b}: ${aWins}/${games} Siege, ${draws} Patt, Ø ${(len/games).toFixed(1)} Züge`,why);
