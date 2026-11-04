// Loads the pure game logic and the bot straight out of index.html, so tests always run the shipped code.
const fs=require("fs"),path=require("path");
module.exports=function load(){
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const part=(a,b)=>html.split(a)[1].split(b)[0];
  const code=part("// ===== LOGIC START =====","// ===== LOGIC END =====")+part("// ===== BOT START =====","// ===== BOT END =====");
  return new Function(code+";return {RULES,MAPS,STANDARD,N,DIRS,SHRINK_ORDER,BOT_LEVELS,newRound,slide,tiltLegal,applyTilt,applyBuild,applyNudge,nudgeCheck,listMoves,playMove,chooseMove,generateMap,getMap,canRoll};")();
};
