
'use strict';
/* ═══════════════ КОНСТАНТЫ ═══════════════ */
const CELL=16, GRID=26, FIELD=416, TANK=30;
const DX=[0,1,0,-1], DY=[-1,0,1,0];

/* ═══════════════ ХОЛСТ ═══════════════ */
const cv=document.getElementById('game');
const DPR=Math.min(2, window.devicePixelRatio||1);
cv.width=FIELD*DPR; cv.height=FIELD*DPR; cv.style.aspectRatio='1/1';
const ctx=cv.getContext('2d'); ctx.scale(DPR,DPR); ctx.imageSmoothingEnabled=false;

/* ═══════════════ УТИЛИТЫ ═══════════════ */
const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const overlap=(x1,y1,w1,h1,x2,y2,w2,h2)=>x1<x2+w2&&x1+w1>x2&&y1<y2+h2&&y1+h1>y2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lsGet=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};

/* ═══════════════ ЗВУК ═══════════════ */
const SND={ctx:null,gain:null,muted:lsGet('tanki.mute')==='1',moveNodes:null,moveOn:false,
  init(){ if(this.ctx) return; try{
    this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.gain=this.ctx.createGain(); this.gain.gain.value=this.muted?0:.5;
    this.gain.connect(this.ctx.destination);
  }catch(e){} },
  resume(){ if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); },
  tone(f0,f1,dur,type='square',vol=.18,delay=0){ if(!this.ctx)return;
    const t=this.ctx.currentTime+delay, o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(f0,t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1,1),t+dur);
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g); g.connect(this.gain); o.start(t); o.stop(t+dur+.03);
  },
  noise(dur,vol=.3,fc=900,delay=0){ if(!this.ctx)return;
    const t=this.ctx.currentTime+delay, n=Math.floor(this.ctx.sampleRate*dur);
    const buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const f=this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=fc;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(.001,t+dur);
    src.connect(f); f.connect(g); g.connect(this.gain); src.start(t);
  },
  setMove(on){ if(on===this.moveOn||!this.ctx) return; this.moveOn=on;
    if(on){ const o=this.ctx.createOscillator(), g=this.ctx.createGain(), l=this.ctx.createOscillator(), lg=this.ctx.createGain();
      o.type='sawtooth'; o.frequency.value=52; l.type='square'; l.frequency.value=9; lg.gain.value=.02;
      g.gain.value=.022; l.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(this.gain); o.start(); l.start(); this.moveNodes={o,l};
    } else if(this.moveNodes){ try{this.moveNodes.o.stop();this.moveNodes.l.stop();}catch(e){} this.moveNodes=null; }
  },
  toggleMute(){ this.muted=!this.muted; lsSet('tanki.mute',this.muted?'1':'0');
    if(this.gain) this.gain.gain.value=this.muted?0:.5; if(this.muted) this.setMove(false); return this.muted; }
};
const sfx={
  shoot:()=>SND.tone(880,180,.08,'square',.13),
  brick:()=>{SND.noise(.09,.22,1400);SND.tone(220,70,.08,'square',.1);},
  steel:()=>SND.tone(1500,850,.06,'triangle',.15),
  boomS:()=>SND.noise(.2,.3,800),
  boomB:()=>{SND.noise(.55,.5,420);SND.tone(130,40,.5,'sine',.3);},
  power:()=>{[660,880,1320].forEach((f,i)=>SND.tone(f,f,.09,'square',.16,i*.08));},
  life:()=>{[523,659,784,1046].forEach((f,i)=>SND.tone(f,f,.11,'square',.16,i*.1));},
  pause:()=>SND.tone(990,660,.12,'square',.14),
  intro:()=>{[392,523,659,784].forEach((f,i)=>SND.tone(f,f,.13,'square',.16,i*.13));},
  over:()=>{[392,330,262,196].forEach((f,i)=>SND.tone(f,f*.97,.3,'triangle',.2,i*.28));},
  tick:()=>SND.tone(1200,900,.05,'square',.1)
};

/* ═══════════════ СПРАЙТЫ ═══════════════ */
function rotateCW(rows){const n=rows.length,out=[];for(let y=0;y<n;y++){let s='';for(let x=0;x<n;x++)s+=rows[n-1-x][y];out.push(s);}return out;}
function makeSprite(rows,pal,scale=2){
  const c=document.createElement('canvas'); c.width=rows[0].length*scale; c.height=rows.length*scale;
  const x=c.getContext('2d');
  rows.forEach((row,ry)=>{for(let rx=0;rx<row.length;rx++){const ch=row[rx]; if(ch==='.')continue;
    x.fillStyle=pal[ch]||'#fff'; x.fillRect(rx*scale,ry*scale,scale,scale);}});
  return c;
}
const TANK_A=[
".......HH.......",".......HH.......","LLLL...BB...LLLL","DDDD...BB...DDDD",
"LLLL...BB...LLLL","DDDD...BB...DDDD","LLLL...BB...LLLL","DDDDBBBBBBBBDDDD",
"DDDDBBHHHHBBDDDD","DDDDBBHHHHBBDDDD","DDDDBBHHHHBBDDDD","DDDDBBHHHHBBDDDD",
"DDDDBBBBBBBBDDDD","DDDDBBBBBBBBDDDD","LLLL.BBBBBB.LLLL","DDDD........DDDD"];
const TANK_B=TANK_A.map(r=>r.replace(/L/g,'§').replace(/D/g,'L').replace(/§/g,'D'));
const EAGLE=[
"................","..H..........H..","..HH...HH...HH..","..HHH.HHHH.HHH..",
"...HHHHHHHHHH...","....HHHHHHHH....",".....HHHHHH.....","......HHHH......",
"......HHHH......",".....HHHHHH.....","....HH.HH.HH....","...HH..HH..HH...",
"..HH...HH...HH..","......DDDD......",".....DDDDDD.....","................"];
const EAGLE_RUIN=[
"................","................","................","................",
"................","................","....d......D....","....DD....dD....",
"...dDDDDDDDDD...","...DDDDdDDDDDD..","....DD.DD.dD....","..DD.dDDDDD.Dd..",
".DDdDDDDDDDDDDD.",".DDDDDDdDDDDdDD.","..DDdDDDDDDDDD..","................"];
const PALS={
  player:{B:'#e0a83c',H:'#ffe9a0',L:'#a8a8a8',D:'#4c4c4c'},
  basic :{B:'#c8c8c8',H:'#f2f2f2',L:'#8f8f8f',D:'#3f3f3f'},
  fast  :{B:'#9fd2e2',H:'#e6f8ff',L:'#7fa8b5',D:'#38535c'},
  power :{B:'#98c45e',H:'#e0f2b6',L:'#89a06b',D:'#3c4a2c'},
  carrier:{B:'#e0564a',H:'#ffc8b8',L:'#a88080',D:'#4c3434'},
  armor4:{B:'#5fae52',H:'#c2e8a8',L:'#7d9a74',D:'#2f452a'},
  armor3:{B:'#d8c04a',H:'#fff0a8',L:'#a89d64',D:'#4c4520'},
  armor2:{B:'#e08838',H:'#ffd8a0',L:'#ad8460',D:'#54351a'},
  armor1:{B:'#e05048',H:'#ffb8a8',L:'#a87c7c',D:'#542724'}
};
const SPR={};
for(const k in PALS){
  let rowsA=TANK_A, rowsB=TANK_B;
  SPR[k]={};
  for(let d=0;d<4;d++){
    SPR[k][d]=[makeSprite(rowsA,PALS[k]),makeSprite(rowsB,PALS[k])];
    rowsA=rotateCW(rowsA); rowsB=rotateCW(rowsB);
  }
}
const EAGLE_IMG=makeSprite(EAGLE,{H:'#f0a83c',D:'#8a8a8a'});
const RUIN_IMG=makeSprite(EAGLE_RUIN,{D:'#7a7a7a',d:'#4c4c4c'});

function makeTile(fn){const c=document.createElement('canvas');c.width=c.height=CELL;fn(c.getContext('2d'));return c;}
const TILE_BRICK=makeTile(x=>{x.fillStyle='#b13425';x.fillRect(0,0,16,16);x.fillStyle='#7c1f12';
  for(let y=0;y<16;y+=8)x.fillRect(0,y,16,1);
  x.fillRect(7,0,1,8);x.fillRect(3,8,1,8);x.fillRect(11,8,1,8);
  x.fillStyle='#d8583c';x.fillRect(0,0,16,1);});
const TILE_STEEL=makeTile(x=>{x.fillStyle='#adadad';x.fillRect(0,0,16,16);
  x.fillStyle='#f0f0f0';x.fillRect(0,0,16,1);x.fillRect(0,0,1,16);
  x.fillStyle='#545454';x.fillRect(0,15,16,1);x.fillRect(15,0,1,16);
  x.fillStyle='#e0e0e0';x.fillRect(2,2,5,5);x.fillRect(9,9,5,5);
  x.fillStyle='#787878';x.fillRect(9,2,5,5);x.fillRect(2,9,5,5);});
const TILE_ICE=makeTile(x=>{x.fillStyle='#a8dce8';x.fillRect(0,0,16,16);
  x.fillStyle='#d8f4fa';x.fillRect(0,0,16,2);x.fillRect(0,0,2,16);
  x.fillStyle='#7cb8c8';x.fillRect(4,10,8,2);x.fillRect(8,4,6,2);});
const TILE_TREE=makeTile(x=>{x.fillStyle='#1f7a1f';x.fillRect(0,0,16,16);
  x.fillStyle='#3fa33f';for(let i=0;i<9;i++)x.fillRect((i*5)%14,(i*7)%14,3,3);
  x.fillStyle='#0e4a0e';for(let i=0;i<7;i++)x.fillRect((i*9+3)%13,(i*11+2)%13,2,2);});
const WATER=[0,1].map(f=>makeTile(x=>{x.fillStyle='#2038c8';x.fillRect(0,0,16,16);
  x.fillStyle='#6888ff';for(let r=0;r<4;r++){const off=((r%2)+f)%2*4;x.fillRect(off+1,r*4+1,5,1);x.fillRect(off+9,r*4+1,5,1);}}));

/* Иконки для DOM делаются копиями canvas: data:URL не проходит
 * через img-src 'self', а canvas ограничений CSP не имеет. */
function iconCanvas(src){const c=document.createElement('canvas');c.width=src.width;c.height=src.height;
  c.getContext('2d').drawImage(src,0,0);return c;}
const FOE_ICON=makeSprite(TANK_A,PALS.basic,1);
const LIFE_ICON=makeSprite(TANK_A,PALS.player,1);
const FLAG_ICON=(()=>{const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');
  x.fillStyle='#c8c8c8';x.fillRect(3,1,2,14);x.fillStyle='#ffd23f';x.fillRect(5,2,9,7);
  x.fillStyle='#ef4b3f';x.fillRect(8,4,3,3);x.fillStyle='#7c5a10';x.fillRect(5,8,9,1);return c;})();

const POWER_GRIDS={
star:["....X....","....X....","...XXX...","XXXXXXXXX",".XXXXXXX.","..XXXXX..",".XXX.XXX.",".XX...XX.","........."],
tank:[".........","XX..X..XX","XX.XXX.XX","XX.XXX.XX","XX.XXX.XX","XX.XXX.XX","XX..X..XX",".........","........."],
shovel:["....X....","....X....","....X....","....X....","..XXXXX..","..XXXXX..","..XXXXX..","...XXX...","........."],
grenade:["....XX...","....X....","...XXX...","..XXXXX..",".XXXXXXX.",".XXXXXXX.",".XXXXXXX.","..XXXXX..","........."],
timer:["..XXXXX..",".XX...XX.",".X.....X.","X...X...X","X...X...X","X...X...X",".X.....X.",".XX...XX.","..XXXXX.."],
helmet:[".........","...XXX...","..XXXXX..",".XXXXXXX.","XXXXXXXXX","XXXXXXXXX","X..XXX..X",".........","........."]
};
const POWER_ICON={};
for(const k in POWER_GRIDS){
  const c=document.createElement('canvas');c.width=c.height=40;const x=c.getContext('2d');
  x.fillStyle='#c6281f';x.fillRect(0,0,40,40);x.fillStyle='#8e140e';x.fillRect(0,36,40,4);
  x.fillStyle='#fff';
  POWER_GRIDS[k].forEach((row,ry)=>{for(let rx=0;rx<9;rx++)if(row[rx]==='X')x.fillRect(2+rx*4,2+ry*4,4,4);});
  POWER_ICON[k]=c;
}

/* ═══════════════ КАРТЫ (15 штук) ═══════════════ */
const MAPS=[
[".............",".B.B.B.B.B.B.",".B.B.B.B.B.B.",".B.B.BSB.B.B.",".B.B.BSB.B.B.",".....B.B.....",
 "BB..SSS...BB.",".............",".B.B.B.B.B.B.",".B.B.B.B.B.B.",".B.B.B.B.B.B.",".............","............."],
[".............",".BB.......BB.",".BB..BBB..BB.",".....B.B.....",".WW..B.B..WW.",".WW..BBB..WW.",
 ".WW.......WW.",".WW..BBB..WW.",".WW..B.B..WW.",".....B.B.....",".BB..BBB..BB.",".............","............."],
[".............","..TT.....TT..",".TTTT.B.TTTT.",".TTTT.B.TTTT.","..TT..B..TT..","......B......",
 "BBB.......BBB","......B......","..TT..B..TT..",".TTTT.B.TTTT.",".TTTT.T.TTTT.",".............","............."],
[".............",".S.B.B.B.B.S.",".S.B.B.B.B.S.",".............","..BSS...SSB..","..B.......B..",
 "...S.BBB.S...","..B.......B..","..BSS...SSB..",".............",".S.B.B.B.B.S.",".............","............."],
[".............",".BB.IIIII.BB.",".BB.I...I.BB.","....I.B.I....","IIIII.B.IIIII","....B.B.B....",
 ".BB.B...B.BB.","....BBBBB....","IIIII...IIIII","....I.B.I....",".BB.I...I.BB.",".............","............."],
[".............",".B.B.B.B.B.B.",".B.B.B.B.B.B.",".............",".B.B.B.B.B.B.",".............",
 ".B.B.B.B.B.B.",".............",".B.B.B.B.B.B.",".............",".B.B.B.B.B.B.",".............","............."],
[".............","SSS.......SSS",".............","S.B.B.B.B.B.S","S...........S","S.SSS.SSS.S.S",
 "S...........S","S.B.B.B.B.B.S",".............","SSS.......SSS",".............",".............","............."],
[".............",".BWW.....WWB.",".BWW.BBB.WWB.","....BB.BB....","..WW.....WW..","..WW.SSS.WW..",
 "..WW.....WW..","....BB.BB....",".BWW.BBB.WWB.",".BWW.....WWB.",".............",".............","............."],
[".............","TTTT.TTT.TTTT","T...T.....T.T","T.B.T.BBB.T.T","T...T...T.T.T","TTTTT...TTTTT",
 "T...T.B.T...T","T.B.T...T.B.T","T...TT.TT...T","TTTTT.T.TTTTT",".............",".............","............."],
[".............","SSSSSSSSSSSSS","S...........S","S.BBBBBBBBB.S","S.B.......B.S","S.B.SSSSS.B.S",
 "S.B.S...S.B.S","S.B.SSSSS.B.S","S.B.......B.S","S.BBBBBBBBB.S","S...........S",".............","............."],
[".............",".BBBBBBBBBBB.",".............","BBBBBBBBBBB..",".............",".BBBBBBBBBBB.",
 ".............","BBBBBBBBBBB..",".............",".BBBBBBBBBBB.",".............",".............","............."],
[".............",".SSS.....SSS.",".S.B.....B.S.",".S.B.....B.S.",".SSS.....SSS.",".............",
 "......S......",".............",".SSS.....SSS.",".S.B.....B.S.",".S.B.....B.S.",".............","............."],
[".............",".B.W.W.W.W.B.",".B.W.W.W.W.B.",".............","WWWWWWWWWWWWW",".............",
 ".B.W.W.W.W.B.",".B.W.W.W.W.B.",".............","WWWWWWWWWWWWW",".............",".............","............."],
[".............","IIIIIIIIIIIII","I.B.I...I.B.I","I...I.B.I...I","I.B.I...I.B.I",".............",
 "III...S...III",".............","I.B.I...I.B.I","I...I.B.I...I","I.B.I...I.B.I",".............","............."],
["SSS.SSS.SSS.S","S...S...S...S","S.B.B.B.B.B.S","S...S...S...S",".............",".BBBBBBBBBBB.",
 ".....S.S.....",".BBBBBBBBBBB.",".............","S...S...S...S","S.B.B.B.B.B.S",".............","............."]
];
const COMP=[[13,4,3,0],[9,6,4,1],[7,6,4,3],[4,5,5,6],[3,4,6,7]];
const FORT=[[11,23],[12,23],[13,23],[14,23],[11,24],[14,24],[11,25],[14,25]];
const ETYPES={
  a:{spd:.75,bspd:3,hp:1,pts:100,pal:'basic'},
  b:{spd:1.5, bspd:3,hp:1,pts:200,pal:'fast'},
  c:{spd:.85, bspd:5,hp:1,pts:300,pal:'power'},
  d:{spd:.6,  bspd:3,hp:4,pts:400,pal:'armor'}
};

/* ═══════════════ СОСТОЯНИЕ ═══════════════ */
const G={
  state:'title', paused:false, frame:0, level:1, score:0, hi:0, lives:3, menuIndex:0,
  grid:new Uint8Array(GRID*GRID), player:null, enemies:[], bullets:[], effects:[], pops:[],
  powers:[], spawns:[], queue:[], spawned:0, spawnT:0, freezeT:0, shovelT:0,
  baseAlive:true, kills:{a:0,b:0,c:0,d:0}, introT:0, overT:0, overDelay:0, overReason:'',
  scoreSentValue:0,
  tally:null, titleAnim:0, testMode:false, custom:null
};
G.hi=+lsGet('tanki.hi')||0;

function makeQueue(level){
  const c=COMP[Math.min(level-1,COMP.length-1)], q=[], types=['a','b','c','d'];
  const left=[...c];
  while(left.some(n=>n>0)){ for(let i=0;i<4;i++) if(left[i]>0){q.push(types[i]);left[i]--;} }
  for(let i=0;i<8;i++){const a=randInt(0,19),b=randInt(0,19);[q[a],q[b]]=[q[b],q[a]];}
  return q;
}
function buildLevel(map){
  G.grid.fill(0);
  const CH={B:1,S:2,W:3,T:4,I:5};
  for(let r=0;r<13;r++)for(let c=0;c<13;c++){const v=CH[map[r][c]];
    if(v)for(let dr=0;dr<2;dr++)for(let dc=0;dc<2;dc++)G.grid[(r*2+dr)*GRID+c*2+dc]=v;}
  [[12,24],[13,24],[12,25],[13,25]].forEach(([c,r])=>G.grid[r*GRID+c]=6);
  FORT.forEach(([c,r])=>G.grid[r*GRID+c]=1);
  [[0,0],[12,0],[24,0],[8,24]].forEach(([c0,r0])=>{
    for(let r=r0;r<r0+2;r++)for(let c=c0;c<c0+2;c++){const v=G.grid[r*GRID+c];if(v!==6)G.grid[r*GRID+c]=0;}});
}
function setupField(){
  G.queue=makeQueue(G.level); G.spawned=0; G.spawnT=80;
  G.enemies=[];G.bullets=[];G.effects=[];G.pops=[];G.powers=[];G.spawns=[];
  G.freezeT=0;G.shovelT=0;G.baseAlive=true;G.kills={a:0,b:0,c:0,d:0};
  const sp=Math.min(.35,Math.max(0,(G.level-5))*.05);
  G.player={x:129,y:385,dir:0,spd:1.6+sp*.5,star:0,shieldT:120,cool:0,alive:true,respawnT:0,
            slideV:0,lastDir:2,anim:0,team:'p',boost:sp};
  updateHUD();
}
function loadLevel(n){ G.level=n; buildLevel(MAPS[(n-1)%MAPS.length]); setupField(); }
function loadCustom(){ G.level=1; buildLevel(G.custom); setupField(); }

/* ═══════════════ HUD ═══════════════ */
const elFoes=document.getElementById('foes'), elLives=document.getElementById('lives');
(()=>{const x=document.getElementById('flagCanvas').getContext('2d');x.drawImage(FLAG_ICON,0,0);})();
function updateHUD(){
  const left=G.queue.length+G.spawns.length;
  elFoes.innerHTML='';
  for(let i=0;i<left;i++){const d=document.createElement('canvas');d.className='foe';d.width=16;d.height=16;
    d.getContext('2d').drawImage(FOE_ICON,0,0);elFoes.appendChild(d);}
  elLives.innerHTML='';
  for(let i=0;i<Math.min(G.lives,6);i++){const d=document.createElement('canvas');d.className='life';d.width=16;d.height=16;
    d.getContext('2d').drawImage(LIFE_ICON,0,0);elLives.appendChild(d);}
  document.getElementById('hudLevel').textContent=G.level;
}
const chipScore=document.getElementById('chipScore'), chipHi=document.getElementById('chipHi'), chipWrap=document.getElementById('chipScoreWrap');

/* Чипы счёта и рекорда приводим к состоянию игры. Раньше рекорд
 * обновлялся только внутри addScore, а чипы читались один раз при
 * загрузке: после игры счёт на экране оставался нулевым, хотя
 * результат уходил в таблицу. */
function syncChips(){
  chipScore.textContent=String(G.score);
  if(G.score>G.hi){G.hi=G.score;lsSet('tanki.hi',G.hi);}
  chipHi.textContent=String(G.hi);
}
syncChips();
function addScore(n,x,y){
  G.score+=n; syncChips();
  chipWrap.classList.remove('pop'); void chipWrap.offsetWidth; chipWrap.classList.add('pop');
  if(x!==undefined)G.pops.push({x,y,t:0,txt:'+'+n});
}
function showEditorHUD(){document.getElementById('hudGame').hidden=true;document.getElementById('hudEditor').hidden=false;}
function showGameHUD(){document.getElementById('hudGame').hidden=false;document.getElementById('hudEditor').hidden=true;updateHUD();}

/* ═══════════════ РЕДАКТОР КАРТ ═══════════════ */
const ED={map:[], slot:1, tool:'B', hover:null, painting:false, msg:null};
const TOOL_ORDER=['B','S','W','T','I','.'];
const TOOL_NAMES={B:'КИРПИЧ',S:'СТАЛЬ',W:'ВОДА',T:'ЛЕС',I:'ЛЁД','.':'ЛАСТИК'};
const RESERVED=new Set(['0,0','6,0','12,0','4,12','5,11','6,11','7,11','5,12','6,12','7,12']);
const TILE_IMG={B:TILE_BRICK,S:TILE_STEEL,W:WATER[0],T:TILE_TREE,I:TILE_ICE};
const ERASER_ICON=(()=>{const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');
  x.fillStyle='#1a1d2b';x.fillRect(0,0,16,16);x.strokeStyle='#ef4b3f';x.lineWidth=3;
  x.beginPath();x.moveTo(3,3);x.lineTo(13,13);x.moveTo(13,3);x.lineTo(3,13);x.stroke();return c;})();

const elTools=document.getElementById('tools'), elToolName=document.getElementById('edToolName');
const toolBtns={};
TOOL_ORDER.forEach((t,i)=>{
  const b=document.createElement('button'); b.className='tool'; b.title=TOOL_NAMES[t]+' ['+(i+1)+']';
  const prev=document.createElement('canvas'); prev.width=16; prev.height=16;
  prev.getContext('2d').drawImage(t==='.'?ERASER_ICON:TILE_IMG[t],0,0);
  b.appendChild(prev);
  b.addEventListener('click',()=>{selectTool(t);b.blur();});
  elTools.appendChild(b); toolBtns[t]=b;
});
function selectTool(t){ ED.tool=t;
  for(const k in toolBtns) toolBtns[k].classList.toggle('sel',k===t);
  elToolName.textContent=TOOL_NAMES[t]; sfx.tick(); }
selectToolSilent('B');
function selectToolSilent(t){ ED.tool=t;
  for(const k in toolBtns) toolBtns[k].classList.toggle('sel',k===t);
  elToolName.textContent=TOOL_NAMES[t]; }

const elDots=document.getElementById('slotDots');
for(let i=0;i<8;i++)elDots.appendChild(document.createElement('i'));
function refreshDots(){
  [...elDots.children].forEach((d,i)=>d.classList.toggle('on',!!lsGet('tanki.custom.'+(i+1))));
  document.getElementById('edSlot').textContent=ED.slot;
}
function edBlank(){ return Array.from({length:13},()=>'.............'.split('')); }
function edLoadSlot(silent){
  const s=lsGet('tanki.custom.'+ED.slot);
  if(s&&s.length===169&&/^[.BSWTI]+$/.test(s)){ ED.map=Array.from({length:13},(_,r)=>s.slice(r*13,r*13+13).split(''));
    if(!silent)edFlash('Слот '+ED.slot+' загружен');
  } else { ED.map=edBlank(); if(!silent)edFlash('Слот '+ED.slot+' пуст'); }
  refreshDots();
}
function edFlash(txt){ ED.msg={txt,t:110}; }
function edSave(){ lsSet('tanki.custom.'+ED.slot, ED.map.map(r=>r.join('')).join(''));
  edFlash('Сохранено в слот '+ED.slot+' ✓'); refreshDots(); sfx.power(); }
function edClear(){ ED.map=edBlank(); edFlash('Карта очищена'); sfx.steel(); }
function edSlot(d){ ED.slot=1+((ED.slot-1+d+8)%8); edLoadSlot(); lsSet('tanki.lastSlot',ED.slot); sfx.tick(); }
function edExport(){
  const code=btoa(ED.map.map(r=>r.join('')).join(''));
  const done=()=>edFlash('Код карты скопирован');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(done,()=>edFlash('Код: '+code.slice(0,18)+'…'));
  } else edFlash('Код: '+code.slice(0,18)+'…');
}
function edImport(){
  const code=(document.getElementById('edImportCode')||{}).value||'';
  if(!code)return;
  document.getElementById('edImportCode').value='';
  try{
    const s=atob(code.trim());
    if(s.length===169&&/^[.BSWTI]+$/.test(s)){
      ED.map=Array.from({length:13},(_,r)=>s.slice(r*13,r*13+13).split(''));
      edFlash('Импортировано ✓'); sfx.power();
    } else edFlash('Неверный код');
  }catch(e){ edFlash('Ошибка кода'); }
}
function enterEditor(){
  G.state='editor'; G.paused=false; G.testMode=false; SND.setMove(false);
  ED.slot=clamp(+lsGet('tanki.lastSlot')||1,1,8);
  edLoadSlot(true); showEditorHUD();
}
function edTest(){
  G.custom=ED.map.map(r=>r.join(''));
  G.testMode=true; G.score=0; syncChips(); G.lives=3;
  loadCustom(); G.state='intro'; G.introT=0; sfx.intro(); showGameHUD();
}
function exitToEditor(){ G.testMode=false; G.custom=null; enterEditor(); }
function edPaint(c,r,erase){
  if(c<0||c>12||r<0||r>12)return;
  if(RESERVED.has(c+','+r)){ if(!ED.warnT||ED.warnT<=0){edFlash('Зарезервировано: спавн/база');ED.warnT=60;} return; }
  const ch=erase?'.':ED.tool;
  if(ED.map[r][c]===ch)return;
  ED.map[r][c]=ch;
}
/* кнопки панели */
document.getElementById('edTest').addEventListener('click',e=>{e.target.blur();edTest();});
document.getElementById('edClear').addEventListener('click',e=>{e.target.blur();edClear();});
document.getElementById('edPrev').addEventListener('click',e=>{e.target.blur();edSlot(-1);});
document.getElementById('edNext').addEventListener('click',e=>{e.target.blur();edSlot(1);});
document.getElementById('edSave').addEventListener('click',e=>{e.target.blur();edSave();});
document.getElementById('edLoad').addEventListener('click',e=>{e.target.blur();edLoadSlot();});
document.getElementById('edExport').addEventListener('click',e=>{e.target.blur();edExport();});
document.getElementById('edImport').addEventListener('click',e=>{e.target.blur();edImport();});
document.getElementById('edBack').addEventListener('click',e=>{e.target.blur();toTitle();});

/* указатель на холсте (рисование + старт) */
function canvasPos(e){const rect=cv.getBoundingClientRect();
  return {x:(e.clientX-rect.left)/rect.width*FIELD, y:(e.clientY-rect.top)/rect.height*FIELD};}
function cellAt(p){return {c:Math.floor(p.x/32), r:Math.floor(p.y/32)};}
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('pointerdown',e=>{
  SND.init(); SND.resume();
  if(G.state==='title'){
    const p=canvasPos(e);
    if(p.y>232&&p.y<262)runMenu(0); else if(p.y>=262&&p.y<292)runMenu(1); else runMenu(G.menuIndex);
    return;
  }
  if(G.state==='editor'){
    const p=canvasPos(e), {c,r}=cellAt(p);
    ED.hover={c,r}; ED.painting=true;
    try{cv.setPointerCapture(e.pointerId);}catch(_){}
    edPaint(c,r,e.button===2);
  }
});
cv.addEventListener('pointermove',e=>{
  if(G.state!=='editor')return;
  const p=canvasPos(e), {c,r}=cellAt(p);
  ED.hover=(c>=0&&c<13&&r>=0&&r<13)?{c,r}:null;
  if(ED.painting&&ED.hover)edPaint(c,r,e.button===2);
});
['pointerup','pointercancel'].forEach(ev=>cv.addEventListener(ev,()=>{ED.painting=false;}));
cv.addEventListener('pointerleave',()=>{if(!ED.painting)ED.hover=null;});

/* ═══════════════ ВВОД ═══════════════ */
const keys={};
function inputDir(){
  if(keys.ArrowUp||keys.KeyW)return 0; if(keys.ArrowRight||keys.KeyD)return 1;
  if(keys.ArrowDown||keys.KeyS)return 2; if(keys.ArrowLeft||keys.KeyA)return 3; return -1;
}
const fireHeld=()=>!!(keys.Space||keys.touchFire);
function touchDir(){return keys.touchDir!==undefined?keys.touchDir:-1;}
function runMenu(i){ if(i===0)startGame(); else enterEditor(); }

window.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  keys[e.code]=true; SND.init(); SND.resume();
  if(e.code==='KeyM'){setSound(SND.toggleMute());return;}
  if(e.code==='KeyF'&&G.state!=='editor'){toggleFs();return;}
  if(e.code==='KeyP'||e.code==='Escape'){ if(G.state==='playing'){togglePause();return;}
    if(G.state==='editor'&&e.code==='Escape'){toTitle();return;} }

  if(G.state==='title'){
    if(['ArrowUp','ArrowDown','KeyW','KeyS'].includes(e.code)){G.menuIndex^=1;sfx.tick();return;}
    if(e.code==='Enter'||e.code==='Space')runMenu(G.menuIndex);
    return;
  }
  if(G.state==='editor'){
    if(e.code.startsWith('Digit')){const n=+e.code.slice(5); if(n>=1&&n<=6)selectTool(TOOL_ORDER[n-1]);}
    if(e.code==='Enter')edTest();
    if(e.code==='KeyC')edClear();
    if(e.code==='BracketLeft')edSlot(-1);
    if(e.code==='BracketRight')edSlot(1);
    return;
  }
  if(G.state==='intro'){ if(e.code==='Enter'&&G.testMode)exitToEditor(); return; }
  if(G.state==='playing'){
    if(e.code==='KeyE'&&G.testMode){exitToEditor();return;}
    return;
  }
  if(G.state==='tally'){
    if(G.testMode){
      if(e.code==='Enter')edTest();
      if(e.code==='KeyE'||e.code==='Escape')exitToEditor();
    } else if(e.code==='Enter'||e.code==='Space')G.tally.fast=true;
    return;
  }
  if(G.state==='over'&&G.overT>50){
    if(e.code==='Enter'||e.code==='Space'){ G.testMode?exitToEditor():toTitle(); }
    return;
  }
});
window.addEventListener('keyup',e=>{keys[e.code]=false;});

/* При потере фокуса keyup не приходит, и клавиша остаётся зажатой:
 * танк продолжает ехать и стрелять, пока игрок не нажмёт её снова.
 * Чистим всё состояние ввода, как только окно теряет фокус. */
function releaseAll(){ for(const k in keys) keys[k]=false; }
window.addEventListener('blur',releaseAll);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) releaseAll(); });
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G.state==='playing'&&!G.paused)togglePause();});

/* Мобильное управление. Слушатели дублированы: pointer-события
 * работают не во всех мобильных браузерах, а touch-события — везде.
 * Без дублей на части телефонов огонь просто не срабатывал. */
document.querySelectorAll('.dbtn').forEach(b=>{
  const d=+b.dataset.dir;
  const down=e=>{e.preventDefault();SND.init();SND.resume();keys.touchDir=d;};
  const up=e=>{e.preventDefault();if(keys.touchDir===d)keys.touchDir=undefined;};
  b.addEventListener('pointerdown',down);
  b.addEventListener('touchstart',down,{passive:false});
  ['pointerup','pointercancel','touchend','touchcancel'].forEach(ev=>b.addEventListener(ev,up,{passive:false}));
  b.addEventListener('contextmenu',e=>e.preventDefault());
});
const btnFire=document.getElementById('btnFire');
const fireDown=e=>{e.preventDefault();SND.init();SND.resume();
  if(G.state==='title'){runMenu(G.menuIndex);return;} keys.touchFire=true;};
const fireUp=e=>{e.preventDefault();keys.touchFire=false;};
btnFire.addEventListener('pointerdown',fireDown);
btnFire.addEventListener('touchstart',fireDown,{passive:false});
['pointerup','pointercancel','touchend','touchcancel'].forEach(ev=>btnFire.addEventListener(ev,fireUp,{passive:false}));
btnFire.addEventListener('contextmenu',e=>e.preventDefault());

/* ═══════════════ ЛОГИКА ИГРЫ ═══════════════ */
function allTanks(){return G.enemies.concat(G.player&&G.player.alive?[G.player]:[]);}
function canMove(t,nx,ny){
  if(nx<0||ny<0||nx+TANK>FIELD||ny+TANK>FIELD)return false;
  const c0=nx>>4,c1=(nx+TANK-1)>>4,r0=ny>>4,r1=(ny+TANK-1)>>4;
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
    const v=G.grid[r*GRID+c]; if(v===1||v===2||v===3||v===6)return false;}
  for(const o of allTanks())if(o!==t&&overlap(nx,ny,TANK,TANK,o.x,o.y,TANK,TANK))return false;
  return true;
}
function turnTo(t,d){
  if(t.dir===d)return;
  if(d===1||d===3)t.y=Math.round(t.y/16)*16; else t.x=Math.round(t.x/16)*16;
  t.dir=d;
}
function onIce(t){const c=Math.floor((t.x+15)/16),r=Math.floor((t.y+15)/16);
  return c>=0&&c<GRID&&r>=0&&r<GRID&&G.grid[r*GRID+c]===5;}

function startGame(){
  G.testMode=false; G.custom=null;
  G.score=0;syncChips();G.lives=3;
  loadLevel(1); G.state='intro'; G.introT=0; G.paused=false; sfx.intro(); showGameHUD();
}
function toTitle(){G.state='title';G.testMode=false;G.custom=null;SND.setMove(false);showGameHUD();updateHUD();syncChips();}
function togglePause(){
  if(G.state!=='playing')return;
  G.paused=!G.paused; sfx.pause(); SND.setMove(false);
  document.getElementById('btnPause').textContent=G.paused?'ИГРАТЬ':'ПАУЗА';
}
document.getElementById('btnPause').addEventListener('click',e=>{e.target.blur();togglePause();});
const btnSound=document.getElementById('btnSound');
function setSound(m){btnSound.textContent=m?'ЗВУК: ВЫКЛ':'ЗВУК: ВКЛ';}
btnSound.addEventListener('click',e=>{e.target.blur();SND.init();setSound(SND.toggleMute());});

/* Полный экран: растягиваем сам телевизор, тогда HUD и кнопки остаются */
const tvEl=document.querySelector('.tv');
function toggleFs(){
  const doc=document;
  if(doc.fullscreenElement||doc.webkitFullscreenElement){ (doc.exitFullscreen||doc.webkitExitFullscreen).call(doc); }
  else if(tvEl){ (tvEl.requestFullscreen||tvEl.webkitRequestFullscreen||function(){}).call(tvEl); }
}
document.getElementById('btnFs').addEventListener('click',e=>{e.target.blur();toggleFs();});
setSound(SND.muted);

function trySpawn(){
  if(!G.queue.length)return;
  if(G.enemies.length+G.spawns.length>=4)return;
  const pts=shuffle([[0,0],[192,0],[384,0]]);
  for(const [px,py] of pts){
    let free=true;
    for(const t of allTanks())if(overlap(px,py,32,32,t.x,t.y,TANK,TANK)){free=false;break;}
    if(free){
      const type=G.queue.shift();
      G.spawns.push({x:px,y:py,t:0,type,carrier:[3,10,17].includes(G.spawned)});
      G.spawned++; G.spawnT=150; updateHUD(); return;
    }
  }
  G.spawnT=60;
}
function spawnEnemy(s){
  const b=ETYPES[s.type], boost=Math.min(.4,Math.max(0,G.level-5)*.05);
  G.enemies.push({x:s.x+1,y:s.y+1,dir:2,type:s.type,carrier:s.carrier,
    hp:b.hp,spd:b.spd+boost,bspd:b.bspd,pts:b.pts,pal:b.pal,
    aiT:randInt(20,80),shootT:randInt(40,110),anim:0,team:'e'});
}
function fire(t){
  const max=t.team==='p'?(t.star>=2?2:1):1;
  if(G.bullets.filter(b=>b.owner===t).length>=max)return;
  if(t.cool>0)return;
  const spd=t.team==='p'?(t.star>=1?6:4):t.bspd;
  G.bullets.push({x:t.x+15+DX[t.dir]*17,y:t.y+15+DY[t.dir]*17,dir:t.dir,spd,
    team:t.team,owner:t,pierce:t.team==='p'&&t.star>=3});
  t.cool=t.team==='p'?11:0; sfx.shoot();
}
function destroyBricks(b,pierce){
  const tx=b.x+DX[b.dir]*4, ty=b.y+DY[b.dir]*4;
  const band=[(b.dir<=1?tx:ty)-8,(b.dir<=1?tx:ty)+8];
  const line=b.dir<=1?Math.floor(ty/16):Math.floor(tx/16);
  for(let i=0;i<GRID;i++){
    const lo=i*16,hi=lo+16;
    if(hi>band[0]&&lo<band[1]){
      let r,c; if(b.dir<=1){r=line;c=i;}else{r=i;c=line;}
      if(r<0||r>=GRID||c<0||c>=GRID)continue;
      const idx=r*GRID+c,v=G.grid[idx];
      if(v===1)G.grid[idx]=0;
      else if(v===2&&pierce)G.grid[idx]=0;
      else if(v===6){destroyBase();return;}
    }
  }
}
function destroyBase(){
  if(!G.baseAlive)return;
  G.baseAlive=false;
  [[12,24],[13,24],[12,25],[13,25]].forEach(([c,r])=>G.grid[r*GRID+c]=0);
  G.effects.push({x:208,y:400,big:true,t:0});
  sfx.boomB(); shake();
  G.freezeT=9999; G.overDelay=80; G.overReason='База уничтожена!';
}
function killPlayer(){
  const p=G.player; if(!p.alive||p.shieldT>0)return;
  p.alive=false; G.effects.push({x:p.x+15,y:p.y+15,big:true,t:0}); sfx.boomB(); shake();
  SND.setMove(false);
  G.lives--; updateHUD();
  if(G.lives>0){p.respawnT=90;}
  else{G.overDelay=100;G.overReason='';}
}
function damageEnemy(e,b){
  e.hp--;
  if(e.hp<=0){
    G.effects.push({x:e.x+15,y:e.y+15,big:true,t:0}); sfx.boomB();
    addScore(e.pts,e.x+15,e.y); G.kills[e.type]++;
    if(e.carrier)dropPower();
    G.enemies.splice(G.enemies.indexOf(e),1);
  } else sfx.steel();
}
function dropPower(){
  const types=['star','tank','grenade','timer','shovel','helmet'];
  for(let i=0;i<50;i++){
    const x=randInt(1,23)*16, y=randInt(1,22)*16;
    if(!overlap(x,y,32,32,176,368,64,48)){
      G.powers.push({x,y,type:types[randInt(0,5)],life:720}); return;
    }
  }
}
function applyPower(pw){
  const p=G.player; sfx.power(); addScore(500,pw.x+16,pw.y+16);
  switch(pw.type){
    case 'star': if(p.star<3)p.star++; else addScore(500); break;
    case 'helmet': p.shieldT=600; break;
    case 'shovel': FORT.forEach(([c,r])=>G.grid[r*GRID+c]=2); G.shovelT=900; break;
    case 'tank': G.lives++; updateHUD(); sfx.life(); break;
    case 'grenade':
      [...G.enemies].forEach(e=>{G.effects.push({x:e.x+15,y:e.y+15,big:true,t:0});
        addScore(e.pts,e.x+15,e.y);G.kills[e.type]++;});
      G.enemies=[]; sfx.boomB(); shake(); break;
    case 'timer': G.freezeT=480; break;
  }
}
function shake(){const s=document.getElementById('screen');s.classList.remove('shake');void s.offsetWidth;s.classList.add('shake');}

function prefDirs(e){
  const toBase=G.frame%600<300||!G.player.alive;
  const tx=toBase?192:G.player.x, ty=toBase?384:G.player.y, arr=[];
  if(ty<e.y)arr.push(0); if(ty>e.y)arr.push(2);
  if(tx>e.x)arr.push(1); if(tx<e.x)arr.push(3);
  return arr;
}
function chooseDir(e){
  let dirs=shuffle([0,1,2,3]);
  if(Math.random()<.55){
    const p=prefDirs(e);
    dirs.sort((a,b)=>((p.indexOf(a)<0)?1:0)-((p.indexOf(b)<0)?1:0));
  }
  for(const d of dirs){
    if(canMove(e,e.x+DX[d]*6,e.y+DY[d]*6)){turnTo(e,d);break;}
  }
  e.aiT=randInt(45,160);
}
function updateEnemy(e){
  if(G.freezeT>0)return;
  e.aiT--; e.shootT--;
  const nx=e.x+DX[e.dir]*e.spd, ny=e.y+DY[e.dir]*e.spd;
  if(canMove(e,nx,ny)){e.x=nx;e.y=ny;e.anim=(G.frame>>2)&1;}
  else chooseDir(e);
  if(e.aiT<=0&&!onIce(e))chooseDir(e);
  if(e.shootT<=0&&G.bullets.filter(b=>b.owner===e).length<1){
    fire(e); e.shootT=randInt(50,140)-(e.type==='c'?30:0);
  }
}
function updateBullet(b){
  for(let s=0;s<b.spd;s+=2){
    b.x+=DX[b.dir]*2; b.y+=DY[b.dir]*2;
    if(b.x<2||b.y<2||b.x>FIELD-2||b.y>FIELD-2){
      G.effects.push({x:clamp(b.x,6,FIELD-6),y:clamp(b.y,6,FIELD-6),big:false,t:0});return false;
    }
    const r=Math.floor(b.y/16),c=Math.floor(b.x/16);
    if(r>=0&&r<GRID&&c>=0&&c<GRID){
      const v=G.grid[r*GRID+c];
      if(v===1||(v===2&&!b.pierce)||v===6){
        destroyBricks(b,b.pierce);
        if(v===2)sfx.steel(); else sfx.brick();
        G.effects.push({x:b.x,y:b.y,big:false,t:0});return false;
      }
    }
    if(b.team==='p'){
      for(const e of G.enemies)if(overlap(b.x-4,b.y-4,8,8,e.x,e.y,TANK,TANK)){
        damageEnemy(e,b);G.effects.push({x:b.x,y:b.y,big:false,t:0});return false;}
    } else if(G.player.alive&&overlap(b.x-4,b.y-4,8,8,G.player.x,G.player.y,TANK,TANK)){
      G.effects.push({x:b.x,y:b.y,big:false,t:0});killPlayer();return false;
    }
    for(const o of G.bullets)if(o!==b&&o.team!==b.team&&overlap(b.x-4,b.y-4,8,8,o.x-4,o.y-4,8,8)){
      o.dead=true;G.effects.push({x:b.x,y:b.y,big:false,t:0});return false;}
  }
  return true;
}

/* ═══════════════ ОБНОВЛЕНИЕ ═══════════════ */
function update(){
  G.frame++;
  if(ED.warnT>0)ED.warnT--;
  if(ED.msg&&ED.msg.t>0)ED.msg.t--;
  if(G.state==='title'){G.titleAnim++;return;}
  if(G.state==='editor')return;
  if(G.state==='intro'){G.introT++;if(G.introT>140)G.state='playing';return;}
  if(G.state==='over'){G.overT++;G.effects.forEach(f=>f.t++);G.effects=G.effects.filter(f=>f.t<(f.big?26:12));
    if(G.overT>280){G.testMode?exitToEditor():toTitle();}return;}
  if(G.state==='tally'){updateTally();return;}
  if(G.paused)return;

  if(G.freezeT>0&&G.freezeT<9000)G.freezeT--;
  if(G.shovelT>0){G.shovelT--;
    if(G.shovelT===0)FORT.forEach(([c,r])=>{if(G.grid[r*GRID+c]===2)G.grid[r*GRID+c]=1;});}

  if(G.spawnT>0)G.spawnT--; else trySpawn();
  G.spawns.forEach(s=>s.t++);
  G.spawns=G.spawns.filter(s=>{if(s.t>=110){spawnEnemy(s);return false;}return true;});

  const p=G.player;
  if(p.alive){
    if(p.cool>0)p.cool--;
    if(p.shieldT>0)p.shieldT--;
    let d=inputDir(); if(d<0)d=touchDir();
    let moved=false;
    if(d>=0){
      turnTo(p,d);
      const nx=p.x+DX[d]*p.spd, ny=p.y+DY[d]*p.spd;
      if(canMove(p,nx,ny)){p.x=nx;p.y=ny;moved=true;p.slideV=p.spd;p.lastDir=d;}
      p.anim=(G.frame>>2)&1;
    } else if(onIce(p)&&p.slideV>.15){
      p.slideV*=.94;
      const nx=p.x+DX[p.lastDir]*p.slideV, ny=p.y+DY[p.lastDir]*p.slideV;
      if(canMove(p,nx,ny)){p.x=nx;p.y=ny;} else p.slideV=0;
      p.anim=(G.frame>>2)&1;
    }
    SND.setMove(moved&&!SND.muted);
    if(fireHeld())fire(p);
  } else {
    SND.setMove(false);
    if(p.respawnT>0){p.respawnT--;
      if(p.respawnT===0){p.x=129;p.y=385;p.dir=0;p.alive=true;p.star=0;p.shieldT=180;
        [[8,24],[9,24],[8,25],[9,25]].forEach(([c,r])=>{if(G.grid[r*GRID+c]===1||G.grid[r*GRID+c]===2)G.grid[r*GRID+c]=0;});}}
  }

  G.enemies.forEach(updateEnemy);
  G.bullets=G.bullets.filter(b=>!b.dead&&updateBullet(b));

  G.powers.forEach(pw=>pw.life--);
  G.powers=G.powers.filter(pw=>pw.life>0);
  if(p.alive)for(const pw of G.powers)if(overlap(pw.x,pw.y,32,32,p.x,p.y,TANK,TANK)){
    applyPower(pw);G.powers.splice(G.powers.indexOf(pw),1);break;}

  G.effects.forEach(f=>f.t++);
  G.effects=G.effects.filter(f=>f.t<(f.big?26:12));
  G.pops.forEach(pp=>pp.t++);
  G.pops=G.pops.filter(pp=>pp.t<45);

  if(G.overDelay>0){G.overDelay--;if(G.overDelay===0){G.state='over';G.overT=0;SND.setMove(false);sfx.over();}}

  /* Результат уходит на сервер по ходу игры, но не чаще лимита
   * сервера: очередь в submitScore сама разрулит частоту. */
  if(!G.testMode&&G.score!==G.scoreSentValue){G.scoreSentValue=G.score;submitScore();}

  if(!G.queue.length&&!G.spawns.length&&!G.enemies.length&&G.overDelay===0&&G.baseAlive){
    G.state='tally'; SND.setMove(false);
    G.tally={rows:[{t:'a',n:G.kills.a},{t:'b',n:G.kills.b},{t:'c',n:G.kills.c},{t:'d',n:G.kills.d}],
      shown:0,wait:40,done:0,fast:false};
  }
}
function updateTally(){
  const T=G.tally;
  if(T.shown<4){if(T.wait>0)T.wait-=(T.fast?4:1);else{T.shown++;T.wait=28;sfx.brick();}}
  else if(!G.testMode){T.done++;if(T.done>(T.fast?10:70)){
    G.level++;loadLevel(G.level);G.state='intro';G.introT=0;sfx.intro();}}
}

/* ═══════════════ РЕНДЕР ═══════════════ */
const _iconCache={};
function iconCache(type){
  if(!_iconCache[type])_iconCache[type]=POWER_ICON[type];
  return _iconCache[type];
}
function drawTerrain(){
  for(let r=0;r<GRID;r++)for(let c=0;c<GRID;c++){
    const v=G.grid[r*GRID+c];
    if(v===1)ctx.drawImage(TILE_BRICK,c*16,r*16);
    else if(v===2){
      const blink=G.shovelT>0&&G.shovelT<180&&(G.frame%16<8)&&FORT.some(f=>f[0]===c&&f[1]===r);
      ctx.drawImage(blink?TILE_BRICK:TILE_STEEL,c*16,r*16);
    }
    else if(v===3)ctx.drawImage(WATER[(G.frame>>5)&1],c*16,r*16);
    else if(v===5)ctx.drawImage(TILE_ICE,c*16,r*16);
  }
  ctx.drawImage(G.baseAlive?EAGLE_IMG:RUIN_IMG,192,384);
}
function drawForest(){
  for(let r=0;r<GRID;r++)for(let c=0;c<GRID;c++)
    if(G.grid[r*GRID+c]===4)ctx.drawImage(TILE_TREE,c*16,r*16);
}
function palFor(e){
  if(e.carrier&&(G.frame%16<8))return 'carrier';
  if(e.type==='d')return 'armor'+e.hp;
  return e.pal;
}
function drawTank(t,palKey){
  ctx.drawImage(SPR[palKey][t.dir][t.anim||0],Math.round(t.x)-1,Math.round(t.y)-1);
  if(G.freezeT>0&&G.freezeT<9000&&t.team==='e'&&(G.frame%10<5)){
    ctx.save();ctx.globalAlpha=.3;ctx.fillStyle='#bfefff';
    ctx.fillRect(t.x-1,t.y-1,32,32);ctx.restore();
  }
}
function drawShield(t){
  const col=(G.frame%6<3)?'#fff':'#41d6d0';
  ctx.save();ctx.strokeStyle=col;ctx.lineWidth=2;ctx.globalAlpha=.85;
  ctx.beginPath();ctx.arc(t.x+15,t.y+15,20,G.frame*.15,G.frame*.15+Math.PI*1.4);ctx.stroke();ctx.restore();
}
function drawSpawnFx(s){
  const r=[6,12,18,12][Math.floor(s.t/9)%4];
  ctx.save();ctx.translate(s.x+16,s.y+16);ctx.rotate(Math.PI/4);
  ctx.strokeStyle=(Math.floor(s.t/6)%2)?'#ffd23f':'#fff';ctx.lineWidth=2;
  ctx.strokeRect(-r,-r,r*2,r*2);ctx.restore();
}
function drawBoom(f){
  const P=f.big?[[8,'#fff'],[14,'#ffd23f'],[20,'#ff8c3f'],[26,'#e84b3f'],[22,'#7a2a1e']]
               :[[4,'#fff'],[8,'#ffd23f'],[10,'#ff8c3f']];
  const ph=Math.min(P.length-1,Math.floor(f.t/(f.big?5:4)));
  const [r,col]=P[ph];
  ctx.save();ctx.translate(f.x,f.y);ctx.fillStyle=col;ctx.beginPath();
  for(let i=0;i<16;i++){const rad=i%2?r*.5:r,a=i/16*Math.PI*2;
    ctx.lineTo(Math.cos(a)*rad,Math.sin(a)*rad);}
  ctx.closePath();ctx.fill();ctx.restore();
}
function pxText(txt,x,y,size,color,align='center',shadow=true){
  ctx.font=size+'px "Press Start 2P","Rubik Mono One",monospace';
  ctx.textAlign=align;ctx.textBaseline='middle';
  if(shadow){ctx.fillStyle='#000';ctx.fillText(txt,x+2,y+2);}
  ctx.fillStyle=color;ctx.fillText(txt,x,y);
}
function dim(a=.55){ctx.fillStyle=`rgba(0,0,0,${a})`;ctx.fillRect(0,0,FIELD,FIELD);}

function render(){
  ctx.fillStyle='#000';ctx.fillRect(0,0,FIELD,FIELD);

  if(G.state==='title'){renderTitle();return;}
  if(G.state==='editor'){renderEditor();return;}

  drawTerrain();
  G.powers.forEach(pw=>{ if(G.frame%12<8||pw.life<180&&G.frame%6<3){
    ctx.fillStyle='#c6281f';ctx.fillRect(pw.x,pw.y,32,32);
    ctx.drawImage(iconCache(pw.type),pw.x+2,pw.y+2,28,28);}});
  G.spawns.forEach(drawSpawnFx);
  G.enemies.forEach(e=>{drawTank(e,palFor(e));});
  if(G.player&&G.player.alive){drawTank(G.player,'player');if(G.player.shieldT>0)drawShield(G.player);}
  drawForest();
  G.bullets.forEach(b=>{ctx.fillStyle='#111';ctx.fillRect(b.x-4,b.y-4,8,8);
    ctx.fillStyle='#fff';ctx.fillRect(b.x-2,b.y-2,4,4);});
  G.effects.forEach(drawBoom);
  G.pops.forEach(pp=>{ctx.save();ctx.globalAlpha=1-pp.t/45;
    pxText(pp.txt,pp.x,pp.y-pp.t*.6,8,'#ffd23f');ctx.restore();});

  if(G.testMode&&G.state==='playing'&&G.frame%120<80){
    ctx.save();ctx.globalAlpha=.75;
    pxText('ТЕСТ КАРТЫ · [E] — В РЕДАКТОР',208,10,7,'#41d6d0');ctx.restore();
  }
  if(G.state==='intro')renderIntro();
  if(G.state==='tally')renderTally();
  if(G.state==='over')renderOver();
  if(G.paused){dim(.6);pxText('ПАУЗА',208,196,20,'#ffd23f');
    if(G.frame%60<35)pxText('НАЖМИТЕ [P]',208,232,8,'#8b90a8');}
}
function renderTitle(){
  const f=G.titleAnim;
  ctx.save();ctx.translate(0,Math.sin(f*.03)*3);
  pxText('ТАНЧИКИ',208,112,34,'#ffd23f');
  ctx.restore();
  pxText('BATTLE CITY',208,152,12,'#41d6d0');
  pxText('· DENDY ·',208,178,8,'#8b90a8');
  const items=['НАЧАТЬ ИГРУ','РЕДАКТОР КАРТ'];
  items.forEach((txt,i)=>{
    const y=246+i*30, sel=G.menuIndex===i;
    if(sel)ctx.drawImage(SPR.player[1][(f>>3)&1],96,y-16);
    pxText(txt,224,y,10,sel?'#ffd23f':'#8b90a8','left');
  });
  if(f%60<40)pxText('▲▼ ВЫБОР · ENTER ОК',208,312,7,'#5d6480');
  pxText('РЕКОРД '+String(G.hi).padStart(6,'0'),208,346,8,'#ffd23f');
  pxText('15 УРОВНЕЙ + СВОИ КАРТЫ',208,384,7,'#5d6480');
}
function renderEditor(){
  ctx.fillStyle='#000';ctx.fillRect(0,0,FIELD,FIELD);
  for(let r=0;r<13;r++)for(let c=0;c<13;c++){
    const v=ED.map[r][c];
    if(v!=='.'&&TILE_IMG[v]){
      ctx.drawImage(v==='W'?WATER[(G.frame>>5)&1]:TILE_IMG[v],c*32,r*32);
      ctx.drawImage(v==='W'?WATER[(G.frame>>5)&1]:TILE_IMG[v],c*32+16,r*32);
      ctx.drawImage(v==='W'?WATER[(G.frame>>5)&1]:TILE_IMG[v],c*32,r*32+16);
      ctx.drawImage(v==='W'?WATER[(G.frame>>5)&1]:TILE_IMG[v],c*32+16,r*32+16);
    }
  }
  ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=1;
  for(let i=0;i<=13;i++){
    ctx.beginPath();ctx.moveTo(i*32+.5,0);ctx.lineTo(i*32+.5,FIELD);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,i*32+.5);ctx.lineTo(FIELD,i*32+.5);ctx.stroke();
  }
  FORT.forEach(([c,r])=>ctx.drawImage(TILE_BRICK,c*16,r*16));
  ctx.drawImage(EAGLE_IMG,192,384);
  if(G.frame%30<20){
    [[16,16],[208,16],[400,16]].forEach(([x,y])=>{
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);
      ctx.strokeStyle='#ffd23f';ctx.lineWidth=2;ctx.strokeRect(-7,-7,14,14);ctx.restore();
    });
  }
  ctx.drawImage(SPR.player[0][0],128,384);
  if(ED.hover){
    const {c,r}=ED.hover, res=RESERVED.has(c+','+r);
    ctx.strokeStyle=res?'#ef4b3f':'#ffd23f';ctx.lineWidth=2;
    ctx.strokeRect(c*32+1,r*32+1,30,30);
  }
  if(ED.msg&&ED.msg.t>0){
    ctx.save();ctx.globalAlpha=Math.min(1,ED.msg.t/25);
    pxText(ED.msg.txt,208,208,9,'#ffd23f');ctx.restore();
  }
}
function renderIntro(){
  dim(1);
  pxText(G.testMode?'ТЕСТ КАРТЫ':'УРОВЕНЬ '+G.level,208,196,18,'#e9e7dc');
  ctx.drawImage(SPR.player[0][(G.frame>>3)&1],150,224);
  pxText('VS',208,240,8,'#ef4b3f');
  ctx.drawImage(SPR.basic[2][(G.frame>>3)&1],234,224);
}
function renderTally(){
  dim(.85);
  pxText(G.testMode?'ТЕСТ ПРОЙДЕН!':'УРОВЕНЬ ПРОЙДЕН!',208,70,12,'#67c04c');
  const T=G.tally,names={a:'ОБЫЧНЫЙ',b:'БЫСТРЫЙ',c:'МОЩНЫЙ',d:'БРОНЯ'};
  for(let i=0;i<T.shown;i++){
    const row=T.rows[i],y=130+i*44;
    ctx.drawImage(TALLY_SPRITES[row.t],110,y-8);
    pxText(`${row.n}×`,170,y,9,'#e9e7dc','left');
    pxText(names[row.t],232,y,8,'#8b90a8','left');
    pxText(String(row.n*ETYPES[row.t].pts).padStart(5,'0'),330,y,9,'#ffd23f','right');
  }
  if(T.shown>=4){
    const hint=G.testMode?'ENTER — ЕЩЁ РАЗ · [E] — В РЕДАКТОР':'ДАЛЬШЕ...';
    if(G.frame%60<40)pxText(hint,208,340,8,'#41d6d0');
  }
}
function renderOver(){
  const y=clamp(FIELD-G.overT*1.6,208,FIELD);
  pxText('GAME OVER',208,y,24,'#ef4b3f');
  if(G.overT>120){
    if(G.overReason)pxText(G.overReason,208,250,9,'#ffd23f');
    pxText('СЧЁТ: '+G.score,208,280,9,'#e9e7dc');
    if(G.overT>160&&G.frame%60<35)
      pxText(G.testMode?'[E] — В РЕДАКТОР':'ENTER — В МЕНЮ',208,314,8,'#8b90a8');
  }
}

/* ═══════════════ ЦИКЛ ═══════════════ */
let last=0,acc=0;
function loop(ts){
  requestAnimationFrame(loop);
  if(!last)last=ts;
  acc+=Math.min(100,ts-last); last=ts;
  while(acc>=1000/60){update();acc-=1000/60;}
  render();
}
requestAnimationFrame(loop);

/* ═══════════════ ДЕКОР ═══════════════ */
document.querySelector('.drift.t1').appendChild(iconCanvas(makeSprite(TANK_A,PALS.basic,4)));
document.querySelector('.drift.t2').appendChild(iconCanvas(makeSprite(TANK_A,PALS.armor4,4)));
document.getElementById('logoTank').appendChild(iconCanvas(makeSprite(TANK_A,PALS.player,3)));

const BONUSES=[
  ['star','Звезда','Улучшает танк: быстрые снаряды, двойной выстрел, пробивает сталь'],
  ['helmet','Каска','Временная неуязвимость — танк мигает кольцом'],
  ['shovel','Лопата','База укрепляется стальными блоками на 15 секунд'],
  ['tank','Танк','Дополнительная жизнь'],
  ['grenade','Граната','Взрывает все вражеские танки на экране'],
  ['timer','Часы','Замораживают противников — время для контратаки']
];
const bg=document.getElementById('bonusGrid');
BONUSES.forEach(([k,n,d])=>{
  const div=document.createElement('div');div.className='bonus-item';
  const ic=iconCanvas(POWER_ICON[k]); ic.className='bonus-icon'; ic.alt='';
  div.appendChild(ic);
  const tx=document.createElement('div');tx.innerHTML=`<b>${n}</b><span>${d}</span>`;
  div.appendChild(tx);
  bg.appendChild(div);
});
/* Спрайты для таблицы очков готовятся один раз */
const TALLY_SPRITES={};
for(const t of ['a','b','c','d'])TALLY_SPRITES[t]=makeSprite(TANK_A,PALS[t==='d'?'armor4':ETYPES[t].pal],1);

/* Онлайн-таблица рекордов панели: оффлайн молчит, онлайн отправляет */
const API='/panel-api/game/scores';
function escapeHtml(s){return String(s).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);}
function scoresMsg(txt){ const list=document.getElementById('scores-list'); if(list) list.innerHTML='<li class="empty">'+txt+'</li>'; }
async function loadScores(){
  try{
    const res=await fetch(API+'?limit=10');
    if(!res.ok){ scoresMsg('Рекорды недоступны ('+res.status+')'); return; }
    const data=await res.json();
    const list=document.getElementById('scores-list');
    if(!list)return;
    if(!data.scores||data.scores.length===0){scoresMsg('Таблица рекордов пуста — будьте первым!');return;}
    list.innerHTML=data.scores.map((s,i)=>
      `<li><span class="pos">${i+1}.</span>`+
      `<span class="nick">${escapeHtml(s.nickname)}</span>`+
      `<span class="sc">${s.score}</span></li>`).join('');
  }catch(e){ scoresMsg('Рекорды загружаются после старта панели'); }
}
/* Сервер принимает не чаще одного результата в 30 секунд (защита от
 * спама), поэтому клиент шлёт не быстрее: последний известный счёт
 * уходит сам, когда подходит очередь. Промежуточные значения не нужны
 * никому — в таблице одно число на игрока. */
const SUBMIT_INTERVAL=31*1000;
let submitInFlight=false, submitQueued=false, lastSubmitAt=0;

async function submitScore(){
  if(G.score<100)return;
  if(submitInFlight){ submitQueued=true; return; }
  const wait=lastSubmitAt+SUBMIT_INTERVAL-Date.now();
  if(wait>0){ submitQueued=true; setTimeout(submitScore, wait+50); return; }
  submitInFlight=true;
  try{
    let nick=lsGet('tanki.nick');
    if(!nick){nick='Танкист-'+randInt(100,999);lsSet('tanki.nick',nick);}
    const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nickname:nick,score:G.score,level:G.level})});
    if(res.ok){ lastSubmitAt=Date.now(); loadScores(); }
    else if(res.status===429){ /* лимит: повторит следующий в очереди */ lastSubmitAt=Date.now(); submitQueued=true; }
    else scoresMsg('Не удалось записать результат ('+res.status+')');
  }catch(e){ scoresMsg('Рекорды появятся после старта панели'); }
  finally{
    submitInFlight=false;
    if(submitQueued){ submitQueued=false; submitScore(); }
  }
}

/* Таблица рекордов загружается сразу при открытии страницы.
 * Раньше она заполнялась только после отправки своего результата:
 * пока игрок не проиграл, раздел висел с надписью «Загрузка…». */
if (document.getElementById('scores-list')) loadScores();

const TIPS=[
  'Каждый 4-й, 11-й и 18-й вражеский танк везёт бонус — он мигает красным.',
  'Три звезды — и твои снаряды пробивают даже сталь.',
  'Лопата укрепит базу сталью, но только на время.',
  'Осторожно: собственный снаряд тоже может уничтожить базу!',
  'Граната взрывает всех врагов на экране — береги её на чёрный день.',
  'Часы замораживают противника. Самое время для контратаки!',
  'На льду танки скользят — тормози заранее.',
  'В редакторе карт: кнопка ЭКСПОРТ даёт код, которым можно поделиться с другом!'
];
const tipEl=document.getElementById('tip'); let tipIdx=1;
function showTip(){tipEl.classList.add('fade');
  setTimeout(()=>{tipEl.textContent=TIPS[tipIdx++%TIPS.length];tipEl.classList.remove('fade');},500);}
tipEl.textContent=TIPS[0];setInterval(showTip,7000);
