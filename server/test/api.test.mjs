// Integration test against a running local server (npx wrangler dev). Usage: node test/api.test.mjs [base]
import {newRound,tiltLegal,applyTilt,DIRS,STANDARD} from "../src/logic.js";
const BASE=process.argv[2]||"http://127.0.0.1:8787/api";
const WSB=BASE.replace(/^http/,"ws");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,msg)=>{console.log((c?"ok   ":"FAIL ")+msg);if(!c)fails++;};
async function reg(name){const r=await fetch(BASE+"/register",{method:"POST",body:JSON.stringify({name})});return r.json();}
function sock(path){
  const ws=new WebSocket(WSB+"/"+path);let rid=0;const calls={},pushes=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if((m.t==="res"||m.t==="ack")&&calls[m.rid]){calls[m.rid](m);delete calls[m.rid];}else pushes.push(m);};
  const open=new Promise(r=>ws.onopen=r);
  return {ws,pushes,open,call:m=>new Promise(r=>{const id=++rid;calls[id]=r;ws.send(JSON.stringify({...m,rid:id}));}),
    wait:async(pred,ms=5000)=>{const t=Date.now();while(Date.now()-t<ms){const i=pushes.findIndex(pred);if(i>=0)return pushes.splice(i,1)[0];await sleep(50);}return null;}};
}
const a=await reg("Anna"),b=await reg("Ben");
ok(a.token&&b.token&&/^Anna#\d{4}$/.test(a.user.tag),"register "+a.user.tag+" "+b.user.tag);
ok((await reg("<script>")).err,"bad name rejected");
const la=sock("lobby"),lb=sock("lobby");await la.open;await lb.open;
ok((await la.call({t:"auth",id:a.id,token:"wrong"})).err==="auth","wrong token rejected");
ok((await la.call({t:"me"})).err==="auth","no command before auth");
ok((await la.call({t:"auth",id:a.id,token:a.token})).ok,"auth a");
ok((await lb.call({t:"auth",id:b.id,token:b.token})).ok,"auth b");
let r=await la.call({t:"friend_add",tag:b.user.tag});ok(r.requested,"friend request");
r=await lb.call({t:"friend_accept",id:a.id});ok(r.friends&&r.me.friends.length===1,"friend accepted");
r=await la.call({t:"board",scope:"friends"});ok(r.list.length===2,"friends board");
// ranked
await la.call({t:"queue"});await lb.call({t:"queue"});
const ma=await la.wait(m=>m.t==="match"),mb=await lb.wait(m=>m.t==="match");
ok(ma&&mb&&ma.code===mb.code&&ma.side!==mb.side,"ranked match found "+(ma&&ma.code));
const A=sock("match/"+ma.code),B=sock("match/"+mb.code);await A.open;await B.open;
ok(!(await A.call({t:"auth",key:"nope"})).ok,"wrong seat key rejected");
ok((await A.call({t:"auth",key:ma.key})).ok&&(await B.call({t:"auth",key:mb.key})).ok,"both seated");
const snap=await A.wait(m=>m.t==="put"&&m.path==="/");ok(snap&&snap.data.ranked,"room snapshot");
const room=snap.data,seat=[null,null];seat[ma.side]=A;seat[mb.side]=B;
// play: the side to move always tilts so that the opponent... just play legal tilts until someone falls
let S=newRound(room.map,room.first),n=0,score=[0,0];
ok(!(await seat[1-S.turn].call({t:"put",path:"log/m0000",data:{k:"m",t:"tilt",dir:"up",by:1-S.turn}})).ok,"move out of turn rejected");
ok(!(await seat[S.turn].call({t:"put",path:"log/m0005",data:{k:"m",t:"tilt",dir:"up",by:S.turn}})).ok,"wrong slot rejected");
ok(!(await seat[S.turn].call({t:"put",path:"players/p"+(1-S.turn)+"/left",data:true})).ok,"cannot write other seat");
const slot=i=>"m"+String(i).padStart(4,"0");
let guard=0;
while(score[0]<2&&score[1]<2&&guard++<400){
  const p=S.turn;let pick=null;
  for(const d of Object.keys(DIRS)){const L=tiltLegal(S,d);if(!L.ok)continue;const o=applyTilt(S,d,L.res);if(o.outcome&&!o.outcome.draw&&o.outcome.winner===p){pick=d;break;}if(!pick&&!(o.outcome))pick=d;}
  if(!pick)for(const d of Object.keys(DIRS))if(tiltLegal(S,d).ok){pick=d;break;}
  const res=await seat[p].call({t:"put",path:"log/"+slot(n),data:{k:"m",t:"tilt",dir:pick,by:p,tl:999999}});
  if(!res.ok){console.log("move refused",res);break;}
  const o=applyTilt(S,pick,tiltLegal(S,pick).res);n++;S=o.state;
  if(o.outcome){
    if(!o.outcome.draw)score[o.outcome.winner]++;
    if(score[0]>=2||score[1]>=2)break;
    const st=o.outcome.draw?1-S.turn:1-o.outcome.winner;
    const nx=await seat[0].call({t:"put",path:"log/"+slot(n),data:{k:"next",map:STANDARD}});
    if(!nx.ok){console.log("next refused",nx);break;}
    n++;S=newRound(STANDARD,o.outcome.draw?st:1-o.outcome.winner);
  }
}
ok(score[0]===2||score[1]===2,"duel finished "+score.join(":")+" in "+n+" entries");
const elo=await A.wait(m=>m.t==="elo");ok(elo&&elo.delta[0]===-elo.delta[1],"elo pushed "+(elo&&elo.delta));
await sleep(300);
const meA=(await la.call({t:"me"})).me;ok(meA.user.rw+meA.user.rl===1,"ranked result stored, elo "+meA.user.elo);
// rematch: votes from both, then rematch entry; second rematch must be refused
await A.call({t:"put",path:`players/p${ma.side}/vote`,data:{n:0,field:"std"}});await B.call({t:"put",path:`players/p${mb.side}/vote`,data:{n:0,field:"std"}});
r=await seat[0].call({t:"put",path:"log/"+slot(n),data:{k:"rematch",field:"std",map:STANDARD}});ok(r.ok,"rematch accepted");n++;
// friendly challenge
r=await la.call({t:"challenge",id:b.id,field:"pool",time:60,color:0});ok(r.code&&r.side===0,"challenge created");
const cp=await lb.wait(m=>m.t==="challenge");ok(cp&&cp.code===r.code,"challenge pushed");
const ans=await lb.call({t:"challenge_answer",code:r.code,accept:true});ok(ans.key&&ans.side===1,"challenge accepted");
// open invite + join
const inv=await la.call({t:"invite",field:"std",time:0,color:"r"});ok(inv.code,"invite "+inv.code);
const j=await lb.call({t:"join",code:inv.code});ok(j.key&&j.side===1-inv.side,"joined invite");
const c=await reg("Carl");const lc=sock("lobby");await lc.open;await lc.call({t:"auth",id:c.id,token:c.token});
ok((await lc.call({t:"join",code:inv.code})).err,"third player cannot join");
ok((await lc.call({t:"join",code:ma.code})).err,"stranger cannot join ranked");
// delete
ok((await lc.call({t:"delete_account"})).deleted,"account deleted");
console.log(fails?`${fails} FAILED`:"all passed");process.exit(fails?1:0);
