// Tiltrap game server (Cloudflare Workers Free plan).
//
// Lobby  – one Durable Object for everything account related: profiles (name + tag), friends,
//          head-to-head records, Elo rankings, ranked matchmaking and challenges. Clients keep one
//          WebSocket to it while the online menu is open.
// Match  – one Durable Object per duel. It speaks the same room format the client already used with
//          Firebase (players + an append-only move log), but checks every write: seats are bound to a
//          secret key handed out by the Lobby, every move is replayed with the real game rules, clocks
//          run on the server, and only the server reports results to the rankings.
//
// Privacy: an account is a name, a 4-digit tag and game statistics. No e-mail, no password, no IP
// stored beyond an hourly sign-up counter. The device keeps a random token; the server keeps only its hash.
import {DurableObject} from "cloudflare:workers";
import {MAPS,STANDARD,FAIR_SEEDS,newRound,tiltLegal,applyTilt,applyBuild,applyNudge,nudgeCheck,buildCheck} from "./logic.js";

const CODE_CHARS="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const POOL=MAPS.map((m,i)=>i).filter(i=>i!==STANDARD);
const RANKED_TIME=300;           // seconds per player and round in ranked duels
const RANKED_REMATCHES=1;        // a ranked pairing may play one rematch, then both look for new opponents
const K=32,START_ELO=1000;
const REG_PER_HOUR=8;            // new accounts per IP and hour
const now=()=>Date.now();
const rnd=n=>{const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;};
const code6=()=>{let c="";for(let i=0;i<6;i++)c+=CODE_CHARS[rnd(CODE_CHARS.length)];return c;};
function token(bytes=24){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function sha(s){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");}
function cleanName(v){
  const n=String(v||"").normalize("NFC").replace(/\s+/g," ").trim();
  return /^[\p{L}\p{N} _.\-]{2,16}$/u.test(n)?n:null;
}
const firstMap=f=>f==="pool"?POOL[rnd(POOL.length)]:f==="rand"?FAIR_SEEDS[rnd(FAIR_SEEDS.length)]:STANDARD;
const okField=f=>["std","pool","rand"].includes(f)?f:"std";
const okTime=t=>[0,60,300,600].includes(t)?t:0;
const validMap=(m,field)=>Number.isInteger(m)&&(field==="std"?m===STANDARD:field==="pool"?POOL.includes(m):FAIR_SEEDS.includes(m));
const json=(d,status=200,h={})=>new Response(JSON.stringify(d),{status,headers:{"content-type":"application/json","cache-control":"no-store",...h}});

/* ---------------- Worker: routing ---------------- */
// Only these paths exist publicly; the Durable Objects' internal paths (/int/...) cannot be reached from outside.
function cors(req){
  const o=req.headers.get("Origin")||"";
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)?{"access-control-allow-origin":o,"access-control-allow-headers":"content-type","access-control-allow-methods":"POST, GET, OPTIONS","vary":"Origin"}:{};
}
export default {
  async fetch(req,env){
    if(env.OFFLINE==="1")return json({err:"Tiltrap ist pausiert"},503,{}); // paused: no accounts, no duels
    const url=new URL(req.url),p=url.pathname,h=cors(req);
    if(req.method==="OPTIONS")return new Response(null,{status:204,headers:h});
    const lobby=()=>env.LOBBY.get(env.LOBBY.idFromName("main"));
    const ip=req.headers.get("cf-connecting-ip")||"local";
    if(p==="/api/health")return json({ok:true},200,h);
    if(p==="/api/register"&&req.method==="POST"){
      const body=await req.text();if(body.length>500)return json({err:"Zu groß"},413,h);
      const r=await lobby().fetch("https://do/pub/register",{method:"POST",body,headers:{"x-ip":ip}});
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...h}});
    }
    const ws=req.headers.get("Upgrade")==="websocket";
    if(p==="/api/lobby"&&ws)return lobby().fetch("https://do/pub/ws",req);
    const m=/^\/api\/match\/([A-Z0-9]{6})$/.exec(p);
    if(m&&ws&&[...m[1]].every(c=>CODE_CHARS.includes(c)))return env.MATCH.get(env.MATCH.idFromName(m[1])).fetch("https://do/pub/ws",req);
    return json({err:"Nicht gefunden"},404,h);
  }
};

/* ---------------- shared: simple per-socket flood guard ---------------- */
function flood(ws,max){
  const a=ws.deserializeAttachment()||{},t=now();
  if(!a.win||t-a.win>10000){a.win=t;a.cnt=0;}
  a.cnt++;ws.serializeAttachment(a);
  return a.cnt>max;
}

/* ---------------- Lobby ---------------- */
export class Lobby extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);this.sql=ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,lname TEXT NOT NULL,num INTEGER NOT NULL,hash TEXT NOT NULL,
        elo INTEGER NOT NULL DEFAULT ${START_ELO},rw INTEGER NOT NULL DEFAULT 0,rl INTEGER NOT NULL DEFAULT 0,fw INTEGER NOT NULL DEFAULT 0,fl INTEGER NOT NULL DEFAULT 0,
        created INTEGER,seen INTEGER,UNIQUE(lname,num));
      CREATE TABLE IF NOT EXISTS friends(a TEXT,b TEXT,state TEXT,created INTEGER,PRIMARY KEY(a,b));
      CREATE TABLE IF NOT EXISTS h2h(a TEXT,b TEXT,w INTEGER DEFAULT 0,l INTEGER DEFAULT 0,PRIMARY KEY(a,b));
      CREATE TABLE IF NOT EXISTS queue(uid TEXT PRIMARY KEY,elo INTEGER,since INTEGER);
      CREATE TABLE IF NOT EXISTS regs(ip TEXT,hour INTEGER,n INTEGER,PRIMARY KEY(ip,hour));
      CREATE TABLE IF NOT EXISTS challenges(code TEXT PRIMARY KEY,from_id TEXT,to_id TEXT,key TEXT,side INTEGER,created INTEGER);
      CREATE TABLE IF NOT EXISTS active(uid TEXT PRIMARY KEY,code TEXT,side INTEGER,key TEXT,ranked INTEGER,created INTEGER);
    `);
  }
  q(s,...b){return this.sql.exec(s,...b).toArray();}
  one(s,...b){return this.q(s,...b)[0]||null;}
  user(id){return this.one("SELECT * FROM users WHERE id=?",id);}
  pub(u){return u&&{id:u.id,name:u.name,num:u.num,tag:`${u.name}#${u.num}`,elo:u.elo,rw:u.rw,rl:u.rl,fw:u.fw,fl:u.fl};}
  socketsOf(uid){return this.ctx.getWebSockets().filter(w=>(w.deserializeAttachment()||{}).uid===uid);}
  push(uid,msg){const s=JSON.stringify(msg);for(const w of this.socketsOf(uid))try{w.send(s);}catch(e){}}
  online(uid){return this.socketsOf(uid).length>0;}

  async fetch(req){
    const url=new URL(req.url);
    if(url.pathname==="/pub/register")return this.register(req);
    if(url.pathname==="/pub/ws"){
      const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({uid:null});
      return new Response(null,{status:101,webSocket:pair[0]});
    }
    if(url.pathname==="/int/result")return json(this.result(await req.json()));
    return json({err:"?"},404);
  }
  async register(req){
    const ip=req.headers.get("x-ip")||"?",hour=Math.floor(now()/36e5);
    const r=this.one("SELECT n FROM regs WHERE ip=? AND hour=?",ip,hour);
    const local=["local","127.0.0.1","::1"].includes(ip); // local development only
    if(r&&r.n>=REG_PER_HOUR&&!local)return json({err:"Zu viele neue Konten von hier. Versuch es in einer Stunde nochmal."},429);
    let body;try{body=JSON.parse(await req.text());}catch(e){return json({err:"Ungültig"},400);}
    const name=cleanName(body.name);if(!name)return json({err:"Name: 2–16 Zeichen, nur Buchstaben, Zahlen, Leerzeichen, _ . -"},400);
    const lname=name.toLowerCase();let num=0;
    for(let i=0;i<40&&!num;i++){const n=1000+rnd(9000);if(!this.one("SELECT 1 FROM users WHERE lname=? AND num=?",lname,n))num=n;}
    if(!num)return json({err:"Dieser Name ist sehr beliebt, nimm bitte einen anderen."},409);
    const id=token(9),tok=token(32);
    this.sql.exec("INSERT INTO users(id,name,lname,num,hash,created,seen) VALUES(?,?,?,?,?,?,?)",id,name,lname,num,await sha(tok),now(),now());
    this.sql.exec("INSERT INTO regs(ip,hour,n) VALUES(?,?,1) ON CONFLICT(ip,hour) DO UPDATE SET n=n+1",ip,hour);
    this.sql.exec("DELETE FROM regs WHERE hour<?",hour-2);
    return json({id,token:tok,user:this.pub(this.user(id))});
  }

  async webSocketMessage(ws,raw){
    if(typeof raw!=="string"||raw.length>2000){ws.close(1009,"zu groß");return;}
    if(flood(ws,60)){ws.close(1008,"zu viele Nachrichten");return;}
    let m;try{m=JSON.parse(raw);}catch(e){return;}
    const reply=d=>{try{ws.send(JSON.stringify({t:"res",rid:m.rid,...d}));}catch(e){}};
    const att=ws.deserializeAttachment()||{};
    if(m.t==="auth"){
      const u=typeof m.id==="string"&&this.user(m.id);
      if(!u||typeof m.token!=="string"||await sha(m.token)!==u.hash){reply({err:"auth"});return;}
      att.uid=u.id;ws.serializeAttachment(att);
      this.sql.exec("UPDATE users SET seen=? WHERE id=?",now(),u.id);
      reply({ok:true,me:this.me(u.id)});
      this.notifyFriends(u.id);
      return;
    }
    const uid=att.uid;if(!uid||!this.user(uid)){reply({err:"auth"});return;}
    try{reply(await this.command(uid,m)||{ok:true});}
    catch(e){reply({err:e.userMsg||"Fehler auf dem Server"});if(!e.userMsg)console.log(e.stack||e);}
  }
  webSocketClose(ws){const a=ws.deserializeAttachment()||{};if(a.uid){this.sql.exec("DELETE FROM queue WHERE uid=?",a.uid);this.notifyFriends(a.uid);}}
  webSocketError(ws){this.webSocketClose(ws);}

  fail(msg){const e=new Error(msg);e.userMsg=msg;throw e;}
  friendIds(uid){return this.q("SELECT b FROM friends WHERE a=? AND state='ok'",uid).map(r=>r.b);}
  notifyFriends(uid){for(const f of this.friendIds(uid))if(this.online(f))this.push(f,{t:"refresh"});}
  me(uid){
    const u=this.user(uid);
    const friends=this.q(`SELECT u.*,h.w AS hw,h.l AS hl FROM friends f JOIN users u ON u.id=f.b LEFT JOIN h2h h ON h.a=f.a AND h.b=f.b WHERE f.a=? AND f.state='ok'`,uid)
      .map(x=>({...this.pub(x),online:this.online(x.id),hw:x.hw||0,hl:x.hl||0}));
    const incoming=this.q(`SELECT u.* FROM friends f JOIN users u ON u.id=f.a WHERE f.b=? AND f.state='req'`,uid).map(x=>this.pub(x));
    const outgoing=this.q(`SELECT u.* FROM friends f JOIN users u ON u.id=f.b WHERE f.a=? AND f.state='req'`,uid).map(x=>this.pub(x));
    const challenges=this.q(`SELECT c.code,u.name,u.num,u.id FROM challenges c JOIN users u ON u.id=c.from_id WHERE c.to_id=? AND c.created>?`,uid,now()-10*60000)
      .map(c=>({code:c.code,from:`${c.name}#${c.num}`,fromId:c.id}));
    const act=this.one("SELECT code,side,key,ranked FROM active WHERE uid=? AND created>?",uid,now()-6*3600000);
    const queued=!!this.one("SELECT 1 FROM queue WHERE uid=?",uid);
    const rank=u.rw+u.rl?this.one("SELECT COUNT(*)+1 AS r FROM users WHERE elo>? AND rw+rl>0",u.elo).r:null;
    return {user:this.pub(u),rank,friends,incoming,outgoing,challenges,active:act,queued};
  }
  async command(uid,m){
    switch(m.t){
      case "me":return {me:this.me(uid)};
      case "rename":{
        const name=cleanName(m.name);if(!name)this.fail("Name: 2–16 Zeichen, nur Buchstaben, Zahlen, Leerzeichen, _ . -");
        const u=this.user(uid),lname=name.toLowerCase();let num=u.num;
        if(lname!==u.lname&&this.one("SELECT 1 FROM users WHERE lname=? AND num=?",lname,num)){num=0;for(let i=0;i<40&&!num;i++){const n=1000+rnd(9000);if(!this.one("SELECT 1 FROM users WHERE lname=? AND num=?",lname,n))num=n;}}
        if(!num)this.fail("Dieser Name ist sehr beliebt, nimm bitte einen anderen.");
        this.sql.exec("UPDATE users SET name=?,lname=?,num=? WHERE id=?",name,lname,num,uid);
        this.notifyFriends(uid);return {me:this.me(uid)};
      }
      case "friend_add":{
        const t=/^(.{2,16})#(\d{4})$/u.exec(String(m.tag||"").trim());if(!t)this.fail("Gib den Namen mit Nummer ein, z. B. Lena#4821");
        const o=this.one("SELECT * FROM users WHERE lname=? AND num=?",t[1].trim().toLowerCase(),+t[2]);
        if(!o)this.fail("Niemanden mit diesem Namen gefunden.");
        if(o.id===uid)this.fail("Das bist du selbst.");
        return this.befriend(uid,o.id);
      }
      case "friend_id":{ // from an invite link: #f-<id>
        const o=typeof m.id==="string"&&this.user(m.id);if(!o)this.fail("Diesen Spieler gibt es nicht mehr.");
        if(o.id===uid)return {me:this.me(uid)};
        return this.befriend(uid,o.id);
      }
      case "friend_accept":{
        if(!this.one("SELECT 1 FROM friends WHERE a=? AND b=? AND state='req'",m.id,uid))this.fail("Keine Anfrage gefunden.");
        return this.befriend(uid,m.id);
      }
      case "friend_remove":{
        this.sql.exec("DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)",uid,m.id,m.id,uid);
        this.push(m.id,{t:"refresh"});return {me:this.me(uid)};
      }
      case "board":{
        if(m.scope==="friends"){
          const ids=[uid,...this.friendIds(uid)];
          return {list:ids.map(i=>this.pub(this.user(i))).sort((a,b)=>b.elo-a.elo||(b.rw+b.fw)-(a.rw+a.fw))};
        }
        return {list:this.q("SELECT * FROM users WHERE rw+rl>0 ORDER BY elo DESC,rw DESC LIMIT 50").map(x=>this.pub(x))};
      }
      case "invite":{ // open friendly duel: whoever opens the link takes the other seat
        const side=m.color===0||m.color===1?m.color:rnd(2),field=okField(m.field),u=this.user(uid);
        const g=await this.makeMatch({ranked:false,field,time:okTime(m.time),host:side,first:1-side,uids:side?[null,uid]:[uid,null],names:side?[null,u.name]:[u.name,null]});
        return {code:g.code,side,key:g.keys[side]};
      }
      case "join":{
        const code=String(m.code||"");if(!/^[A-Z0-9]{6}$/.test(code))this.fail("Ungültiger Code.");
        const u=this.user(uid);
        const r=await (await this.matchStub(code).fetch("https://do/int/claim",{method:"POST",body:JSON.stringify({uid,name:u.name})})).json();
        if(r.err)this.fail(r.err);
        this.setActive(uid,code,r.side,r.key,r.ranked);
        return {code,side:r.side,key:r.key};
      }
      case "challenge":{
        if(!this.one("SELECT 1 FROM friends WHERE a=? AND b=? AND state='ok'",uid,m.id))this.fail("Ihr seid noch keine Freunde.");
        const side=m.color===0||m.color===1?m.color:rnd(2),field=okField(m.field),u=this.user(uid),o=this.user(m.id);
        const uids=side?[m.id,uid]:[uid,m.id],names=side?[o.name,u.name]:[u.name,o.name];
        const g=await this.makeMatch({ranked:false,field,time:okTime(m.time),host:side,first:1-side,uids,names});
        this.sql.exec("DELETE FROM challenges WHERE from_id=? AND to_id=?",uid,m.id);
        this.sql.exec("INSERT INTO challenges(code,from_id,to_id,key,side,created) VALUES(?,?,?,?,?,?)",g.code,uid,m.id,g.keys[1-side],1-side,now());
        this.push(m.id,{t:"challenge",code:g.code,from:`${u.name}#${u.num}`});
        return {code:g.code,side,key:g.keys[side]};
      }
      case "challenge_answer":{
        const c=this.one("SELECT * FROM challenges WHERE code=? AND to_id=?",m.code,uid);
        if(!c)this.fail("Die Herausforderung gibt es nicht mehr.");
        this.sql.exec("DELETE FROM challenges WHERE code=?",m.code);
        if(!m.accept){
          await this.matchStub(c.code).fetch("https://do/int/cancel",{method:"POST",body:JSON.stringify({side:c.side})});
          this.push(c.from_id,{t:"declined",code:c.code,by:this.user(uid).name});return {ok:true};
        }
        this.setActive(uid,c.code,c.side,c.key,0);
        return {code:c.code,side:c.side,key:c.key};
      }
      case "queue":{
        const u=this.user(uid);
        this.sql.exec("INSERT INTO queue(uid,elo,since) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET since=excluded.since",uid,u.elo,now());
        await this.matchmake();
        if(this.one("SELECT 1 FROM queue"))await this.ctx.storage.setAlarm(now()+3000);
        return {queued:!!this.one("SELECT 1 FROM queue WHERE uid=?",uid)};
      }
      case "unqueue":this.sql.exec("DELETE FROM queue WHERE uid=?",uid);return {queued:false};
      case "leave_active":this.sql.exec("DELETE FROM active WHERE uid=? AND code=?",uid,String(m.code||""));return {ok:true};
      case "delete_account":{
        for(const tb of [["friends","a","b"],["h2h","a","b"],["challenges","from_id","to_id"]])this.sql.exec(`DELETE FROM ${tb[0]} WHERE ${tb[1]}=? OR ${tb[2]}=?`,uid,uid);
        this.sql.exec("DELETE FROM queue WHERE uid=?",uid);this.sql.exec("DELETE FROM active WHERE uid=?",uid);
        const fr=this.friendIds(uid);this.sql.exec("DELETE FROM users WHERE id=?",uid);
        for(const f of fr)this.push(f,{t:"refresh"});
        return {deleted:true};
      }
    }
    this.fail("Unbekannter Befehl");
  }
  befriend(uid,oid){
    if(this.one("SELECT 1 FROM friends WHERE a=? AND b=? AND state='ok'",uid,oid))return {me:this.me(uid),already:true};
    if(this.q("SELECT 1 FROM friends WHERE a=? AND state='ok'",uid).length>=200)this.fail("Maximal 200 Freunde.");
    if(this.one("SELECT 1 FROM friends WHERE a=? AND b=? AND state='req'",oid,uid)){
      this.sql.exec("DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)",uid,oid,oid,uid);
      this.sql.exec("INSERT INTO friends(a,b,state,created) VALUES(?,?,'ok',?),(?,?,'ok',?)",uid,oid,now(),oid,uid,now());
      this.push(oid,{t:"refresh",note:`${this.user(uid).name} ist jetzt dein Freund.`});
      return {me:this.me(uid),friends:true};
    }
    this.sql.exec("INSERT OR IGNORE INTO friends(a,b,state,created) VALUES(?,?,'req',?)",uid,oid,now());
    this.push(oid,{t:"refresh",note:`Freundschaftsanfrage von ${this.user(uid).name}`});
    return {me:this.me(uid),requested:true};
  }
  matchStub(code){return this.env.MATCH.get(this.env.MATCH.idFromName(code));}
  setActive(uid,code,side,key,ranked){this.sql.exec("INSERT INTO active(uid,code,side,key,ranked,created) VALUES(?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET code=excluded.code,side=excluded.side,key=excluded.key,ranked=excluded.ranked,created=excluded.created",uid,code,side,key,ranked?1:0,now());}
  async makeMatch(cfg){
    for(let i=0;i<5;i++){
      const code=code6(),keys=[token(18),token(18)];
      const r=await (await this.matchStub(code).fetch("https://do/int/init",{method:"POST",body:JSON.stringify({...cfg,code,keys,map:firstMap(cfg.field)})})).json();
      if(r.ok){cfg.uids.forEach((u,s)=>{if(u&&(s===cfg.host||cfg.ranked))this.setActive(u,code,s,keys[s],cfg.ranked);});return {code,keys};}
    }
    this.fail("Konnte kein Duell anlegen, bitte nochmal.");
  }
  // pair players whose Elo is close; the allowed gap grows the longer they wait
  async matchmake(){
    const q=this.q("SELECT * FROM queue ORDER BY since").filter(x=>{if(this.online(x.uid))return true;this.sql.exec("DELETE FROM queue WHERE uid=?",x.uid);return false;});
    const used=new Set();
    for(const a of q){
      if(used.has(a.uid))continue;
      const gap=100+Math.floor((now()-a.since)/1000)*15;
      let best=null;
      for(const b of q)if(b.uid!==a.uid&&!used.has(b.uid)&&Math.abs(a.elo-b.elo)<=gap&&(!best||Math.abs(a.elo-b.elo)<Math.abs(a.elo-best.elo)))best=b;
      if(!best)continue;
      used.add(a.uid);used.add(best.uid);
      this.sql.exec("DELETE FROM queue WHERE uid IN (?,?)",a.uid,best.uid);
      const first=rnd(2),uids=first?[best.uid,a.uid]:[a.uid,best.uid],names=uids.map(u=>this.user(u).name);
      const g=await this.makeMatch({ranked:true,field:"std",time:RANKED_TIME,host:0,first:rnd(2),uids,names});
      uids.forEach((u,s)=>this.push(u,{t:"match",code:g.code,side:s,key:g.keys[s],ranked:true,opp:names[1-s]}));
    }
  }
  async alarm(){
    await this.matchmake();
    if(this.one("SELECT 1 FROM queue"))await this.ctx.storage.setAlarm(now()+3000);
  }
  // called by a Match when a duel is decided
  result(r){
    const w=this.user(r.winner),l=this.user(r.loser);
    if(!w||!l||w.id===l.id)return {ok:false};
    let dw=0;
    if(r.ranked){
      const ew=1/(1+10**((l.elo-w.elo)/400));dw=Math.round(K*(1-ew));
      this.sql.exec("UPDATE users SET elo=elo+?,rw=rw+1 WHERE id=?",dw,w.id);
      this.sql.exec("UPDATE users SET elo=MAX(100,elo-?),rl=rl+1 WHERE id=?",dw,l.id);
    }else{
      this.sql.exec("UPDATE users SET fw=fw+1 WHERE id=?",w.id);this.sql.exec("UPDATE users SET fl=fl+1 WHERE id=?",l.id);
    }
    this.sql.exec("INSERT INTO h2h(a,b,w,l) VALUES(?,?,1,0) ON CONFLICT(a,b) DO UPDATE SET w=w+1",w.id,l.id);
    this.sql.exec("INSERT INTO h2h(a,b,w,l) VALUES(?,?,0,1) ON CONFLICT(a,b) DO UPDATE SET l=l+1",l.id,w.id);
    this.push(w.id,{t:"refresh",elo:r.ranked?dw:0});this.push(l.id,{t:"refresh",elo:r.ranked?-dw:0});
    return {ok:true,delta:dw};
  }
}

/* ---------------- Match ---------------- */
// Room format (same as before with Firebase):
//   {v, created, field, time, host, first, map, ranked, players:{p0:{name,seen,vote?,left?}, p1}, log:{m0000:{...}, ...}}
const slot=i=>"m"+String(i).padStart(4,"0");
function setPath(root,path,data){
  const parts=path.split("/").filter(Boolean);let o=root;
  for(let i=0;i<parts.length-1;i++){if(!o[parts[i]]||typeof o[parts[i]]!=="object")o[parts[i]]={};o=o[parts[i]];}
  const k=parts[parts.length-1];if(data===null)delete o[k];else o[k]=data;
}
function getPath(root,path){let o=root;for(const p of path.split("/").filter(Boolean)){if(!o||typeof o!=="object")return null;o=o[p];}return o===undefined?null:o;}
function play(S,e){
  if(e.by!==S.turn)return null;
  if(e.t==="tilt"&&typeof e.dir==="string"){const L=tiltLegal(S,e.dir);return L.ok?applyTilt(S,e.dir,L.res):null;}
  if(e.t==="nudge"&&typeof e.dir==="string"){const C=nudgeCheck(S,e.dir);return C.ok?applyNudge(S,e.dir,C):null;}
  if(e.t==="build"&&Number.isInteger(e.r)&&Number.isInteger(e.c)&&(e.kind==="S"||e.kind==="H")&&e.r>=0&&e.r<7&&e.c>=0&&e.c<7&&!buildCheck(S,e.r,e.c,e.kind))return applyBuild(S,e.r,e.c,e.kind);
  return null;
}
const OFFLINE_LIMIT=90000;   // ranked: away this long during a duel = duel lost
const CLEANUP=24*3600000;    // rooms are deleted a day after the last activity

export class Match extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      this.room=await ctx.storage.get("room")||null;
      this.meta=await ctx.storage.get("meta")||null;
      this.rebuild();
    });
  }
  async save(){await this.ctx.storage.put({room:this.room,meta:this.meta});await this.schedule();}
  // replays the log with the real rules: current position, score, phase and clocks
  rebuild(){
    if(!this.room){this.sim=null;return;}
    const R=this.room,t=(R.time||0)*1000;
    const sim={S:newRound(R.map,R.first),score:[0,0],duel:0,phase:"play",starter:R.first,last:null,duelLoser:0,field:R.field,n:0,clocks:[t,t],turnAt:this.meta.turnAt||R.created,rematches:0,moves:0};
    const log=R.log||{};
    while(log[slot(sim.n)]){this.step(sim,log[slot(sim.n)],true);sim.n++;}
    this.sim=sim;
  }
  // applies one log entry to sim; returns an error text if it is not allowed
  step(sim,e,trusted){
    const end=o=>{sim.last=o;if(!o.draw)sim.score[o.winner]++;
      if(sim.score[0]>=2||sim.score[1]>=2){sim.phase="over";sim.duelLoser=1-o.winner;}else sim.phase="round";};
    if(e.k==="m"){
      if(sim.phase!=="play")return "Runde ist vorbei";
      const out=play(sim.S,e);if(!out)return "Ungültiger Zug";
      if(typeof e.tl==="number")sim.clocks[e.by]=e.tl;
      sim.S=out.state;sim.moves++;if(out.outcome)end(out.outcome);
      return null;
    }
    if(e.k==="timeout"){if(sim.phase!=="play"||(e.by!==0&&e.by!==1))return "Keine laufende Runde";end({winner:1-e.by,reason:"time"});return null;}
    if(e.k==="forfeit"){if(sim.phase==="over"||(e.by!==0&&e.by!==1))return "Kein Duell";sim.score[1-e.by]=2;sim.score[e.by]=Math.min(sim.score[e.by],1);sim.phase="over";sim.duelLoser=e.by;sim.last={winner:1-e.by,reason:"forfeit"};return null;}
    const t=(this.room.time||0)*1000;
    if(e.k==="next"){
      if(sim.phase!=="round")return "Keine Rundenpause";
      const o=sim.last;let map,starter;
      if(!o||o.draw){map=sim.S.mapIdx;starter=1-sim.starter;}
      else{starter=1-o.winner;map=e.map;if(!trusted&&!validMap(map,sim.field))return "Ungültige Karte";if(typeof map!=="number")map=STANDARD;}
      sim.S=newRound(map,starter);sim.starter=starter;sim.phase="play";sim.last=null;sim.clocks=[t,t];
      return null;
    }
    if(e.k==="rematch"){
      if(sim.phase!=="over")return "Duell läuft noch";
      if(this.room.ranked&&sim.rematches>=RANKED_REMATCHES)return "In der Rangliste gibt es nur eine Revanche";
      const field=this.room.ranked?"std":okField(e.field);
      if(!trusted&&!validMap(e.map,field))return "Ungültige Karte";
      sim.rematches++;sim.duel++;sim.score=[0,0];sim.field=field;sim.starter=sim.duelLoser;
      sim.S=newRound(e.map,sim.duelLoser);sim.phase="play";sim.last=null;sim.clocks=[t,t];
      return null;
    }
    return "Unbekannter Eintrag";
  }
  sockets(){return this.ctx.getWebSockets().filter(w=>(w.deserializeAttachment()||{}).seat>=0);}
  connected(seat){return this.ctx.getWebSockets().some(w=>(w.deserializeAttachment()||{}).seat===seat);}
  broadcast(path,data){const s=JSON.stringify({t:"put",path,data});for(const w of this.sockets())try{w.send(s);}catch(e){}}
  async write(path,data){setPath(this.room,path,data);this.meta.active=now();await this.save();this.broadcast(path,data);}

  async fetch(req){
    const url=new URL(req.url);
    if(url.pathname==="/pub/ws"){
      if(!this.room)return new Response("Kein Duell",{status:404});
      const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({seat:-1});
      return new Response(null,{status:101,webSocket:pair[0]});
    }
    const body=await req.json();
    if(url.pathname==="/int/init"){
      if(this.room)return json({ok:false});
      const c=body;
      this.room={v:2,created:now(),field:c.field,time:c.time,host:c.host,first:c.first,map:c.map,ranked:!!c.ranked,players:{}};
      c.names.forEach((n,s)=>{if(n)this.room.players["p"+s]={name:n,seen:0};});
      this.meta={code:c.code,keys:c.keys,uids:c.uids,ranked:!!c.ranked,reported:{},turnAt:now(),active:now(),away:c.ranked?[now(),now()]:[0,0]}; // ranked: not showing up counts as away
      this.rebuild();await this.save();return json({ok:true});
    }
    if(url.pathname==="/int/claim"){
      if(!this.room)return json({err:"Kein Duell mit diesem Code gefunden."});
      const s=this.meta.uids.indexOf(body.uid);
      if(s>=0)return json({side:s,key:this.meta.keys[s],ranked:this.meta.ranked});
      if(this.meta.ranked)return json({err:"Dieses Duell gehört zur Rangliste."});
      const free=[0,1].find(i=>!this.meta.uids[i]);
      if(free===undefined)return json({err:"Dieses Duell ist schon voll."});
      this.meta.uids[free]=body.uid;
      await this.write(`players/p${free}`,{name:body.name,seen:now()});
      return json({side:free,key:this.meta.keys[free],ranked:false});
    }
    if(url.pathname==="/int/cancel"){
      if(this.room&&!this.room.log){await this.write(`players/p${body.side}`,{name:(this.room.players["p"+body.side]||{}).name||"Gegner",seen:0,left:true});}
      return json({ok:true});
    }
    return json({err:"?"},404);
  }

  async webSocketMessage(ws,raw){
    if(typeof raw!=="string"||raw.length>1000){ws.close(1009,"zu groß");return;}
    if(flood(ws,80)){ws.close(1008,"zu viele Nachrichten");return;}
    let m;try{m=JSON.parse(raw);}catch(e){return;}
    const ack=d=>{try{ws.send(JSON.stringify({t:"ack",rid:m.rid,...d}));}catch(e){}};
    const att=ws.deserializeAttachment()||{};
    if(!this.room){ack({ok:false,err:"Kein Duell"});return;}
    if(m.t==="auth"){
      const s=this.meta.keys.indexOf(m.key);
      if(s<0||!this.meta.uids[s]){ack({ok:false,err:"Kein Platz in diesem Duell"});return;}
      att.seat=s;ws.serializeAttachment(att);
      this.meta.away[s]=0;
      const p=this.room.players["p"+s]||{name:"?"};
      ack({ok:true,side:s,ranked:this.meta.ranked});
      try{ws.send(JSON.stringify({t:"put",path:"/",data:this.room}));}catch(e){}
      await this.write(`players/p${s}`,{...p,seen:now()});
      return;
    }
    const seat=att.seat;if(!(seat>=0)){ack({ok:false,err:"auth"});return;}
    if(m.t==="get"){ack({ok:true,data:getPath(this.room,String(m.path||""))});return;}
    if(m.t!=="put"){ack({ok:false});return;}
    const path=String(m.path||""),d=m.data;
    let me=/^players\/p([01])\/(seen|vote|left)$/.exec(path);
    if(me){
      if(+me[1]!==seat){ack({ok:false,err:"Nicht dein Platz"});return;}
      if(me[2]==="seen"){await this.write(path,now());ack({ok:true});return;}
      if(me[2]==="vote"){
        if(!d||typeof d.n!=="number")return ack({ok:false});
        if(this.meta.ranked&&this.sim.rematches>=RANKED_REMATCHES){ack({ok:false,err:"Nur eine Revanche in der Rangliste"});return;}
        await this.write(path,{n:d.n,field:okField(d.field)});ack({ok:true});return;
      }
      if(me[2]==="left"){
        if(this.meta.ranked&&this.sim.phase!=="over")await this.append({k:"forfeit",by:seat}); // ranked: leaving loses the duel
        await this.write(path,true);ack({ok:true});await this.report();return;
      }
    }
    me=/^log\/m(\d{4})$/.exec(path);
    if(me){
      const i=+me[1];
      if(i!==this.sim.n){ack({ok:false,err:"taken",data:getPath(this.room,path)});return;}
      if(!d||typeof d!=="object")return ack({ok:false});
      const e=this.clean(d);
      if(e.k==="m"&&e.by!==seat){ack({ok:false,err:"Nicht dein Zug"});return;}
      if(e.k==="timeout"&&e.by!==seat){
        // the opponent claims my clock ran out: only if the server's clock agrees
        if(!this.room.time||this.clockLeft(e.by)>1500){ack({ok:false,err:"Uhr läuft noch"});return;}
      }
      if(e.k==="forfeit"){ack({ok:false});return;}
      if(e.k==="m"&&this.room.time){ // the client's remaining time, but never more than the server allows
        const left=this.clockLeft(seat);e.tl=Math.max(0,Math.min(typeof e.tl==="number"?e.tl:left,left+2500));
      }
      const err=this.step(this.sim,e,false);
      if(err){ack({ok:false,err:"invalid",msg:err});this.rebuild();return;}
      this.sim.n++;this.meta.turnAt=now();
      await this.write(path,e);ack({ok:true});
      if(e.k==="rematch")for(const s of [0,1])if(this.room.players["p"+s])delete this.room.players["p"+s].vote;
      await this.report();
      return;
    }
    ack({ok:false,err:"Nicht erlaubt"});
  }
  clean(d){
    const e={k:String(d.k||"")};
    for(const k of ["t","dir","kind"])if(typeof d[k]==="string"&&d[k].length<8)e[k]=d[k];
    for(const k of ["r","c","by","tl","map"])if(typeof d[k]==="number"&&Number.isFinite(d[k]))e[k]=d[k];
    if(typeof d.field==="string")e.field=okField(d.field);
    return e;
  }
  clockLeft(p){const s=this.sim;if(!this.room.time)return Infinity;return s.S.turn===p&&s.phase==="play"?s.clocks[p]-(now()-this.meta.turnAt):s.clocks[p];}
  async append(e){const path="log/"+slot(this.sim.n);const err=this.step(this.sim,e,true);if(err)return;this.sim.n++;this.meta.turnAt=now();await this.write(path,e);}
  // tells the Lobby who won a finished duel (once per duel); ranked duels move Elo
  async report(){
    const s=this.sim,M=this.meta;
    if(s.phase!=="over"||M.reported[s.duel])return;
    const w=M.uids[1-s.duelLoser],l=M.uids[s.duelLoser];
    M.reported[s.duel]=true;await this.save();
    if(!w||!l)return;
    try{
      const r=await (await this.env.LOBBY.get(this.env.LOBBY.idFromName("main")).fetch("https://do/int/result",{method:"POST",body:JSON.stringify({ranked:M.ranked,winner:w,loser:l})})).json();
      if(M.ranked&&r.ok){const msg=JSON.stringify({t:"elo",duel:s.duel,delta:[1-s.duelLoser===0?r.delta:-r.delta,1-s.duelLoser===1?r.delta:-r.delta]});for(const ws of this.sockets())try{ws.send(msg);}catch(e){}}
    }catch(e){M.reported[s.duel]=false;await this.save();}
  }
  async webSocketClose(ws){
    const a=ws.deserializeAttachment()||{};
    if(a.seat>=0&&!this.connected(a.seat)){this.meta.away[a.seat]=now();await this.save();}
  }
  webSocketError(ws){return this.webSocketClose(ws);}
  async schedule(){
    if(!this.meta)return;
    let t=this.meta.active+CLEANUP;
    const s=this.sim;
    if(s&&s.phase==="play"&&this.room.time){t=Math.min(t,this.meta.turnAt+Math.max(0,s.clocks[s.S.turn])+6000);}
    if(s&&this.meta.ranked&&s.phase!=="over")for(const p of [0,1])if(this.meta.away[p])t=Math.min(t,this.meta.away[p]+OFFLINE_LIMIT);
    await this.ctx.storage.setAlarm(Math.max(t,now()+1000));
  }
  async alarm(){
    if(!this.meta)return;
    if(now()>=this.meta.active+CLEANUP){await this.ctx.storage.deleteAll();this.room=this.meta=this.sim=null;return;}
    const s=this.sim;
    if(s.phase==="play"&&this.room.time&&this.clockLeft(s.S.turn)<-5000)await this.append({k:"timeout",by:s.S.turn});
    if(this.meta.ranked&&s.phase!=="over")for(const p of [0,1])if(this.meta.away[p]&&now()-this.meta.away[p]>=OFFLINE_LIMIT&&!this.connected(p)){
      await this.append({k:"forfeit",by:p});await this.write(`players/p${p}/left`,true);break;}
    await this.report();await this.schedule();
  }
}
