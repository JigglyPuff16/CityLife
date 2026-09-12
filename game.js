import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const canvas = document.querySelector('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x82b5bd);
scene.fog = new THREE.FogExp2(0x8dbfc3, 0.0015);

const camera = new THREE.PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.1, 1100);
const clock = new THREE.Clock();
const mapCanvas = document.querySelector('#map-canvas');
const mapContext = mapCanvas.getContext('2d');

const ui = {
  money: document.querySelector('#money'), healthBar: document.querySelector('#health-bar'), healthText: document.querySelector('#health-text'),
  heatStars: [...document.querySelectorAll('#heat-stars i')], heatText: document.querySelector('#heat-text'),
  title: document.querySelector('#mission-title'), description: document.querySelector('#mission-description'), objective: document.querySelector('#objective-text'), distance: document.querySelector('#objective-distance'), progress: document.querySelector('#mission-progress'), missionCount: document.querySelector('#mission-count'),
  weaponName: document.querySelector('#weapon-name'), weaponMode: document.querySelector('#weapon-mode'), ammoCurrent: document.querySelector('#ammo-current'), ammoReserve: document.querySelector('#ammo-reserve'),
  vehiclePanel: document.querySelector('#vehicle-panel'), vehicleName: document.querySelector('#vehicle-name'), vehicleClass: document.querySelector('#vehicle-class'), vehicleSymbol: document.querySelector('#vehicle-symbol'),
  prompt: document.querySelector('#interaction-prompt'), promptText: document.querySelector('#interaction-text'),
  bossCard: document.querySelector('#boss-card'), bossHealth: document.querySelector('#boss-health'), bossHealthText: document.querySelector('#boss-health-text'),
  district: document.querySelector('#district-name'), zone: document.querySelector('#map-zone'), message: document.querySelector('#message-stack')
};

const WORLD = 470;
const colors = {
  asphalt: 0x293b42, grass: 0x4a8668, grassAlt: 0x5a9470, water: 0x1b6a79,
  cyan: 0x64e0e2, yellow: 0xf4c64e, red: 0xff625c, white: 0xe5f5f1,
  dark: 0x172a33, roof: 0x17333c, concrete: 0x66818a
};
const state = {
  started: false, money: 2450, health: 100, heat: 0, level: 4, heading: 0.1, vehicle: null,
  weapon: 0, ammo: [12, 30], reserve: [96, 180], reloading: false, missionIndex: 0,
  keys: {}, bullets: [], particles: [], time: 0, currentInteract: null, bossActive: false,
  lastShot: 0, lastDamage: 0, bossLastShot: 0, cameraKick: 0, mapDirty: 0
};

const weapons = [
  { name: 'VOLT PISTOL', mode: 'SEMI-AUTO', damage: 18, speed: 78, fireRate: .28, spread: .025, color: 0xf6d45b, magazine: 12 },
  { name: 'KITE SMG', mode: 'BURST / FULL', damage: 9, speed: 88, fireRate: .095, spread: .07, color: 0x65e6df, magazine: 30 }
];

const missions = [
  {
    title: 'THE DOCKS ARE WAITING', description: 'Reach the Crimson Docks and bring down the harbor boss, Viper Kane.',
    objective: 'Go to Crimson Docks', pos: new THREE.Vector3(-150, 0, 132), kind: 'boss', progress: 22
  },
  {
    title: 'A HOUSE WITH TEETH', description: 'Break into the marked villa. Grab the ledger before the crew arrives.',
    objective: 'Raid the Sunset Villa', pos: new THREE.Vector3(116, 0, -116), kind: 'raid', progress: 53
  },
  {
    title: 'BLUE SKY GETAWAY', description: 'Take an aircraft from the airfield and fly the package past the coastal beacon.',
    objective: 'Secure an aircraft', pos: new THREE.Vector3(136, 0, 98), kind: 'air', progress: 79
  }
];

const vehicles = [];
const raids = [];
const enemies = [];
const dynamicObjects = [];
const raycaster = new THREE.Raycaster();

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? .78, metalness: options.metalness ?? .05, emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 0 });
}
const mats = {
  grass: material(colors.grass), grassAlt: material(colors.grassAlt), road: material(colors.asphalt, { roughness: .92 }),
  pavement: material(0x78969b), marking: material(0xe4ce8c, { roughness: .5 }), water: material(colors.water, { roughness: .12, metalness: .24 }),
  concrete: material(colors.concrete), roof: material(colors.roof), window: material(0x296471, { metalness: .2, emissive: 0x0b2c36, emissiveIntensity: .28 }),
  yellow: material(colors.yellow, { emissive: 0x7b4d00, emissiveIntensity: .3 }), cyan: material(colors.cyan, { emissive: 0x126a70, emissiveIntensity: .42 }),
  red: material(colors.red, { emissive: 0x7b100e, emissiveIntensity: .32 }), dark: material(colors.dark), white: material(colors.white)
};

function add(mesh, x = 0, y = 0, z = 0) { mesh.position.set(x, y, z); scene.add(mesh); return mesh; }
function box(w, h, d, mat, x, y, z, cast = true) { const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z); m.castShadow = cast; m.receiveShadow = true; return m; }
function cylinder(r1, r2, h, mat, x, y, z, sides = 8) { const m = add(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, sides), mat), x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }

function makeGround() {
  box(WORLD * 2, 1.2, WORLD * 2, mats.grass, 0, -.65, 0, false);
  // Waterfront and island boundary
  const water = box(160, .25, WORLD * 2, mats.water, -235, -.05, 0, false);
  water.receiveShadow = true;
  const river = box(42, .2, 280, mats.water, 24, -.02, -290, false);
  river.receiveShadow = true;
  // Main road network
  [-120, 0, 120].forEach(x => {
    box(24, .12, 410, mats.road, x, .03, 10, false);
    for (let z = -175; z <= 190; z += 26) box(1, .04, 10, mats.marking, x, .11, z, false);
  });
  [-120, 0, 120].forEach(z => {
    box(420, .12, 24, mats.road, 0, .03, z, false);
    for (let x = -185; x <= 190; x += 26) box(10, .04, 1, mats.marking, x, .11, z, false);
  });
  // Coastal highway and airstrip
  box(22, .12, 425, mats.road, -161, .03, 8, false);
  box(70, .13, 150, mats.road, 154, .03, 150, false);
  for (let z = 91; z <= 211; z += 22) box(3, .04, 11, mats.marking, 154, .11, z, false);
  // Sidewalks
  [-120, 0, 120].forEach(x => { box(5, .09, 410, mats.pavement, x - 14.5, .04, 10, false); box(5, .09, 410, mats.pavement, x + 14.5, .04, 10, false); });
  [-120, 0, 120].forEach(z => { box(420, .09, 5, mats.pavement, 0, .04, z - 14.5, false); box(420, .09, 5, mats.pavement, 0, .04, z + 14.5, false); });
}

function makeBuilding(x, z, w, d, h, color, label = '') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, { roughness: .86 }));
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 1.6, d + 1.5), mats.roof);
  roof.position.y = h + .5; roof.castShadow = true; g.add(roof);
  const windowRows = Math.max(1, Math.floor(h / 12));
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < Math.max(1, Math.floor(w / 7)); col++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.5, .16), mats.window);
      win.position.set(-w / 2 + 4 + col * 6.5, 6 + row * 9.5, d / 2 + .11); g.add(win);
    }
  }
  if (label) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w - 3, 15), 2.5, .35), mats.yellow);
    sign.position.set(0, Math.min(8, h * .55), d / 2 + .35); g.add(sign);
  }
  g.position.set(x, 0, z); scene.add(g); return g;
}

function makeCity() {
  const buildingSpecs = [
    [-70,-70,29,31,39,0x5d737b],[-47,-76,22,25,28,0x777f72],[-75,-23,27,32,53,0x587881],[-42,-26,25,27,31,0x9b806e],
    [-74,45,29,27,25,0x6a897e],[-41,51,24,33,44,0x57717c],[-78,96,27,29,55,0x71787b],[-43,100,26,25,31,0x937765],
    [42,-75,29,34,56,0x747e84],[78,-75,31,25,36,0x5e7c7c],[42,-29,29,28,27,0x9e806b],[79,-27,32,29,62,0x5d7781],
    [40,48,28,33,41,0x8d8171],[78,46,31,33,29,0x657c72],[41,95,28,27,69,0x5b727c],[79,96,31,25,48,0x927661],
    [138,-75,31,30,42,0x68817f],[180,-75,31,30,28,0x81796d],[138,-29,30,27,37,0x6b8589],[180,-29,29,30,53,0x7d6c68],
    [138,41,28,26,25,0x758773],[180,43,30,30,39,0x617a83]
  ];
  buildingSpecs.forEach(s => makeBuilding(...s));
  // Small villas around the map
  makeVilla(112, -116, 'SUNSET VILLA', 900);
  makeVilla(-125, -112, 'HARBOR HOUSE', 650);
  makeVilla(95, 118, 'COASTAL HOME', 740);
  makeVilla(-85, 139, 'RAIDABLE HOME', 560);
  // Docks
  for (let z = 72; z < 180; z += 33) { box(77, .5, 19, material(0x876c4e), -185, .12, z, false); box(2, 4, 2, mats.dark, -220, 2, z, false); box(2,4,2,mats.dark,-150,2,z,false); }
  for (let x = -211; x <= -160; x += 17) for (let z = 90; z <= 155; z += 30) box(11, 8, 7, material(0x9b6242), x, 4, z);
  box(52, 17, 31, material(0x536d72), -123, 8.5, 133); box(37, 2, 4, mats.red, -123, 13, 149);
  // Airfield hangar
  box(54, 19, 36, material(0x536f74), 205, 9.5, 158); box(56, 3, 3, mats.yellow, 205, 11, 177); box(12, .4, 12, mats.concrete, 139, .24, 84);
  // Trees and lamps scattered deterministically
  const treePositions = [[-102,-165],[-83,-165],[-59,-154],[-25,-163],[25,-158],[55,-160],[104,-164],[174,-160],[-185,-160],[-185,-93],[-183,-30],[-186,33],[-185,202],[-108,175],[-55,176],[17,175],[88,177],[108,141],[108,79],[105,17],[105,-165],[180,105],[205,61],[205,15]];
  treePositions.forEach(([x,z], i) => makeTree(x,z, 1 + (i % 3) * .16));
  [[-134,-120],[-134,0],[-134,120],[-14,-120],[-14,0],[-14,120],[106,-120],[106,0],[106,120],[-118,-135],[0,-135],[120,-135],[-118,-15],[0,-15],[120,-15],[-118,105],[0,105],[120,105]].forEach(([x,z]) => makeLamp(x,z));
}

function makeTree(x, z, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.8,.95,5 * scale,6), material(0x594635)); trunk.position.y = 2.5 * scale; trunk.castShadow = true; g.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(4.4 * scale,1), material(0x3d7055)); crown.position.y = 7.1 * scale; crown.castShadow = true; g.add(crown); g.position.set(x,0,z); scene.add(g);
}
function makeLamp(x,z) {
  const pole = cylinder(.17,.22,8,mats.dark,x,4,z,6); const glow = new THREE.PointLight(0xa4ebde, .55, 16, 2); glow.position.set(x,7.7,z); scene.add(glow); const head = box(.9,.3,.9,mats.cyan,x,7.7,z);
  pole.userData.decor = head;
}

function makePlayer() {
  const group = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(.48,.56,1.8,8), material(0x16252f)); legs.position.y = .9; legs.castShadow = true; group.add(legs);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.72,.62,1.7,8), material(0x5b88a1)); body.position.y = 2.45; body.castShadow = true; group.add(body);
  const jacket = new THREE.Mesh(new THREE.BoxGeometry(1.43,.22,.9), mats.cyan); jacket.position.set(0,2.65,.42); group.add(jacket);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.53,12,10), material(0xdba277)); head.position.y = 3.75; head.castShadow = true; group.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.56,.56,.18,12), material(0x16252f)); cap.position.y = 4.1; group.add(cap);
  group.position.set(-21,0,-12); group.rotation.y = state.heading; scene.add(group); return group;
}
const player = makePlayer();

function vehicleColor(type) {
  return ({ car:0x39bcd2, bike:0xf4c64e, suv:0x5f7796, truck:0xd16947, bus:0xe0a94d, boat:0x51b7c7, plane:0xd7e5e1, heli:0x7b92a7 })[type] || 0x64e0e2;
}
function vehicleMeta(type) {
  return ({car:['METRO COUPE','Street car','▱',20],bike:['STRIKE BIKE','Motorcycle','⌁',23],suv:['ARMORED SUV','All-terrain','▣',18],truck:['FREIGHT TRUCK','Heavy hauler','▰',15],bus:['CITY TRANSIT','Passenger bus','▰',14],boat:['NEON RUNNER','Speed boat','◒',24],plane:['SKYLINE JET','Fixed-wing aircraft','△',31],heli:['HELIOS 8','Rotorcraft','✣',28]})[type];
}
function makeVehicle(type, x, z, rotation = 0) {
  const group = new THREE.Group(); const color = material(vehicleColor(type), { metalness: .2, roughness: .38 }); const dark = material(0x172d36, { metalness:.35, roughness:.2 });
  const addPart = (w,h,d,mat,px,py,pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(px,py,pz);m.castShadow=true;m.receiveShadow=true;group.add(m);return m; };
  if (type === 'bike') {
    const frame = addPart(.7,.45,2.35,color,0,1.0,0); addPart(.58,.36,.9,dark,0,1.38,-.35); addPart(.55,.14,.67,material(0x1d2528),0,1.38,.64);
    [-.0].forEach(() => {}); [-.86,.86].forEach(zp => { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.48,.48,.2,12),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(0,.48,zp);wheel.castShadow=true;group.add(wheel); });
  } else if (type === 'boat') {
    addPart(3.7,.75,7.0,color,0,.85,0); addPart(2.7,.55,3.0,dark,0,1.47,-.3); addPart(2.3,.25,2.1,mats.cyan,0,1.7,-.4); addPart(.18,1.5,.18,mats.dark,0,2.4,2.2);
  } else if (type === 'plane') {
    addPart(2.2,.75,7.5,color,0,1.15,0); addPart(12,.22,1.5,color,0,1.12,0); addPart(3.2,.18,.75,color,0,2.1,2.35); addPart(.22,2.3,.8,color,0,2.2,2.73); addPart(1.7,.65,1.9,dark,0,1.7,-2.35);
    [-.8,.8].forEach(px => { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.14,10),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(px,.46,1.1);group.add(wheel); });
  } else if (type === 'heli') {
    addPart(2.3,1.5,4.4,color,0,1.9,0); addPart(.65,.58,4.4,color,0,2.1,3.6); addPart(6.8,.12,.25,dark,0,4.15,0); addPart(.25,.1,6.8,dark,0,4.15,0); addPart(.8,.1,4.3,dark,0,.6,0);
  } else {
    const settings = type === 'bus' ? [3.2,2.0,7.6] : type === 'truck' ? [2.8,1.8,6.6] : type === 'suv' ? [2.45,1.35,4.75] : [2.15,1.15,4.1];
    const [w,h,d] = settings; addPart(w,h,d,color,0,1.02,0); addPart(w*.83,h*.65,d*.48,dark,0,1.82,-.43);
    if (type === 'truck') addPart(w*.95,1.8,d*.43,material(0xddd1b2),0,2.0,1.75);
    if (type === 'bus') { for(let i=-2;i<=2;i++) addPart(w*.88,.55,.52,mats.window,0,1.95,i*1.05); }
    [-w*.52,w*.52].forEach(px=>[-d*.29,d*.29].forEach(pz=>{ const wh=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.25,12),dark);wh.rotation.z=Math.PI/2;wh.position.set(px,.46,pz);wh.castShadow=true;group.add(wh); }));
    addPart(.2,.23,.35,mats.yellow,-w*.32,.9,-d*.52);addPart(.2,.23,.35,mats.yellow,w*.32,.9,-d*.52);
  }
  group.position.set(x, type === 'boat' ? .4 : 0, z); group.rotation.y = rotation; scene.add(group);
  const [name, desc, symbol, speed] = vehicleMeta(type);
  const vehicle = { group, type, name, desc, symbol, speed, airborne: false, occupied: false, markerColor: vehicleColor(type) };
  group.userData.vehicle = vehicle; vehicles.push(vehicle); return vehicle;
}

function makeFleet() {
  makeVehicle('car', -30, 17, -.5); makeVehicle('bike', 17, -22, .8); makeVehicle('suv', -137, -51, 0); makeVehicle('truck', 91, -18, Math.PI/2); makeVehicle('bus', 4, 73, 0); makeVehicle('boat', -219, 102, Math.PI); makeVehicle('plane', 153, 121, 0); makeVehicle('heli', 139, 85, .3);
}

function makeRaidBeacon(pos, label, cash) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6,.12,8,26), mats.red); ring.rotation.x = Math.PI/2; ring.position.y=.2; group.add(ring);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.07,.32,7,8,1,true), material(colors.red,{emissive:0x8c0f0c,emissiveIntensity:.7})); pillar.position.y=3.5; group.add(pillar);
  const light = new THREE.PointLight(colors.red, 2.1, 18, 2); light.position.y=5;group.add(light);group.position.copy(pos);scene.add(group);
  const raid = { pos, label, cash, group, raided:false, kind:'raid' }; raids.push(raid);return raid;
}
function makeVilla(x,z,label,cash) { makeBuilding(x,z,31,27,10,0xb88f73,label); return makeRaidBeacon(new THREE.Vector3(x,0,z+18),label,cash); }

function makeBoss() {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.1,.92,2.4,8), material(0x832d37));torso.position.y=2.1;torso.castShadow=true;group.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(2.1,.25,1.1),mats.red);chest.position.set(0,2.45,.5);group.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.75,10,10),material(0xc9926d));head.position.y=3.75;head.castShadow=true;group.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.85,.85,.22,10),mats.dark);hat.position.y=4.35;group.add(hat);
  const beacon = new THREE.PointLight(colors.red,2,28,2);beacon.position.y=4;group.add(beacon);group.position.set(-150,0,132);scene.add(group);
  const boss = { group, pos:group.position, health:100, maxHealth:100, alive:true, isBoss:true, velocity:new THREE.Vector3() }; enemies.push(boss); return boss;
}
const boss = makeBoss();

function makeEnemy(x,z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.6,.55,1.8,7),material(0x344e60));body.position.y=1.8;body.castShadow=true;group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.42,8,8),material(0xbd8666));head.position.y=3.1;group.add(head);group.position.set(x,0,z);scene.add(group);
  enemies.push({group,pos:group.position,health:35,maxHealth:35,alive:true,velocity:new THREE.Vector3()});
}
makeEnemy(-135,105);makeEnemy(-169,154);makeEnemy(100,-95);makeEnemy(129,-112);

function makeBeacon(pos, color, tall = 9) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1,.11,8,24),material(color,{emissive:color,emissiveIntensity:.25}));ring.rotation.x=Math.PI/2;ring.position.y=.15;group.add(ring);
  const beamMat = new THREE.MeshBasicMaterial({color,transparent:true,opacity:.25,side:THREE.DoubleSide,depthWrite:false});const beam=new THREE.Mesh(new THREE.CylinderGeometry(.14,1.1,tall,10,1,true),beamMat);beam.position.y=tall/2;group.add(beam); group.position.copy(pos);scene.add(group);return group;
}
const missionBeacons = missions.map(m => makeBeacon(m.pos, m.kind === 'boss' ? colors.red : colors.yellow, 10));

function makeLighting() {
  const hemi = new THREE.HemisphereLight(0xb9edf0,0x25463e,2.2);scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffefc4,3.1);sun.position.set(-110,220,95);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-300;sun.shadow.camera.right=300;sun.shadow.camera.top=300;sun.shadow.camera.bottom=-300;scene.add(sun);
  const moon = new THREE.DirectionalLight(0x5cd0e1,.4);moon.position.set(160,80,-200);scene.add(moon);
}
makeGround(); makeCity(); makeFleet(); makeLighting();

function distanceTo(pos) { return player.position.distanceTo(pos); }
function currentMission() { return missions[state.missionIndex]; }
function formatMoney(value) { return '$' + Math.floor(value).toLocaleString('en-US'); }
function updateHUD() {
  ui.money.textContent = formatMoney(state.money); ui.healthBar.style.width = `${state.health}%`;ui.healthText.textContent = Math.ceil(state.health);
  ui.heatStars.forEach((star,i) => star.classList.toggle('active',i<state.heat));ui.heatText.textContent = state.heat ? 'WANTED' : 'COLD';
  const m=currentMission();ui.title.textContent=m.title;ui.description.textContent=m.description;ui.objective.textContent=m.objective;ui.missionCount.textContent=`${String(state.missionIndex+1).padStart(2,'0')} / 03`;ui.progress.style.width=`${m.progress}%`;
  const ammo=state.ammo[state.weapon];ui.weaponName.textContent=weapons[state.weapon].name;ui.weaponMode.textContent=state.reloading?'RELOADING…':weapons[state.weapon].mode;ui.ammoCurrent.textContent=ammo;ui.ammoReserve.textContent=state.reserve[state.weapon];
  const d=distanceTo(m.pos);ui.distance.textContent = d>999 ? `${(d/1000).toFixed(1)}km` : `${Math.floor(d)}m`;
  const inBossRange=boss.alive&&distanceTo(boss.pos)<52;ui.bossCard.classList.toggle('visible',inBossRange);ui.bossHealth.style.width=`${Math.max(0,boss.health)}%`;ui.bossHealthText.textContent=`${Math.max(0,Math.ceil(boss.health))}%`;
  if(state.vehicle){ui.vehiclePanel.classList.add('visible');ui.vehicleName.textContent=state.vehicle.name;ui.vehicleClass.textContent=state.vehicle.desc;ui.vehicleSymbol.textContent=state.vehicle.symbol;} else {ui.vehiclePanel.classList.remove('visible');}
}

function toast(message, type = '') { const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;ui.message.append(el);setTimeout(()=>el.remove(),3000); }
function flash() { const f=document.querySelector('#flash');f.style.opacity='.26';setTimeout(()=>f.style.opacity='0',70); }
function setHeat(amount) { state.heat=Math.max(0,Math.min(5,amount)); }

function nearestInteraction() {
  const pos=player.position; let nearest=null;let min=9.5;
  if(state.vehicle){return {type:'exit',dist:0,text:'EXIT '+state.vehicle.name};}
  vehicles.forEach(v=>{ if(!v.occupied){const d=pos.distanceTo(v.group.position);if(d<min){min=d;nearest={type:'vehicle',data:v,dist:d,text:'ENTER '+v.name};}} });
  raids.forEach(r=>{ if(!r.raided){const d=pos.distanceTo(r.pos);if(d<min){min=d;nearest={type:'raid',data:r,dist:d,text:'RAID '+r.label};}} });
  const m=currentMission();if(m.kind==='boss'&&boss.alive&&distanceTo(m.pos)<12){ nearest={type:'boss',data:boss,dist:distanceTo(m.pos),text:'ENGAGE VIPER KANE'}; }
  return nearest;
}
function updateInteraction() { state.currentInteract=nearestInteraction();if(state.currentInteract){ui.prompt.classList.add('visible');ui.promptText.textContent=state.currentInteract.text;}else ui.prompt.classList.remove('visible'); }

function enterVehicle(vehicle) {
  state.vehicle=vehicle;vehicle.occupied=true;player.visible=false;toast(`VEHICLE ACQUIRED — ${vehicle.name}`,'money');
  if(vehicle.type==='plane'||vehicle.type==='heli')toast('Use SHIFT to rise. Take to the skies.');
}
function exitVehicle() {
  const v=state.vehicle;if(!v)return;player.position.copy(v.group.position);player.position.y=0;player.position.add(new THREE.Vector3(3,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),v.group.rotation.y));player.visible=true;v.occupied=false;state.vehicle=null;toast('ON FOOT');
}
function performRaid(raid) {
  if(raid.raided)return;raid.raided=true;raid.group.visible=false;state.money+=raid.cash;setHeat(Math.max(state.heat,3));toast(`RAID COMPLETE +${formatMoney(raid.cash)}`,'money');toast('CIVIC RESPONSE ESCALATING','raid');
  burst(raid.pos,colors.red,25); if(currentMission().kind==='raid' && currentMission().pos.distanceTo(raid.pos)<30) advanceMission();
}
function interact() { const item=state.currentInteract;if(!item)return;if(item.type==='vehicle')enterVehicle(item.data);else if(item.type==='exit')exitVehicle();else if(item.type==='raid')performRaid(item.data);else if(item.type==='boss'){state.bossActive=true;toast('VIPER KANE ENGAGED','raid');} }

function reload() {
  if(state.reloading||state.ammo[state.weapon]>=weapons[state.weapon].magazine||state.reserve[state.weapon]<=0)return;
  state.reloading=true;toast('RELOADING…');setTimeout(()=>{const need=weapons[state.weapon].magazine-state.ammo[state.weapon],take=Math.min(need,state.reserve[state.weapon]);state.ammo[state.weapon]+=take;state.reserve[state.weapon]-=take;state.reloading=false;},820);
}
function fire() {
  const now=state.time;const gun=weapons[state.weapon];if(!state.started||state.reloading||now-state.lastShot<gun.fireRate)return;if(state.ammo[state.weapon]<=0){reload();return;}state.lastShot=now;state.ammo[state.weapon]--;state.cameraKick=.34;
  const origin=(state.vehicle?state.vehicle.group.position:player.position).clone();origin.y+=(state.vehicle?1.5:2.8);
  const dir=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading)).normalize();dir.x+=(Math.random()-.5)*gun.spread;dir.z+=(Math.random()-.5)*gun.spread;dir.normalize();
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(.12,7,7),material(gun.color,{emissive:gun.color,emissiveIntensity:2}));mesh.position.copy(origin);scene.add(mesh);state.bullets.push({mesh,vel:dir.multiplyScalar(gun.speed),life:1.15,damage:gun.damage,from:'player'});flash();
  if(state.ammo[state.weapon]===0)setTimeout(reload,100);
}
function enemyFire(enemy) {
  const target=player.position.clone();target.y+=2;const origin=enemy.pos.clone();origin.y+=2.8;const dir=target.sub(origin).normalize();const mesh=new THREE.Mesh(new THREE.SphereGeometry(.13,6,6),mats.red);mesh.position.copy(origin);scene.add(mesh);state.bullets.push({mesh,vel:dir.multiplyScalar(35),life:1.7,damage:boss===enemy?11:6,from:'enemy'});
}
function burst(pos,color,count=12) { for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.08+Math.random()*.14,5,5),material(color,{emissive:color,emissiveIntensity:1.5}));mesh.position.copy(pos).add(new THREE.Vector3(0,1.5,0));scene.add(mesh);state.particles.push({mesh,vel:new THREE.Vector3((Math.random()-.5)*10,Math.random()*8,(Math.random()-.5)*10),life:.65+Math.random()*.45});} }
function killEnemy(enemy) { enemy.alive=false;scene.remove(enemy.group);burst(enemy.pos,enemy.isBoss?colors.red:colors.cyan,enemy.isBoss?32:12);if(enemy.isBoss){toast('VIPER KANE DOWN — +$4,000','money');state.money+=4000;setHeat(5);advanceMission();}else {state.money+=90;toast('THREAT NEUTRALIZED +$90','money');} }
function takeDamage(amount) { if(state.time-state.lastDamage<.55)return;state.lastDamage=state.time;state.health=Math.max(0,state.health-amount);setHeat(Math.max(state.heat,2));flash();if(state.health<=0){state.health=100;state.money=Math.max(0,state.money-300);player.position.set(-21,0,-12);exitVehicle();toast('MEDICAL DROP — $300 RECOVERY FEE','raid');} }

function updateBullets(dt) {
  state.bullets = state.bullets.filter(b => { b.life-=dt;b.mesh.position.addScaledVector(b.vel,dt);if(b.from==='player'){
    enemies.forEach(e=>{if(e.alive&&b.life>0&&b.mesh.position.distanceTo(e.pos.clone().add(new THREE.Vector3(0,2.2,0)))< (e.isBoss?2.4:1.35)){e.health-=b.damage;b.life=-1;burst(b.mesh.position,e.isBoss?colors.red:colors.cyan,5);if(e.health<=0)killEnemy(e);}});
  }else if(b.mesh.position.distanceTo(player.position.clone().add(new THREE.Vector3(0,2,0)))<1.5){takeDamage(b.damage);b.life=-1;}
  if(b.life<=0){scene.remove(b.mesh);return false;}return true; });
  state.particles=state.particles.filter(p=>{p.life-=dt;p.vel.y-=18*dt;p.mesh.position.addScaledVector(p.vel,dt);p.mesh.scale.setScalar(Math.max(.1,p.life));if(p.life<=0){scene.remove(p.mesh);return false;}return true;});
}

function updateEnemies(dt) {
  enemies.forEach(e=>{if(!e.alive)return;const dist=e.pos.distanceTo(player.position);if(dist<55){const desired=Math.atan2(player.position.x-e.pos.x,player.position.z-e.pos.z);e.group.rotation.y=THREE.MathUtils.lerp(e.group.rotation.y,desired,dt*2.4);if(dist>13&&e!==boss){e.pos.x+=Math.sin(desired)*dt*2.2;e.pos.z+=Math.cos(desired)*dt*2.2;}if(state.time-state.bossLastShot>(e===boss?1.15:1.8)){state.bossLastShot=state.time;enemyFire(e);}}});
}

function updateVehicle(dt) {
  const v=state.vehicle;if(!v)return;const active=v.group;let speed=v.speed;const shift=state.keys.ShiftLeft||state.keys.ShiftRight;if(shift)speed*=1.75;const forwards=(state.keys.KeyW?1:0)-(state.keys.KeyS?1:0);const turn=(state.keys.KeyD?1:0)-(state.keys.KeyA?1:0);
  if(v.type==='plane'||v.type==='heli'){
    active.rotation.y-=turn*dt*1.3;const takeoff=shift?1:0; if(v.type==='heli'){active.position.y=THREE.MathUtils.clamp(active.position.y+(takeoff?dt*13:-dt*4),.4,60);} else {const moving=forwards>0;if(moving&&active.position.y<2.5)active.position.y+=dt*5; if(active.position.y>1.3)active.position.y+=((takeoff?1:-.35))*dt*6;active.position.y=Math.max(.4,active.position.y);} active.position.x+=Math.sin(active.rotation.y)*forwards*speed*dt;active.position.z+=Math.cos(active.rotation.y)*forwards*speed*dt;state.heading=active.rotation.y;
  } else {
    active.rotation.y-=turn*dt*(v.type==='boat'?1.15:1.75);active.position.x+=Math.sin(active.rotation.y)*forwards*speed*dt;active.position.z+=Math.cos(active.rotation.y)*forwards*speed*dt;state.heading=active.rotation.y;
    if(v.type==='boat')active.position.y=.38+Math.sin(state.time*2+active.position.x*.08)*.18;
  }
  active.position.x=THREE.MathUtils.clamp(active.position.x,-260,225);active.position.z=THREE.MathUtils.clamp(active.position.z,-205,220);player.position.copy(active.position);
}

function updatePlayer(dt) {
  if(state.vehicle){updateVehicle(dt);return;}const forward=(state.keys.KeyW?1:0)-(state.keys.KeyS?1:0);const turn=(state.keys.KeyD?1:0)-(state.keys.KeyA?1:0);state.heading-=turn*dt*2.5;const speed=(state.keys.ShiftLeft||state.keys.ShiftRight)?16:8.2;player.position.x+=Math.sin(state.heading)*forward*speed*dt;player.position.z+=Math.cos(state.heading)*forward*speed*dt;player.position.x=THREE.MathUtils.clamp(player.position.x,-225,215);player.position.z=THREE.MathUtils.clamp(player.position.z,-192,215);player.rotation.y=state.heading;
}

function updateCamera(dt) {
  const target=state.vehicle?state.vehicle.group.position:player.position; const airborne=state.vehicle&&(state.vehicle.type==='plane'||state.vehicle.type==='heli');
  const distance=airborne?30:22;const height=airborne?13:13;const back=new THREE.Vector3(-Math.sin(state.heading)*distance,height,-Math.cos(state.heading)*distance);const desired=target.clone().add(back);desired.y+=state.vehicle?2.5:1.3;camera.position.lerp(desired,1-Math.exp(-dt*4.3));const look=target.clone();look.y+=airborne?1:2.25;look.x+=Math.sin(state.heading)*5;look.z+=Math.cos(state.heading)*5;camera.lookAt(look);camera.fov=THREE.MathUtils.lerp(camera.fov,(state.vehicle?64:61)+state.cameraKick*7,dt*9);camera.updateProjectionMatrix();state.cameraKick*=Math.exp(-dt*10);
}

function updateMission() {
  const m=currentMission();const distance=distanceTo(m.pos);if(m.kind==='boss'&&distance<55&&!state.bossActive){state.bossActive=true;toast('BOSS TERRITORY — VIPER KANE','raid');}if(m.kind==='air'&&state.vehicle&&(state.vehicle.type==='plane'||state.vehicle.type==='heli')&&distance<65){toast('PACKAGE SECURED — SKYLINE RUN COMPLETE','money');state.money+=1500;advanceMission();}
  missionBeacons.forEach((b,i)=>b.visible=i===state.missionIndex);if(m.kind!=='boss'&&distance<9&&m.kind!=='raid'&&m.kind!=='air')advanceMission();
}
function advanceMission() { const old=state.missionIndex;state.missionIndex=(state.missionIndex+1)%missions.length;toast(`OPERATION ${String(old+1).padStart(2,'0')} COMPLETE`,'money');toast(`NEW OP: ${missions[state.missionIndex].title}`); }

function drawMap() {
  const ctx=mapContext,w=mapCanvas.width,h=mapCanvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#11313a';ctx.fillRect(0,0,w,h);
  const scale=.36, ox=w/2, oz=h/2;const map=(x,z)=>[ox+x*scale,oz+z*scale];
  ctx.fillStyle='#235f6e';ctx.fillRect(0,0,14,h);ctx.fillStyle='#1e3a42';[-120,0,120].forEach(x=>{let[p]=map(x,0);ctx.fillRect(p-4,0,8,h)});[-120,0,120].forEach(z=>{let[,p]=map(0,z);ctx.fillRect(0,p-4,w,8)});
  ctx.strokeStyle='rgba(164,233,226,.2)';ctx.lineWidth=1;for(let x=-180;x<=190;x+=60){for(let z=-150;z<=170;z+=60){const[a,b]=map(x,z);ctx.strokeRect(a,b,13,11)}}
  vehicles.forEach(v=>{if(!v.occupied){const[x,y]=map(v.group.position.x,v.group.position.z);ctx.fillStyle='#64e0e2';ctx.fillRect(x-1.8,y-1.8,3.6,3.6);}});
  raids.forEach(r=>{if(!r.raided){const[x,y]=map(r.pos.x,r.pos.z);ctx.fillStyle='#ff625c';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();}});
  const m=currentMission();{const[x,y]=map(m.pos.x,m.pos.z);ctx.strokeStyle='#f4c64e';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();}
  if(boss.alive){const[x,y]=map(boss.pos.x,boss.pos.z);ctx.fillStyle='#ff625c';ctx.fillRect(x-3,y-3,6,6);}
  const[x,y]=map(player.position.x,player.position.z);ctx.save();ctx.translate(x,y);ctx.rotate(-state.heading);ctx.fillStyle='#effffd';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,5);ctx.lineTo(-4,5);ctx.fill();ctx.restore();
}
function updateDistrict() { const x=player.position.x,z=player.position.z;let district='MIRAGE HEIGHTS';if(x<-120)district='CRIMSON DOCKS';else if(z>105)district='SKYLINE AIRFIELD';else if(z<-100)district='SUNSET QUARTER';else if(x>100)district='CIVIC CENTRAL';ui.district.textContent=district;ui.zone.textContent=district.split(' ')[0]; }

function animate() {
  requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);state.time+=dt;if(state.started){updatePlayer(dt);updateBullets(dt);updateEnemies(dt);updateMission();updateInteraction();updateDistrict();state.heat=Math.max(0,state.heat-dt*.013);}
  missionBeacons.forEach((b,i)=>{b.rotation.y+=dt*.7;b.children[1].scale.y=.9+Math.sin(state.time*2+i)*.1;});raids.forEach((r,i)=>{if(!r.raided){r.group.children[0].rotation.z+=dt*.8;r.group.children[1].scale.y=.9+Math.sin(state.time*3+i)*.12;}});if(boss.alive)boss.group.position.y=Math.sin(state.time*2)*.04;
  updateCamera(dt);updateHUD();if(state.time-state.mapDirty>.12){drawMap();state.mapDirty=state.time;}renderer.render(scene,camera);
}

window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
window.addEventListener('keydown',e=>{state.keys[e.code]=true;if(['Space','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyR','Digit1','Digit2'].includes(e.code))e.preventDefault();if(e.code==='KeyE'&&!e.repeat)interact();if(e.code==='Space'&&!e.repeat)fire();if(e.code==='KeyR'&&!e.repeat)reload();if(e.code==='Digit1')state.weapon=0;if(e.code==='Digit2')state.weapon=1;if(e.code==='KeyQ')state.heading+=.15;});
window.addEventListener('keyup',e=>state.keys[e.code]=false);
document.querySelector('#skip-mission').addEventListener('click',advanceMission);
document.querySelector('#launch-button').addEventListener('click',()=>{state.started=true;document.querySelector('#start-screen').classList.add('hidden');toast('CITY LINK ESTABLISHED','money');toast('Find the red beacon at Crimson Docks.');});
document.querySelector('#sound-toggle').addEventListener('click',e=>{e.currentTarget.textContent=e.currentTarget.textContent==='◌'?'◉':'◌';toast('AMBIENCE '+(e.currentTarget.textContent==='◉'?'ON':'OFF'));});
canvas.addEventListener('click',()=>{if(state.started)fire();});

camera.position.set(-21,13,-34);camera.lookAt(player.position);drawMap();animate();
