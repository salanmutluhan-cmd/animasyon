/*!
 * PetEngine — 2D cartoon köpek & kedi bakım animasyon motoru
 * Bağımlılık yok. SVG + requestAnimationFrame ile prosedürel animasyon.
 *
 * Kullanım:
 *   const pet = new PetEngine(document.getElementById('pet'), { species: 'dog' });
 *   pet.feed(); pet.giveWater(); pet.sleep(); pet.wake();
 *   pet.on('stats', s => console.log(s));
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var G = 372; // zemin çizgisi (viewBox koordinatı)
  var VB_W = 400, VB_H = 420;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function f(n) { return Math.round(n * 100) / 100; }
  // p değeri [a,b] aralığında 0→1→0 tepe eğrisi döndürür
  function bump(p, a, b, edge) {
    edge = edge || 0.15;
    if (p < a || p > b) return 0;
    var w = (b - a) * edge;
    return smooth01((p - a) / w) * smooth01((b - p) / w);
  }

  // ---------------------------------------------------------------- Renkler
  var PALETTES = {
    dog: {
      fur: '#E8AE6E', furShade: '#C98A4B', light: '#FFF4E4', ear: '#9E5E31', earShade: '#7E4623',
      patch: '#B8763F', nose: '#3A2622', line: '#4A2C22', pupil: '#2B1B17', iris: '#2B1B17',
      cheek: '#FF8FA3', tongue: '#FF7E95', mouth: '#8E2F3C', brow: '#8A5530'
    },
    cat: {
      fur: '#F5A85C', furShade: '#D9802F', light: '#FFF7EC', ear: '#F5A85C', earShade: '#D9802F',
      earInner: '#FFB5C3', stripe: '#D47528', nose: '#FF8597', line: '#4A2C22', pupil: '#1F1A17',
      iris: '#8BC34A', cheek: '#FF8FA3', tongue: '#FF7E95', mouth: '#8E2F3C', brow: '#C46A22'
    },
    props: {
      foodBowl: '#F06C8B', foodBowlShade: '#C94A6A', kibble: '#A8582B', kibble2: '#C7773D',
      waterBowl: '#4FA9D6', waterBowlShade: '#2F7FAE', water: '#9EDCFA', waterShade: '#6CC3F0',
      heart: '#FF5E86', zzz: '#7C8BE0', drop: '#6CC3F0', shadow: 'rgba(60,30,20,0.16)'
    }
  };

  // ---------------------------------------------------------------- Tür geometrisi
  var SPECIES = {
    dog: {
      eyes: [{ cx: 166, cy: 132, rx: 18, ry: 21 }, { cx: 234, cy: 132, rx: 18, ry: 21 }],
      mouth: { x: 200, y: 176, hw: 18, depth: 36 }, tongueW: 11,
      legs: [174, 226], cheekY: 176, headCY: 140
    },
    cat: {
      eyes: [{ cx: 162, cy: 136, rx: 21, ry: 22 }, { cx: 238, cy: 136, rx: 21, ry: 22 }],
      mouth: { x: 200, y: 176, hw: 13, depth: 28 }, tongueW: 8,
      legs: [177, 223], cheekY: 180, headCY: 142
    }
  };

  // ---------------------------------------------------------------- Poz parametreleri
  // Her kare hedef (target) poz hesaplanır, mevcut poz yumuşakça hedefe yaklaşır.
  var POSE_DEFAULT = {
    headX: 0, headY: 0, tilt: 0, headScale: 1,
    lookX: 0, lookY: 0, eyeOpen: 1, squint: 0, closedCurve: 1, pupil: 0.3,
    brow: 0, browY: 0,
    smile: 0.4, mouthOpen: 0, tongue: 0, tongueX: 0,
    earLift: 0, tailBase: 0, wagFreq: 1.2, wagAmp: 8,
    lie: 0, blush: 0, breathRate: 0.33, breathAmp: 1, whisker: 0
  };
  var POSE_SPEED = {
    mouthOpen: 16, tongue: 14, tongueX: 14, eyeOpen: 12, squint: 10, closedCurve: 14,
    lie: 2.6, headY: 7, headX: 7, tilt: 6, lookX: 9, lookY: 9, smile: 8, brow: 6,
    wagFreq: 4, wagAmp: 4, tailBase: 4, breathRate: 2, breathAmp: 2, blush: 4
  };

  var MOOD_POSES = {
    happy:   { smile: 0.9, earLift: 0.35, tailBase: -10, wagFreq: 2.2, wagAmp: 18, pupil: 0.5 },
    neutral: { smile: 0.4, earLift: 0.05, tailBase: 0, wagFreq: 1.1, wagAmp: 8 },
    hungry:  { smile: -0.45, brow: 0.85, earLift: -0.45, tailBase: 18, wagFreq: 0.6, wagAmp: 3, lookY: 0.25, headY: 4 },
    thirsty: { smile: 0.15, brow: 0.45, mouthOpen: 0.38, tongue: 0.75, breathRate: 2.3, breathAmp: 1.3, earLift: -0.2, tailBase: 10, wagFreq: 0.8, wagAmp: 4 },
    tired:   { eyeOpen: 0.42, brow: 0.55, headY: 12, tilt: 5, earLift: -0.65, tailBase: 28, wagFreq: 0.4, wagAmp: 2, smile: 0, breathRate: 0.24, breathAmp: 1.3, lookY: 0.35 },
    sad:     { smile: -0.7, brow: 1, earLift: -0.85, tailBase: 32, wagFreq: 0.3, wagAmp: 0, headY: 8, lookY: 0.45, pupil: 0.7 },
    sleeping:{ lie: 1, eyeOpen: 0, closedCurve: -1, smile: 0.2, earLift: -0.7, tailBase: 58, wagFreq: 0.25, wagAmp: 1.5,
               breathRate: 0.21, breathAmp: 2.4, tilt: 8, headX: -6 }
  };

  var DEFAULT_DECAY = { // saat başına puan
    fullness: 6, hydration: 8, energy: 5, energyRegen: 22, happiness: 3, lowStatPenalty: 3
  };

  var uidCounter = 0;

  // ================================================================ SVG oluşturma
  function legShape(x, top, wrist, w1, w2) {
    var h = wrist - top;
    return 'M' + f(x - w1) + ' ' + f(top) +
      ' C' + f(x - w1 - 3) + ' ' + f(top + h * 0.45) + ' ' + f(x - w2 - 2) + ' ' + f(top + h * 0.62) + ' ' + f(x - w2) + ' ' + f(wrist) +
      ' L' + f(x + w2) + ' ' + f(wrist) +
      ' C' + f(x + w2 + 2) + ' ' + f(top + h * 0.62) + ' ' + f(x + w1 + 3) + ' ' + f(top + h * 0.45) + ' ' + f(x + w1) + ' ' + f(top) +
      ' Q' + f(x) + ' ' + f(top - 16) + ' ' + f(x - w1) + ' ' + f(top) + 'Z';
  }

  function eyeMarkup(e, i, sp, C, uid) {
    var id = uid + '-eye' + i;
    var iris = sp === 'cat'
      ? '<ellipse data-r="iris' + i + '" rx="15" ry="17" fill="' + C.iris + '"/>' +
        '<ellipse data-r="pupil' + i + '" rx="5" ry="14" fill="' + C.pupil + '"/>'
      : '<ellipse data-r="pupil' + i + '" rx="12" ry="14" fill="' + C.pupil + '"/>';
    return '' +
      '<clipPath id="' + id + '"><ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '"/></clipPath>' +
      '<g data-r="eye' + i + '">' +
        '<g clip-path="url(#' + id + ')">' +
          '<ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '" fill="#fff"/>' +
          iris +
          '<circle data-r="hl' + i + 'a" r="5" fill="#fff"/>' +
          '<circle data-r="hl' + i + 'b" r="2.3" fill="#fff"/>' +
          '<path data-r="lid' + i + '" fill="' + C.fur + '"/>' +
          '<path data-r="low' + i + '" fill="' + C.fur + '"/>' +
          '<path data-r="lidEdge' + i + '" fill="none" stroke="' + C.line + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path data-r="lowEdge' + i + '" fill="none" stroke="' + C.line + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '</g>' +
        '<ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '" fill="none" stroke="' + C.line + '" stroke-width="3.5"/>' +
      '</g>' +
      '<path data-r="closed' + i + '" fill="none" stroke="' + C.line + '" stroke-width="4.5" stroke-linecap="round" display="none"/>';
  }

  function buildSVG(sp, C, P, uid) {
    var S = SPECIES[sp];
    var L = C.line;
    var st = ' stroke="' + L + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';
    var isDog = sp === 'dog';

    var defs = '<defs>' +
      '<radialGradient id="' + uid + '-gHead" cx="50%" cy="38%" r="62%">' +
        '<stop offset="0.65" stop-color="' + C.fur + '"/><stop offset="1" stop-color="' + C.furShade + '"/></radialGradient>' +
      '<radialGradient id="' + uid + '-gBody" cx="50%" cy="30%" r="70%">' +
        '<stop offset="0.55" stop-color="' + C.fur + '"/><stop offset="1" stop-color="' + C.furShade + '"/></radialGradient>' +
      '<linearGradient id="' + uid + '-gEar" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + C.ear + '"/><stop offset="1" stop-color="' + C.earShade + '"/></linearGradient>' +
      '<clipPath id="' + uid + '-mouth"><path data-r="mouthClip"/></clipPath>' +
      '</defs>';

    // Kuyruk
    var tail = isDog
      ? '<path d="M246 354 C302 354 338 326 342 278 C344 258 320 256 318 276 C314 312 290 332 244 336 Z" fill="url(#' + uid + '-gBody)"' + st + '/>' +
        '<path d="M339 280 C341 266 324 262 321 276 Z" fill="' + C.light + '" stroke="none"/>'
      : '<path d="M248 358 C318 362 342 312 328 252 C324 234 302 236 306 254 C318 304 306 338 246 340 Z" fill="url(#' + uid + '-gBody)"' + st + '/>' +
        '<path d="M309 270 L327 266 M314 296 L333 296 M300 322 L318 332" stroke="' + C.stripe + '" stroke-width="5" stroke-linecap="round"/>';

    // Gövde (oturan, karşıdan)
    var body = '<g data-r="body">' +
      '<ellipse cx="138" cy="' + (G - 42) + '" rx="37" ry="41" fill="url(#' + uid + '-gBody)"' + st + '/>' +
      '<ellipse cx="262" cy="' + (G - 42) + '" rx="37" ry="41" fill="url(#' + uid + '-gBody)"' + st + '/>' +
      '<ellipse cx="117" cy="' + (G - 10) + '" rx="25" ry="12" fill="' + (isDog ? C.fur : C.light) + '"' + st + '/>' +
      '<ellipse cx="283" cy="' + (G - 10) + '" rx="25" ry="12" fill="' + (isDog ? C.fur : C.light) + '"' + st + '/>' +
      '<path d="M160 205 C128 232 114 300 122 ' + (G - 6) + ' Q200 ' + (G + 8) + ' 278 ' + (G - 6) + ' C286 300 272 232 240 205 Z" fill="url(#' + uid + '-gBody)"' + st + '/>' +
      '<ellipse cx="200" cy="290" rx="42" ry="60" fill="' + C.light + '"/>' +
      (isDog ? '' : '<path d="M135 250 L152 256 M128 282 L148 285 M265 250 L248 256 M272 282 L252 285" stroke="' + C.stripe + '" stroke-width="5" stroke-linecap="round"/>') +
      '</g>';

    // Ön bacaklar (omuz + bilek + pati + parmak çizgileri)
    function leg(i, x) {
      return '<g data-r="leg' + i + '">' +
        '<path data-r="legPath' + i + '" fill="url(#' + uid + '-gBody)"' + st + '/>' +
        '<ellipse data-r="paw' + i + '" cx="' + x + '" cy="' + (G - 11) + '" rx="21" ry="12.5" fill="' + (isDog ? C.fur : C.light) + '"' + st + '/>' +
        '<path data-r="toes' + i + '" d="M' + (x - 7) + ' ' + (G - 17) + ' L' + (x - 7) + ' ' + (G - 7) + ' M' + (x + 7) + ' ' + (G - 17) + ' L' + (x + 7) + ' ' + (G - 7) + '" stroke="' + L + '" stroke-width="3" stroke-linecap="round"/>' +
        '</g>';
    }

    // Kafa
    var headShape = isDog
      ? 'M200 64 C256 64 290 96 288 142 C287 186 250 212 200 212 C150 212 113 186 112 142 C110 96 144 64 200 64 Z'
      : 'M200 72 C258 72 294 104 294 148 C294 162 302 168 306 174 C296 176 290 178 286 182 C272 206 240 216 200 216 C160 216 128 206 114 182 C110 178 104 176 94 174 C98 168 106 162 106 148 C106 104 142 72 200 72 Z';

    var earL, earR;
    if (isDog) {
      var earPath = 'M140 76 C104 60 70 92 74 148 C76 180 96 198 113 186 C127 174 126 128 148 100 Z';
      var earIn = 'M132 84 C108 78 88 104 90 146 C92 168 102 178 110 172 C118 160 118 126 136 102 Z';
      var ear = '<path d="' + earPath + '" fill="url(#' + uid + '-gEar)"' + st + '/>' +
                '<path d="' + earIn + '" fill="' + C.earShade + '" opacity="0.45"/>';
      earL = '<g data-r="ear0">' + ear + '</g>';
      earR = '<g transform="translate(400 0) scale(-1 1)"><g data-r="ear1">' + ear + '</g></g>';
    } else {
      var cEar = '<path d="M130 116 C118 88 114 58 120 32 C146 40 168 58 182 82 Z" fill="url(#' + uid + '-gHead)"' + st + '/>' +
                 '<path d="M136 102 C129 82 127 64 130 48 C146 56 158 66 166 80 Z" fill="' + C.earInner + '"/>' +
                 '<path d="M128 56 L140 66 M126 70 L138 76" stroke="' + C.light + '" stroke-width="2.5" stroke-linecap="round"/>';
      earL = '<g data-r="ear0">' + cEar + '</g>';
      earR = '<g transform="translate(400 0) scale(-1 1)"><g data-r="ear1">' + cEar + '</g></g>';
    }

    var face = '';
    if (isDog) {
      face += '<ellipse cx="236" cy="124" rx="30" ry="28" fill="' + C.patch + '" opacity="0.85"/>';
      face += '<ellipse cx="200" cy="180" rx="47" ry="32" fill="' + C.light + '"/>';
      face += '<path d="M200 78 C190 94 192 110 200 116 C208 110 210 94 200 78 Z" fill="' + C.light + '" opacity="0.9"/>';
    } else {
      face += '<path d="M200 76 L200 98 M184 79 L188 96 M216 79 L212 96" stroke="' + C.stripe + '" stroke-width="6" stroke-linecap="round"/>';
      face += '<path d="M108 150 L124 148 M292 150 L276 148 M110 162 L124 158 M290 162 L276 158" stroke="' + C.stripe + '" stroke-width="4.5" stroke-linecap="round"/>';
      face += '<ellipse cx="186" cy="182" rx="20" ry="15" fill="' + C.light + '"/>';
      face += '<ellipse cx="214" cy="182" rx="20" ry="15" fill="' + C.light + '"/>';
      face += '<ellipse cx="200" cy="194" rx="14" ry="9" fill="' + C.light + '"/>';
    }

    var eyes = eyeMarkup(S.eyes[0], 0, sp, C, uid) + eyeMarkup(S.eyes[1], 1, sp, C, uid);
    var brows = '<path data-r="brow0" fill="none" stroke="' + C.brow + '" stroke-width="' + (isDog ? 6 : 4) + '" stroke-linecap="round"/>' +
                '<path data-r="brow1" fill="none" stroke="' + C.brow + '" stroke-width="' + (isDog ? 6 : 4) + '" stroke-linecap="round"/>';

    var nose = isDog
      ? '<path d="M200 168 L200 176" stroke="' + L + '" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M183 152 Q200 141 217 152 Q218 164 200 169 Q182 164 183 152 Z" fill="' + C.nose + '"' + st + '/>' +
        '<ellipse cx="194" cy="151" rx="6" ry="3" fill="#fff" opacity="0.55"/>'
      : '<path d="M200 169 L200 176" stroke="' + L + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M191 160 Q200 155 209 160 Q206 168 200 170 Q194 168 191 160 Z" fill="' + C.nose + '" stroke="' + L + '" stroke-width="3" stroke-linejoin="round"/>';

    var mouth =
      '<path data-r="mouthOpen" fill="' + C.mouth + '" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<g clip-path="url(#' + uid + '-mouth)"><ellipse data-r="mouthTongue" fill="' + C.tongue + '"/></g>' +
      '<g data-r="tongueOut"><path data-r="tongue" fill="' + C.tongue + '" stroke="' + L + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path data-r="tongueLine" stroke="#E0607A" stroke-width="2.5" stroke-linecap="round" fill="none"/></g>' +
      '<path data-r="mouthLine" fill="none" stroke="' + L + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';

    var whiskers = isDog ? '' :
      '<g data-r="whisk0" stroke="' + L + '" stroke-width="2.2" stroke-linecap="round" opacity="0.8">' +
        '<path d="M170 178 L120 170"/><path d="M170 185 L118 186"/><path d="M172 191 L124 202"/></g>' +
      '<g transform="translate(400 0) scale(-1 1)"><g data-r="whisk1" stroke="' + L + '" stroke-width="2.2" stroke-linecap="round" opacity="0.8">' +
        '<path d="M170 178 L120 170"/><path d="M170 185 L118 186"/><path d="M172 191 L124 202"/></g></g>';

    var cheeks = '<g data-r="cheeks" opacity="0">' +
      '<ellipse cx="146" cy="' + S.cheekY + '" rx="15" ry="9" fill="' + C.cheek + '"/>' +
      '<ellipse cx="254" cy="' + S.cheekY + '" rx="15" ry="9" fill="' + C.cheek + '"/></g>';

    var head = '<g data-r="head">' +
      (isDog ? '' : earL + earR) +
      '<path d="' + headShape + '" fill="url(#' + uid + '-gHead)"' + st + '/>' +
      face + cheeks + eyes + brows + nose + mouth + whiskers +
      (isDog ? earL + earR : '') +
      '</g>';

    // Mama kabı
    var kibbles = '';
    var kp = [[200, 322], [186, 325], [214, 325], [172, 329], [228, 329], [193, 330], [207, 330], [158, 333], [242, 333], [180, 334], [220, 334], [200, 335]];
    for (var k = 0; k < kp.length; k++) {
      kibbles += '<ellipse data-r="kib' + k + '" cx="' + kp[k][0] + '" cy="' + kp[k][1] + '" rx="8" ry="6" fill="' + (k % 2 ? P.kibble : P.kibble2) + '" stroke="' + L + '" stroke-width="2"/>';
    }
    function bowlBody(c, cs) {
      return '<path d="M124 336 L140 388 Q200 400 260 388 L276 336 Z" fill="' + c + '"' + st + '/>' +
        '<path d="M134 352 Q200 362 266 352" stroke="' + cs + '" stroke-width="4" fill="none" opacity="0.6"/>' +
        '<g fill="#fff" opacity="0.75"><ellipse cx="200" cy="374" rx="9" ry="7"/><circle cx="189" cy="363" r="3.6"/><circle cx="200" cy="360" r="3.6"/><circle cx="211" cy="363" r="3.6"/></g>';
    }
    var foodBowl = '<g data-r="foodBowl" opacity="0">' +
      '<ellipse cx="200" cy="336" rx="76" ry="16" fill="' + P.foodBowlShade + '"' + st + '/>' +
      '<g data-r="kibbles">' + kibbles + '</g>' + bowlBody(P.foodBowl, P.foodBowlShade) + '</g>';
    var waterBowl = '<g data-r="waterBowl" opacity="0">' +
      '<ellipse cx="200" cy="336" rx="76" ry="16" fill="' + P.waterBowlShade + '"' + st + '/>' +
      '<ellipse data-r="water" cx="200" cy="338" rx="66" ry="11" fill="' + P.water + '"/>' +
      '<g data-r="ripples"></g>' + bowlBody(P.waterBowl, P.waterBowlShade) + '</g>';

    return '<svg xmlns="' + SVGNS + '" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" preserveAspectRatio="xMidYMid meet" ' +
      'style="width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden">' +
      defs +
      '<g data-r="root">' +
        '<ellipse data-r="shadow" cx="200" cy="' + (G + 2) + '" rx="112" ry="14" fill="' + P.shadow + '"/>' +
        '<g data-r="tail">' + tail + '</g>' +
        body + leg(0, S.legs[0]) + leg(1, S.legs[1]) + head +
      '</g>' +
      foodBowl + waterBowl +
      '<g data-r="fx" style="pointer-events:none"></g>' +
      '</svg>';
  }

  // ================================================================ Motor
  function PetEngine(container, options) {
    if (!(this instanceof PetEngine)) return new PetEngine(container, options);
    options = options || {};
    this.container = container;
    this.species = options.species === 'cat' ? 'cat' : 'dog';
    this.timeScale = options.timeScale || 1;      // 1 = gerçek zaman. Demo için 600 gibi değerler kullanılabilir.
    this.autoWake = options.autoWake !== false;    // enerji dolunca kendiliğinden uyanır
    this.decay = Object.assign({}, DEFAULT_DECAY, options.decay || {});
    this.customColors = options.colors || {};
    this.listeners = {};
    this.stats = Object.assign({ fullness: 80, hydration: 80, energy: 80, happiness: 80 }, options.stats || {});
    this.sleeping = false;
    this.paused = false;

    this.P = Object.assign({}, POSE_DEFAULT);
    this.t = 0;
    this.breathPhase = 0; this.wagPhase = 0;
    this.blink = { next: rand(1.5, 4), t: -1, dur: 0.18 };
    this.look = { x: 0, y: 0, next: 2 };
    this.earTwitch = { next: rand(3, 7), t: -1, side: 0 };
    this.idleNext = rand(5, 9);
    this.action = null; this.queue = [];
    this.pet = { level: 0, moving: 0, dist: 0, heartDist: 0, x: 200, y: 150, purr: 0 };
    this.bowls = { food: 0, water: 0, foodTarget: 0, waterTarget: 0, foodAmount: 1, waterAmount: 1 };
    this.particles = [];
    this.fxTimers = { z: 0, ripple: 0, sweat: rand(2, 4) };
    this.pointer = null;
    this.mood = null;
    this._statsEmit = 0;

    if (options.state) this.setState(options.state);
    this._build();
    this._loop = this._loop.bind(this);
    this._last = null;
    this._raf = requestAnimationFrame(this._loop);
  }

  var proto = PetEngine.prototype;

  // ---------------------------------------------------------------- olaylar
  proto.on = function (ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); return this; };
  proto.off = function (ev, cb) {
    var l = this.listeners[ev]; if (!l) return this;
    this.listeners[ev] = cb ? l.filter(function (x) { return x !== cb; }) : []; return this;
  };
  proto._emit = function (ev, data) {
    var l = this.listeners[ev]; if (l) l.slice().forEach(function (cb) { try { cb(data); } catch (e) { console.error(e); } });
    var any = this.listeners['*']; if (any) any.slice().forEach(function (cb) { try { cb(ev, data); } catch (e) { console.error(e); } });
  };

  // ---------------------------------------------------------------- kurulum
  proto._colors = function () {
    var base = Object.assign({}, PALETTES[this.species]);
    var c = this.customColors || {};
    if (c[this.species]) Object.assign(base, c[this.species]);
    Object.keys(c).forEach(function (k) { if (typeof c[k] === 'string') base[k] = c[k]; });
    return base;
  };

  proto._build = function () {
    this.uid = 'pet' + (++uidCounter);
    var props = Object.assign({}, PALETTES.props, (this.customColors && this.customColors.props) || {});
    this.container.innerHTML = buildSVG(this.species, this._colors(), props, this.uid);
    this.svg = this.container.querySelector('svg');
    var r = this.r = {};
    var nodes = this.svg.querySelectorAll('[data-r]');
    for (var i = 0; i < nodes.length; i++) r[nodes[i].getAttribute('data-r')] = nodes[i];
    this.particles = [];
    this._bindPointer();
    this._updateKibbles(true);
  };

  proto.setSpecies = function (sp) {
    sp = sp === 'cat' ? 'cat' : 'dog';
    if (sp === this.species) return;
    this.species = sp;
    this._unbindPointer();
    this._build();
    this._emit('species', sp);
  };

  proto.setColors = function (colors) {
    this.customColors = colors || {};
    this._unbindPointer();
    this._build();
  };

  proto.setTimeScale = function (s) { this.timeScale = Math.max(0, +s || 0); };

  proto.destroy = function () {
    cancelAnimationFrame(this._raf);
    this._unbindPointer();
    this.container.innerHTML = '';
    this.listeners = {};
  };

  proto.pause = function () { this.paused = true; };
  proto.resume = function () { this.paused = false; this._last = null; };

  // ---------------------------------------------------------------- dokunma / sevme
  proto._toLocal = function (e) {
    var ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    var pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  proto._hit = function (x, y) {
    var P = this.P;
    var hy = SPECIES[this.species].headCY + P.headY + P.lie * 70;
    var dx = (x - 200 - P.headX) / 100, dy = (y - hy) / 88;
    if (dx * dx + dy * dy < 1) return 'head';
    var by = lerp(292, 332, P.lie);
    dx = (x - 200) / 92; dy = (y - by) / lerp(85, 50, P.lie);
    if (dx * dx + dy * dy < 1) return 'body';
    return null;
  };

  proto._bindPointer = function () {
    var self = this, svg = this.svg;
    this._ph = {
      down: function (e) {
        var p = self._toLocal(e);
        self.pointer = { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: performance.now(), moved: 0 };
        try { svg.setPointerCapture(e.pointerId); } catch (_) { /* yoksay */ }
        e.preventDefault();
      },
      move: function (e) {
        var ptr = self.pointer; if (!ptr || ptr.id !== e.pointerId) return;
        var p = self._toLocal(e);
        var d = Math.hypot(p.x - ptr.x, p.y - ptr.y);
        ptr.x = p.x; ptr.y = p.y; ptr.moved += d;
        if (d > 0.5 && self._hit(p.x, p.y)) self._petStroke(p.x, p.y, d);
        e.preventDefault();
      },
      up: function (e) {
        var ptr = self.pointer; if (!ptr || ptr.id !== e.pointerId) return;
        var p = self._toLocal(e);
        if (ptr.moved < 10 && performance.now() - ptr.t0 < 350) {
          var part = self._hit(p.x, p.y);
          if (part) self._tap(p.x, p.y, part);
        }
        self.pointer = null;
      }
    };
    svg.addEventListener('pointerdown', this._ph.down);
    svg.addEventListener('pointermove', this._ph.move);
    svg.addEventListener('pointerup', this._ph.up);
    svg.addEventListener('pointercancel', this._ph.up);
  };

  proto._unbindPointer = function () {
    if (!this.svg || !this._ph) return;
    this.svg.removeEventListener('pointerdown', this._ph.down);
    this.svg.removeEventListener('pointermove', this._ph.move);
    this.svg.removeEventListener('pointerup', this._ph.up);
    this.svg.removeEventListener('pointercancel', this._ph.up);
  };

  proto._petStroke = function (x, y, d) {
    var pet = this.pet;
    var wasLow = pet.level < 0.05;
    pet.level = Math.min(1, pet.level + d * 0.012);
    pet.moving = 0.35; pet.x = x; pet.y = y;
    pet.heartDist += d;
    if (pet.heartDist > 38) {
      pet.heartDist = 0;
      this._spawn('heart', x + rand(-10, 10), y - 10, { vx: rand(-15, 15), vy: rand(-70, -45), s: rand(0.8, 1.25) });
    }
    this.stats.happiness = Math.min(100, this.stats.happiness + d * 0.012);
    if (wasLow) this._emit('pet', { phase: 'start' });
  };

  // Uygulama tarafından programatik sevme (ör. bir butondan)
  proto.petOnce = function () {
    var self = this, n = 0;
    var iv = setInterval(function () {
      var x = 200 + Math.sin(n * 0.5) * 50, y = 120 + Math.cos(n * 0.3) * 12;
      self._petStroke(x, y, 9); if (++n > 40) clearInterval(iv);
    }, 30);
  };

  proto._tap = function (x, y, part) {
    if (this.action && this.action.busy) return;
    if (this.sleeping) { this._startAction(ACTIONS.stir(this)); return; }
    this._spawn('heart', x, y - 8, { vx: 0, vy: -60, s: 1 });
    this._startAction(part === 'head' ? ACTIONS.boop(this) : ACTIONS.hop(this));
    this.stats.happiness = Math.min(100, this.stats.happiness + 1);
  };

  // ---------------------------------------------------------------- aksiyonlar (genel API)
  proto.feed = function () {
    if (this.action && this.action.name === 'eat') return false;
    this._clearActions();
    if (this.sleeping) this._enqueue(ACTIONS.wake(this));
    this._enqueue(ACTIONS.eat(this));
    return true;
  };
  proto.giveWater = function () {
    if (this.action && this.action.name === 'drink') return false;
    this._clearActions();
    if (this.sleeping) this._enqueue(ACTIONS.wake(this));
    this._enqueue(ACTIONS.drink(this));
    return true;
  };
  proto.sleep = function () {
    if (this.sleeping) return false;
    this._clearActions();
    this._enqueue(ACTIONS.yawn(this));
    this._enqueue(ACTIONS.fallAsleep(this));
    return true;
  };
  proto.wake = function () {
    if (!this.sleeping) return false;
    this._clearActions();
    this._enqueue(ACTIONS.wake(this));
    return true;
  };
  proto.yawn = function () { if (!this.sleeping && !this.action) this._startAction(ACTIONS.yawn(this)); };
  proto.celebrate = function () { if (!this.sleeping) { this._clearActions(); this._startAction(ACTIONS.celebrate(this)); } };
  proto.play = function (name) { // gelişmiş: herhangi bir animasyonu isimle oynat
    if (ACTIONS[name]) { this._clearActions(); this._startAction(ACTIONS[name](this)); }
  };

  proto._clearActions = function () {
    if (this.action && this.action.cancel) this.action.cancel();
    this.action = null; this.queue = [];
  };
  proto._enqueue = function (a) { if (!this.action) this._startAction(a); else this.queue.push(a); };
  proto._startAction = function (a) {
    if (this.action && this.action.cancel) this.action.cancel();
    this.action = a; a.t = 0; a.p = 0;
    if (a.start) a.start();
    if (!a.silent) this._emit('action', { name: a.name, phase: 'start' });
  };

  // ---------------------------------------------------------------- durum
  proto.getState = function () {
    return {
      species: this.species,
      stats: {
        fullness: Math.round(this.stats.fullness * 10) / 10,
        hydration: Math.round(this.stats.hydration * 10) / 10,
        energy: Math.round(this.stats.energy * 10) / 10,
        happiness: Math.round(this.stats.happiness * 10) / 10
      },
      sleeping: this.sleeping,
      mood: this.mood,
      lastUpdate: Date.now()
    };
  };

  proto.setState = function (s) {
    if (!s) return;
    if (s.stats) Object.keys(this.stats).forEach(function (k) {
      if (typeof s.stats[k] === 'number') this.stats[k] = clamp(s.stats[k], 0, 100);
    }, this);
    if (typeof s.sleeping === 'boolean') {
      this.sleeping = s.sleeping;
      if (this.P) { this.P.lie = s.sleeping ? 1 : 0; this.P.eyeOpen = s.sleeping ? 0 : 1; }
    }
    if (s.species && this.svg && s.species !== this.species) this.setSpecies(s.species);
    else if (s.species && !this.svg) this.species = s.species === 'cat' ? 'cat' : 'dog';
    // Uygulama kapalıyken geçen süreyi uygula (en fazla 72 saat)
    if (s.lastUpdate) {
      var hours = clamp((Date.now() - s.lastUpdate) / 3600000, 0, 72);
      this._tickStats(hours * 3600, true);
    }
    this._emit('stats', this.getState());
  };

  proto.setStats = function (stats) { this.setState({ stats: stats }); };

  proto._tickStats = function (seconds, raw) {
    var h = raw ? seconds / 3600 : seconds * this.timeScale / 3600;
    if (h <= 0) return;
    var s = this.stats, d = this.decay;
    var sleepMul = this.sleeping ? 0.5 : 1;
    s.fullness = clamp(s.fullness - d.fullness * h * sleepMul, 0, 100);
    s.hydration = clamp(s.hydration - d.hydration * h * sleepMul, 0, 100);
    if (this.sleeping) s.energy = clamp(s.energy + d.energyRegen * h, 0, 100);
    else s.energy = clamp(s.energy - d.energy * h, 0, 100);
    var low = (s.fullness < 25) + (s.hydration < 25) + (s.energy < 15);
    s.happiness = clamp(s.happiness - (d.happiness + low * d.lowStatPenalty) * h, 0, 100);
  };

  proto._computeMood = function () {
    var s = this.stats;
    if (this.sleeping) return 'sleeping';
    if (s.energy < 25) return 'tired';
    if (s.fullness < 30) return 'hungry';
    if (s.hydration < 30) return 'thirsty';
    if (s.happiness < 30) return 'sad';
    if (s.fullness > 65 && s.hydration > 65 && s.energy > 55 && s.happiness > 65) return 'happy';
    return 'neutral';
  };

  // ---------------------------------------------------------------- parçacıklar
  proto._spawn = function (type, x, y, o) {
    o = o || {};
    var el, C = PALETTES.props, layer = this.r.fx;
    var pal = this._colors();
    switch (type) {
      case 'heart':
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', 'M0 7 C-14 -3 -9 -16 0 -8 C9 -16 14 -3 0 7 Z');
        el.setAttribute('fill', C.heart); el.setAttribute('stroke', pal.line); el.setAttribute('stroke-width', '2');
        break;
      case 'z':
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', 'M-8 -9 L8 -9 L-8 9 L8 9');
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', C.zzz); el.setAttribute('stroke-width', '4.5');
        el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('stroke-linecap', 'round');
        break;
      case 'text':
        el = document.createElementNS(SVGNS, 'text');
        el.textContent = o.text || '';
        el.setAttribute('font-family', 'Arial Rounded MT Bold, Nunito, Verdana, sans-serif');
        el.setAttribute('font-weight', '900'); el.setAttribute('font-size', o.size || 18);
        el.setAttribute('fill', o.color || pal.line); el.setAttribute('text-anchor', 'middle');
        break;
      case 'crumb':
        el = document.createElementNS(SVGNS, 'ellipse');
        el.setAttribute('rx', '4'); el.setAttribute('ry', '3');
        el.setAttribute('fill', Math.random() < 0.5 ? C.kibble : C.kibble2);
        break;
      case 'drop':
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', 'M0 -7 C4 -1 5 2 5 4 A5 5 0 0 1 -5 4 C-5 2 -4 -1 0 -7 Z');
        el.setAttribute('fill', C.drop); el.setAttribute('stroke', '#fff'); el.setAttribute('stroke-width', '1.2');
        break;
      case 'ripple':
        el = document.createElementNS(SVGNS, 'ellipse');
        el.setAttribute('rx', '10'); el.setAttribute('ry', '2.5');
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', '#fff'); el.setAttribute('stroke-width', '2');
        layer = this.r.ripples;
        break;
      case 'sparkle':
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', 'M0 -9 Q1.5 -1.5 9 0 Q1.5 1.5 0 9 Q-1.5 1.5 -9 0 Q-1.5 -1.5 0 -9 Z');
        el.setAttribute('fill', '#FFD166'); el.setAttribute('stroke', pal.line); el.setAttribute('stroke-width', '1.5');
        break;
      case 'growl':
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', 'M-14 0 Q-10 -6 -6 0 T2 0 T10 0 T18 0');
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', pal.line); el.setAttribute('stroke-width', '3'); el.setAttribute('stroke-linecap', 'round');
        break;
      default: return;
    }
    layer.appendChild(el);
    this.particles.push({
      el: el, type: type, x: x, y: y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0,
      age: 0, life: o.life || 1.4, s: o.s || 1, rot: o.rot || 0, vr: o.vr || 0, wobble: o.wobble || 0
    });
  };

  proto._updateParticles = function (dt) {
    var list = this.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.age += dt;
      var k = p.age / p.life;
      if (k >= 1) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); list.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      var x = p.x + (p.wobble ? Math.sin(p.age * 4) * p.wobble : 0);
      var sc = p.s, op = 1;
      if (p.type === 'ripple') { sc = 1 + k * 3; op = 1 - k; }
      else if (p.type === 'heart' || p.type === 'sparkle') { sc = p.s * (k < 0.15 ? smooth01(k / 0.15) : 1); op = 1 - smooth01((k - 0.6) / 0.4); }
      else if (p.type === 'z') { sc = p.s * (0.6 + k * 0.7); op = k < 0.15 ? k / 0.15 : 1 - smooth01((k - 0.55) / 0.45); }
      else op = 1 - smooth01((k - 0.65) / 0.35);
      p.el.setAttribute('transform', 'translate(' + f(x) + ' ' + f(p.y) + ') rotate(' + f(p.rot) + ') scale(' + f(sc) + (p.type === 'ripple' ? ' ' + f(sc) : '') + ')');
      p.el.setAttribute('opacity', f(op));
    }
  };

  proto._updateKibbles = function (force) {
    var n = Math.ceil(this.bowls.foodAmount * 12 - 0.001);
    if (!force && n === this._kibN) return;
    this._kibN = n;
    for (var i = 0; i < 12; i++) {
      var el = this.r['kib' + i]; if (!el) continue;
      el.setAttribute('display', i >= 12 - n ? 'inline' : 'none');
    }
  };

  // ---------------------------------------------------------------- ana döngü
  proto._loop = function (now) {
    this._raf = requestAnimationFrame(this._loop);
    if (this._last == null) { this._last = now; return; }
    var dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.paused) return;
    this.t += dt;

    this._tickStats(dt);
    if (this.sleeping && this.autoWake && this.stats.energy >= 99.5 && !this.action) this.wake();

    var mood = this._computeMood();
    if (mood !== this.mood) { var old = this.mood; this.mood = mood; this._emit('mood', { mood: mood, previous: old }); }

    var T = Object.assign({}, POSE_DEFAULT, MOOD_POSES[mood]);
    this._idle(dt, T, mood);

    // aktif aksiyon
    if (this.action) {
      var a = this.action;
      a.t += dt; a.p = a.dur ? clamp(a.t / a.dur, 0, 1) : 0;
      a.update(T, dt, a.p, a.t);
      if (a.dur && a.t >= a.dur) {
        if (a.end) a.end();
        if (!a.silent) this._emit('action', { name: a.name, phase: 'end' });
        this.action = null;
        if (this.queue.length) this._startAction(this.queue.shift());
      }
    }

    this._applyPet(dt, T);
    this._smoothPose(dt, T);
    this._updateBowls(dt);
    this._render(dt);
    this._updateParticles(dt);

    this._statsEmit -= dt;
    if (this._statsEmit <= 0) { this._statsEmit = 1; this._emit('stats', this.getState()); }
  };

  proto._idle = function (dt, T, mood) {
    // göz kırpma
    var b = this.blink;
    b.next -= dt;
    if (b.next <= 0 && b.t < 0) { b.t = 0; b.dur = mood === 'tired' ? 0.5 : 0.18; }
    if (b.t >= 0) {
      b.t += dt;
      if (b.t >= b.dur) { b.t = -1; b.next = Math.random() < 0.2 ? 0.25 : rand(2, 5); }
    }
    // etrafa bakınma
    var lk = this.look;
    lk.next -= dt;
    if (lk.next <= 0) {
      lk.next = rand(1.2, 3.8);
      if (Math.random() < 0.4) { lk.x = 0; lk.y = 0; } else { lk.x = rand(-1, 1); lk.y = rand(-0.6, 0.6); }
    }
    if (!this.sleeping) { T.lookX += lk.x * (mood === 'tired' ? 0.4 : 1); T.lookY += lk.y * 0.6; }
    // kulak seğirmesi
    var et = this.earTwitch;
    et.next -= dt;
    if (et.next <= 0 && et.t < 0) { et.t = 0; et.side = Math.random() < 0.5 ? 0 : 1; }
    if (et.t >= 0) { et.t += dt; if (et.t > 0.35) { et.t = -1; et.next = rand(3, 8); } }

    // ruh haline göre arada bir yapılan hareketler
    if (this.action || this.pet.level > 0.2) return;
    if (this.sleeping) {
      this.fxTimers.z -= dt;
      if (this.fxTimers.z <= 0) {
        this.fxTimers.z = 1.3;
        var hy = SPECIES[this.species].headCY + this.P.headY + 70 * this.P.lie;
        this._spawn('z', this.species === 'cat' ? 300 : 286, hy - 66, { vx: 18, vy: -28, life: 2.6, s: rand(0.8, 1.2), wobble: 6 });
      }
      return;
    }
    if (mood === 'thirsty') {
      this.fxTimers.sweat -= dt;
      if (this.fxTimers.sweat <= 0) {
        this.fxTimers.sweat = rand(2.5, 4.5);
        this._spawn('drop', 278, 96 + this.P.headY, { vy: 22, g: 40, life: 1.4, s: 1.3 });
      }
    }
    this.idleNext -= dt;
    if (this.idleNext > 0) return;
    this.idleNext = rand(6, 11);
    switch (mood) {
      case 'tired': this._startAction(ACTIONS.yawn(this)); this.idleNext = rand(7, 12); break;
      case 'hungry': this._startAction(Math.random() < 0.6 ? ACTIONS.growl(this) : ACTIONS.lickLips(this)); this.idleNext = rand(4.5, 8); break;
      case 'thirsty': this._startAction(ACTIONS.lickLips(this)); break;
      case 'sad': this._startAction(ACTIONS.sigh(this)); break;
      case 'happy': this._startAction(Math.random() < 0.5 ? ACTIONS.hop(this) : ACTIONS.headTilt(this)); break;
      default: this._startAction(Math.random() < 0.5 ? ACTIONS.headTilt(this) : ACTIONS.lickLips(this));
    }
  };

  proto._applyPet = function (dt, T) {
    var pet = this.pet;
    pet.moving -= dt;
    if (pet.moving <= 0) {
      var before = pet.level;
      pet.level = Math.max(0, pet.level - dt * 0.9);
      if (before > 0 && pet.level === 0) this._emit('pet', { phase: 'end' });
    }
    if (pet.level <= 0) return;
    var k = smooth01(pet.level * 1.6);
    var isCat = this.species === 'cat';
    T.blush = Math.max(T.blush, k * 0.85);
    var busy = this.action && this.action.busy;
    if (this.sleeping) {
      T.smile = lerp(T.smile, 0.95, k); T.wagAmp = lerp(T.wagAmp, 6, k); T.wagFreq = lerp(T.wagFreq, 1.2, k);
      return;
    }
    if (busy) return;
    var side = clamp((pet.x - 200) / 110, -1, 1);
    T.eyeOpen = lerp(T.eyeOpen, 0, k);
    T.closedCurve = lerp(T.closedCurve, 1, k);
    T.smile = lerp(T.smile, 1, k);
    T.brow = lerp(T.brow, -0.1, k);
    T.browY = lerp(T.browY, -3, k);
    T.tilt = lerp(T.tilt, side * 13, k);
    T.headX = lerp(T.headX, side * 6, k);
    T.earLift = lerp(T.earLift, isCat ? -0.25 : -0.35, k);
    T.wagFreq = lerp(T.wagFreq, isCat ? 0.8 : 3.4, k);
    T.wagAmp = lerp(T.wagAmp, isCat ? 10 : 24, k);
    T.tailBase = lerp(T.tailBase, -12, k);
    if (isCat) {
      T.whisker = lerp(T.whisker, 1, k);
      pet.purr -= dt;
      if (pet.purr <= 0 && k > 0.5) {
        pet.purr = 1.1;
        this._spawn('text', 280 + rand(-8, 8), 110 + this.P.headY, { text: 'purr', vy: -35, vx: 15, life: 1.4, size: 17, color: '#C46A22' });
      }
    } else {
      T.mouthOpen = lerp(T.mouthOpen, 0.45, k);
      T.tongue = lerp(T.tongue, 0.7, k);
      T.breathRate = lerp(T.breathRate, 1.8, k);
    }
  };

  proto._smoothPose = function (dt, T) {
    var P = this.P;
    for (var key in T) {
      if (!Object.prototype.hasOwnProperty.call(T, key) || key.charAt(0) === '_') continue;
      var sp = POSE_SPEED[key] || 7;
      P[key] += (T[key] - P[key]) * (1 - Math.exp(-sp * dt));
    }
    // ham (yumuşatılmamış) ek değerler
    this.hop = T._hop || 0;
    this.shake = T._shake || 0;
    this.bodySquash = T._squash || 0;
  };

  proto._updateBowls = function (dt) {
    var b = this.bowls;
    var k = 1 - Math.exp(-7 * dt);
    b.food += (b.foodTarget - b.food) * k;
    b.water += (b.waterTarget - b.water) * k;
    if (this.r.foodBowl) {
      this.r.foodBowl.setAttribute('transform', 'translate(0 ' + f((1 - b.food) * 95) + ')');
      this.r.foodBowl.setAttribute('opacity', f(clamp(b.food * 3, 0, 1)));
      this.r.foodBowl.setAttribute('display', b.food < 0.01 ? 'none' : 'inline');
      this.r.waterBowl.setAttribute('transform', 'translate(0 ' + f((1 - b.water) * 95) + ')');
      this.r.waterBowl.setAttribute('opacity', f(clamp(b.water * 3, 0, 1)));
      this.r.waterBowl.setAttribute('display', b.water < 0.01 ? 'none' : 'inline');
      var lvl = b.waterAmount;
      this.r.water.setAttribute('ry', f(4 + lvl * 7));
      this.r.water.setAttribute('rx', f(52 + lvl * 14));
      this.r.water.setAttribute('cy', f(342 - lvl * 4));
    }
  };

  // ---------------------------------------------------------------- çizim
  proto._render = function (dt) {
    var P = this.P, r = this.r, S = SPECIES[this.species];
    this.breathPhase += dt * Math.PI * 2 * P.breathRate;
    this.wagPhase += dt * Math.PI * 2 * P.wagFreq;
    var breath = Math.sin(this.breathPhase) * P.breathAmp;
    var wag = Math.sin(this.wagPhase);

    // kök (zıplama / titreme)
    r.root.setAttribute('transform', 'translate(' + f(this.shake) + ' ' + f(this.hop) + ')');
    r.shadow.setAttribute('rx', f(112 * (1 + P.lie * 0.12) * (1 + this.hop / 140)));
    r.shadow.setAttribute('opacity', f(1 + this.hop / 60));

    // gövde
    var sq = this.bodySquash;
    var sy = (1 - 0.38 * P.lie) * (1 + breath * 0.016) * (1 - sq * 0.08);
    var sx = (1 + 0.1 * P.lie) * (1 - breath * 0.006) * (1 + sq * 0.06);
    r.body.setAttribute('transform', 'translate(200 ' + G + ') scale(' + f(sx) + ' ' + f(sy) + ') translate(-200 -' + G + ')');

    // kuyruk
    r.tail.setAttribute('transform', 'rotate(' + f(P.tailBase + wag * P.wagAmp) + ' 248 344)');

    // bacaklar
    var top = lerp(256, G - 30, P.lie) + breath * 0.6 + sq * 8;
    for (var i = 0; i < 2; i++) {
      r['legPath' + i].setAttribute('d', legShape(S.legs[i], top, G - 14, 17.5, 13));
    }

    // kafa
    var hx = P.headX, hy = P.headY + P.lie * 70 + breath * 1.3 + sq * 6;
    var hs = P.headScale;
    r.head.setAttribute('transform',
      'translate(' + f(hx) + ' ' + f(hy) + ') rotate(' + f(P.tilt) + ' 200 205) translate(200 205) scale(' + f(hs) + ') translate(-200 -205)');

    // kulaklar
    var tw = this.earTwitch.t >= 0 ? Math.sin(this.earTwitch.t / 0.35 * Math.PI * 3) * 8 : 0;
    for (i = 0; i < 2; i++) {
      var twi = this.earTwitch.side === i ? tw : 0;
      if (this.species === 'dog') {
        var a = P.earLift * 24 + wag * P.wagAmp * 0.12 + twi + breath * 0.6;
        r['ear' + i].setAttribute('transform', 'rotate(' + f(a) + ' 136 80)');
      } else {
        var ca = -P.earLift * 18 + twi;
        r['ear' + i].setAttribute('transform', 'rotate(' + f(ca) + ' 150 96)');
      }
    }

    // gözler
    var bl = 0;
    if (this.blink.t >= 0) bl = Math.sin(clamp(this.blink.t / this.blink.dur, 0, 1) * Math.PI);
    var open = clamp(P.eyeOpen * (1 - bl), 0, 1);
    for (i = 0; i < 2; i++) this._renderEye(i, S.eyes[i], open);

    // kaşlar
    for (i = 0; i < 2; i++) {
      var e = S.eyes[i];
      var y = e.cy - e.ry - 12 + P.browY - (1 - open) * 2;
      var s = P.brow, inner = -s * 6, outer = s * 3;
      var d = i === 0
        ? 'M' + (e.cx - 14) + ' ' + f(y + outer) + ' Q' + e.cx + ' ' + f(y - 4) + ' ' + (e.cx + 13) + ' ' + f(y + inner)
        : 'M' + (e.cx - 13) + ' ' + f(y + inner) + ' Q' + e.cx + ' ' + f(y - 4) + ' ' + (e.cx + 14) + ' ' + f(y + outer);
      r['brow' + i].setAttribute('d', d);
    }

    // ağız
    this._renderMouth(S, breath);

    // yanaklar
    r.cheeks.setAttribute('opacity', f(P.blush * 0.75));

    // bıyıklar
    if (r.whisk0) {
      var wa = P.whisker * Math.sin(this.t * 30) * 2 + Math.sin(this.t * 1.7) * 1.5;
      r.whisk0.setAttribute('transform', 'rotate(' + f(wa) + ' 172 184)');
      r.whisk1.setAttribute('transform', 'rotate(' + f(wa) + ' 172 184)');
    }
  };

  proto._renderEye = function (i, e, open) {
    var r = this.r, P = this.P;
    if (open < 0.1) {
      r['eye' + i].setAttribute('display', 'none');
      var c = P.closedCurve;
      r['closed' + i].setAttribute('display', 'inline');
      r['closed' + i].setAttribute('d', 'M' + f(e.cx - e.rx * 0.85) + ' ' + f(e.cy + 2) + ' Q' + e.cx + ' ' + f(e.cy + 2 - 15 * c) + ' ' + f(e.cx + e.rx * 0.85) + ' ' + f(e.cy + 2));
      return;
    }
    r['eye' + i].setAttribute('display', 'inline');
    r['closed' + i].setAttribute('display', 'none');
    var px = e.cx + P.lookX * e.rx * 0.32, py = e.cy + P.lookY * e.ry * 0.28;
    var pup = r['pupil' + i];
    if (this.species === 'cat') {
      r['iris' + i].setAttribute('cx', f(px)); r['iris' + i].setAttribute('cy', f(py));
      pup.setAttribute('cx', f(px)); pup.setAttribute('cy', f(py));
      pup.setAttribute('rx', f(3.5 + P.pupil * 8));
    } else {
      pup.setAttribute('cx', f(px)); pup.setAttribute('cy', f(py));
      pup.setAttribute('rx', f(11 + P.pupil * 2.5)); pup.setAttribute('ry', f(13 + P.pupil * 2.5));
    }
    r['hl' + i + 'a'].setAttribute('cx', f(px + 5)); r['hl' + i + 'a'].setAttribute('cy', f(py - 6));
    r['hl' + i + 'b'].setAttribute('cx', f(px - 4)); r['hl' + i + 'b'].setAttribute('cy', f(py + 5));

    var x0 = e.cx - e.rx - 4, x1 = e.cx + e.rx + 4;
    var lidY = lerp(e.cy + e.ry + 2, e.cy - e.ry - 3, open);
    var curve = e.ry * 0.35;
    r['lid' + i].setAttribute('d', 'M' + x0 + ' ' + (e.cy - e.ry - 8) + ' L' + x1 + ' ' + (e.cy - e.ry - 8) +
      ' L' + x1 + ' ' + f(lidY) + ' Q' + e.cx + ' ' + f(lidY + curve) + ' ' + x0 + ' ' + f(lidY) + 'Z');
    r['lidEdge' + i].setAttribute('d', open > 0.96 ? '' : 'M' + x0 + ' ' + f(lidY) + ' Q' + e.cx + ' ' + f(lidY + curve) + ' ' + x1 + ' ' + f(lidY));
    var sq = P.squint;
    var lowY = lerp(e.cy + e.ry + 3, e.cy + e.ry * 0.15, sq);
    r['low' + i].setAttribute('d', 'M' + x0 + ' ' + (e.cy + e.ry + 8) + ' L' + x1 + ' ' + (e.cy + e.ry + 8) +
      ' L' + x1 + ' ' + f(lowY) + ' Q' + e.cx + ' ' + f(lowY - e.ry * 0.3) + ' ' + x0 + ' ' + f(lowY) + 'Z');
    r['lowEdge' + i].setAttribute('d', sq < 0.05 ? '' : 'M' + x0 + ' ' + f(lowY) + ' Q' + e.cx + ' ' + f(lowY - e.ry * 0.3) + ' ' + x1 + ' ' + f(lowY));
  };

  proto._renderMouth = function (S, breath) {
    var r = this.r, P = this.P, m = S.mouth;
    var open = clamp(P.mouthOpen, 0, 1.2);
    var hw = m.hw * (1 + open * 0.25);
    var cy = m.y - P.smile * 6;
    var ctrlY = m.y + 3 + 5 * P.smile;
    var Lx = m.x - hw, Rx = m.x + hw;
    var line = 'M' + f(Lx) + ' ' + f(cy) + ' Q' + f(m.x - hw * 0.5) + ' ' + f(ctrlY) + ' ' + m.x + ' ' + m.y +
               ' Q' + f(m.x + hw * 0.5) + ' ' + f(ctrlY) + ' ' + f(Rx) + ' ' + f(cy);
    r.mouthLine.setAttribute('d', line);

    if (open > 0.03) {
      var D = m.depth * open;
      var shape = 'M' + f(Lx) + ' ' + f(cy) + ' C' + f(Lx - 2) + ' ' + f(m.y + D * 1.25) + ' ' + f(Rx + 2) + ' ' + f(m.y + D * 1.25) + ' ' + f(Rx) + ' ' + f(cy) +
                  ' Q' + f(m.x + hw * 0.5) + ' ' + f(ctrlY) + ' ' + m.x + ' ' + m.y + ' Q' + f(m.x - hw * 0.5) + ' ' + f(ctrlY) + ' ' + f(Lx) + ' ' + f(cy) + 'Z';
      r.mouthOpen.setAttribute('d', shape);
      r.mouthClip.setAttribute('d', shape);
      r.mouthOpen.setAttribute('display', 'inline');
      r.mouthTongue.setAttribute('cx', m.x); r.mouthTongue.setAttribute('cy', f(m.y + D * 0.95));
      r.mouthTongue.setAttribute('rx', f(hw * 0.75)); r.mouthTongue.setAttribute('ry', f(D * 0.42));
    } else {
      r.mouthOpen.setAttribute('display', 'none');
      r.mouthTongue.setAttribute('rx', '0');
    }

    var tg = clamp(P.tongue, 0, 1.3);
    if (tg > 0.05) {
      var w = S.tongueW, x = m.x + P.tongueX * 9;
      var ys = m.y + 1 + open * m.depth * 0.45;
      var len = tg * (this.species === 'dog' ? 26 : 16) + Math.max(0, breath) * (P.breathRate > 1 ? 2 : 0);
      var yb = ys + len;
      r.tongue.setAttribute('d', 'M' + f(x - w) + ' ' + f(ys) + ' L' + f(x - w) + ' ' + f(yb) +
        ' Q' + f(x - w) + ' ' + f(yb + w * 1.25) + ' ' + f(x) + ' ' + f(yb + w * 1.25) +
        ' Q' + f(x + w) + ' ' + f(yb + w * 1.25) + ' ' + f(x + w) + ' ' + f(yb) + ' L' + f(x + w) + ' ' + f(ys) + 'Z');
      r.tongueLine.setAttribute('d', 'M' + f(x) + ' ' + f(ys + 3) + ' L' + f(x) + ' ' + f(yb + w * 0.5));
      r.tongueOut.setAttribute('display', 'inline');
    } else {
      r.tongueOut.setAttribute('display', 'none');
    }
  };

  // ================================================================ Aksiyon tanımları
  // Her aksiyon: { name, dur, busy, silent, start(), update(T, dt, p, t), end(), cancel() }
  var ACTIONS = {
    eat: function (pet) {
      var dips = 0, lastCycle = -1;
      return {
        name: 'eat', dur: 5.6, busy: true,
        start: function () { pet.bowls.foodAmount = 1; pet._updateKibbles(true); pet.bowls.foodTarget = 1; },
        update: function (T, dt, p, t) {
          T.wagFreq = 2.8; T.wagAmp = 20; T.tailBase = -10; T.earLift = 0.2; T.brow = 0; T.lie = 0;
          if (t < 0.7) { // kaba bakar, heyecanlanır
            T.lookY = 1; T.lookX = 0; T.smile = 1; T.mouthOpen = 0.25; T.tongue = 0.35; T.pupil = 1;
            T.headY = 10 * smooth01(t / 0.7);
            return;
          }
          if (t < 4.6) { // yeme döngüsü
            var c = (t - 0.7) / 1.3, cyc = Math.floor(c), u = c - cyc;
            if (cyc !== lastCycle) { lastCycle = cyc; dips++; }
            var down = u < 0.4 ? smooth01(u / 0.2) : 1 - smooth01((u - 0.4) / 0.2);
            T.headY = lerp(98, 128, down); T.headScale = 0.94; T.tilt = Math.sin(t * 2) * 3;
            T.lookY = 1; T.squint = 0.5; T.eyeOpen = 0.55; T.smile = 0.6;
            if (u > 0.38 && u < 0.42 && !this._crumbed) {
              this._crumbed = true;
              pet.bowls.foodAmount = Math.max(0, pet.bowls.foodAmount - 1 / 3.2); pet._updateKibbles();
              for (var i = 0; i < 4; i++) pet._spawn('crumb', 200 + rand(-30, 30), 322, { vx: rand(-60, 60), vy: rand(-110, -60), g: 320, life: 0.8 });
            }
            if (u > 0.5) this._crumbed = false;
            if (u > 0.55) { T.mouthOpen = 0.12 + 0.28 * Math.max(0, Math.sin(t * 15)); T.headY += Math.sin(t * 15) * 1.5; }
            else T.mouthOpen = 0;
            T.tongue = 0;
            return;
          }
          // bitti: başını kaldırır, dudaklarını yalar
          pet.bowls.foodTarget = 0;
          T.headY = 0; T.smile = 1; T.squint = 0.6; T.eyeOpen = 0.6; T.blush = 0.5;
          T.mouthOpen = 0.12; T.tongue = 0.6; T.tongueX = Math.sin(t * 9);
        },
        end: function () {
          pet.bowls.foodTarget = 0;
          pet.stats.fullness = Math.min(100, pet.stats.fullness + 35);
          pet.stats.happiness = Math.min(100, pet.stats.happiness + 5);
          pet._spawn('heart', 240, 80, { vy: -50, s: 1.1 });
          pet._emit('stats', pet.getState());
        },
        cancel: function () { pet.bowls.foodTarget = 0; }
      };
    },

    drink: function (pet) {
      return {
        name: 'drink', dur: 5, busy: true,
        start: function () { pet.bowls.waterAmount = 1; pet.bowls.waterTarget = 1; this.rip = 0; },
        update: function (T, dt, p, t) {
          T.wagFreq = 2; T.wagAmp = 14; T.earLift = 0.1; T.brow = 0; T.lie = 0;
          if (t < 0.7) {
            T.lookY = 1; T.lookX = 0; T.smile = 0.8; T.mouthOpen = 0.3; T.tongue = 0.5; T.pupil = 0.9;
            T.headY = 10 * smooth01(t / 0.7);
            return;
          }
          if (t < 4) { // dil ile su içme (lap lap)
            var lap = Math.sin(t * 22);
            T.headY = 112 + lap * 2.5; T.headScale = 0.94; T.lookY = 1; T.eyeOpen = 0.5; T.squint = 0.4;
            T.mouthOpen = 0.35; T.tongue = 0.6 + 0.6 * Math.max(0, lap); T.smile = 0.5;
            pet.bowls.waterAmount = Math.max(0.15, 1 - (t - 0.7) / 3.3 * 0.85);
            this.rip -= dt;
            if (this.rip <= 0) {
              this.rip = 0.28;
              pet._spawn('ripple', 200 + rand(-12, 12), 340 - pet.bowls.waterAmount * 4, { life: 0.9 });
              if (Math.random() < 0.6) pet._spawn('drop', 200 + rand(-25, 25), 330, { vx: rand(-50, 50), vy: rand(-120, -80), g: 380, life: 0.7, s: 0.8 });
            }
            return;
          }
          pet.bowls.waterTarget = 0;
          T.headY = 0; T.smile = 1; T.squint = 0.5; T.eyeOpen = 0.65; T.mouthOpen = 0.1; T.tongue = 0.5; T.tongueX = Math.sin(t * 9);
          if (!this.dripped) {
            this.dripped = true;
            for (var i = 0; i < 3; i++) pet._spawn('drop', 200 + rand(-8, 8), 205, { vy: rand(10, 40), g: 300, life: 0.9, s: 0.7 });
          }
        },
        end: function () {
          pet.bowls.waterTarget = 0;
          pet.stats.hydration = Math.min(100, pet.stats.hydration + 40);
          pet.stats.happiness = Math.min(100, pet.stats.happiness + 3);
          pet._spawn('sparkle', 250, 90, { vy: -40, s: 1.1, vr: 90 });
          pet._emit('stats', pet.getState());
        },
        cancel: function () { pet.bowls.waterTarget = 0; }
      };
    },

    yawn: function (pet) {
      return {
        name: 'yawn', dur: 2.2, silent: true,
        update: function (T, dt, p) {
          var o = bump(p, 0.15, 0.85, 0.3);
          T.mouthOpen = lerp(T.mouthOpen, 1.1, o);
          T.tongue = lerp(T.tongue, 0, o);
          T.eyeOpen = lerp(T.eyeOpen, 0, smooth01(o * 1.6));
          T.closedCurve = 0.2;
          T.headY = lerp(T.headY, -10, o); T.tilt = lerp(T.tilt, -6, o);
          T.browY = -5 * o; T.brow = lerp(T.brow, 0.4, o);
          T.earLift = lerp(T.earLift, -0.5, o);
          if (p > 0.85) { T.mouthOpen = 0.1 * Math.max(0, Math.sin(p * 60)); T.smile = 0.3; }
        }
      };
    },

    fallAsleep: function (pet) {
      return {
        name: 'sleep', dur: 1.2,
        start: function () { pet.sleeping = true; pet._emit('sleep', {}); },
        update: function () { /* uyku pozu MOOD_POSES.sleeping ile gelir */ }
      };
    },

    wake: function (pet) {
      return {
        name: 'wake', dur: 2.8, busy: true,
        start: function () { pet.sleeping = false; pet._emit('wake', {}); },
        update: function (T, dt, p, t) {
          if (t < 0.8) { T.lie = 1; T.eyeOpen = 0; T.closedCurve = -1; T.earLift = lerp(-0.7, 0.4, t / 0.8); T.wagAmp = 2; return; }
          if (t < 1.5) { // gözlerini yavaşça açar
            T.lie = 1 - smooth01((t - 0.8) / 0.7);
            T.eyeOpen = 0.35 + 0.2 * Math.sin(t * 9); T.smile = 0.2; T.brow = 0.3;
            return;
          }
          // gerinme + esneme
          var o = bump(t, 1.5, 2.6, 0.3);
          T.lie = 0; T.headY = -12 * o; T.tilt = -5 * o; T.mouthOpen = 1.05 * o; T.eyeOpen = lerp(0.6, 0, o);
          T.closedCurve = 0.2; T._squash = -0.3 * o; T.smile = 0.5;
        }
      };
    },

    stir: function (pet) { // uyurken dokunulursa
      return {
        name: 'stir', dur: 1.3, silent: true,
        update: function (T, dt, p) {
          var o = bump(p, 0, 1, 0.3);
          T.smile = lerp(T.smile, 0.9, o); T.tilt = lerp(T.tilt, 14, o); T.mouthOpen = 0.12 * o * Math.max(0, Math.sin(p * 20));
          T.earLift = lerp(T.earLift, 0, o); T.blush = 0.5 * o;
        }
      };
    },

    boop: function (pet) { // başına dokunma
      return {
        name: 'boop', dur: 0.9, silent: true,
        update: function (T, dt, p) {
          var o = bump(p, 0, 1, 0.25);
          T.eyeOpen = lerp(T.eyeOpen, 0, o); T.closedCurve = 1; T.smile = 1; T.mouthOpen = 0.35 * o;
          T.earLift = lerp(T.earLift, 0.6, o); T.blush = 0.7 * o; T._squash = 0.5 * Math.sin(p * Math.PI);
          T.wagFreq = 3; T.wagAmp = 20;
        }
      };
    },

    hop: function (pet) { // mutluluk zıplaması
      return {
        name: 'hop', dur: 0.95, silent: true,
        update: function (T, dt, p) {
          T._hop = p > 0.15 && p < 0.85 ? -Math.sin((p - 0.15) / 0.7 * Math.PI) * 26 : 0;
          T._squash = p < 0.15 ? Math.sin(p / 0.15 * Math.PI) * 0.8 : p > 0.85 ? Math.sin((p - 0.85) / 0.15 * Math.PI) * 0.8 : -0.2;
          T.smile = 1; T.mouthOpen = 0.45; T.tongue = pet.species === 'dog' ? 0.4 : 0;
          T.eyeOpen = 0; T.closedCurve = 1; T.earLift = 0.6; T.wagFreq = 3.5; T.wagAmp = 22;
        }
      };
    },

    celebrate: function (pet) { // uygulamada bir başarı olduğunda
      return {
        name: 'celebrate', dur: 2.2,
        update: function (T, dt, p, t) {
          var c = (t % 0.73) / 0.73;
          T._hop = -Math.sin(c * Math.PI) * 30;
          T._squash = c < 0.1 || c > 0.9 ? 0.6 : -0.2;
          T.smile = 1; T.mouthOpen = 0.55; T.eyeOpen = 0; T.closedCurve = 1; T.blush = 0.7;
          T.earLift = 0.8; T.wagFreq = 4; T.wagAmp = 26; T.tilt = Math.sin(t * 6) * 6;
          if (Math.random() < dt * 9) pet._spawn(Math.random() < 0.5 ? 'sparkle' : 'heart', rand(90, 310), rand(60, 180), { vy: -50, vr: 120, s: rand(0.7, 1.2) });
        }
      };
    },

    growl: function (pet) { // karın guruldaması
      return {
        name: 'growl', dur: 1.6, silent: true,
        start: function () {
          pet._spawn('growl', 200, 300, { vy: -10, life: 1.2, s: 1.2 });
          pet._spawn('text', 255, 288, { text: 'gurr', vy: -25, life: 1.3, size: 17 });
        },
        update: function (T, dt, p, t) {
          var o = bump(p, 0.05, 0.75, 0.2);
          T._shake = Math.sin(t * 70) * 2.2 * o;
          T.lookY = 1; T.lookX = 0; T.brow = 1; T.smile = -0.8; T.headY = 10 * o;
          T.mouthOpen = 0.1 * o; T.earLift = -0.8;
        }
      };
    },

    lickLips: function (pet) {
      return {
        name: 'lickLips', dur: 1.3, silent: true,
        update: function (T, dt, p, t) {
          var o = bump(p, 0, 1, 0.25);
          T.tongue = 0.55 * o; T.tongueX = Math.sin(t * 10) * o; T.mouthOpen = Math.max(T.mouthOpen * (1 - o), 0.12 * o);
          T.squint = 0.3 * o; T.smile = lerp(T.smile, 0.5, o); T.lookY = lerp(T.lookY, -0.4, o);
        }
      };
    },

    sigh: function (pet) {
      return {
        name: 'sigh', dur: 2, silent: true,
        update: function (T, dt, p) {
          var o = bump(p, 0, 1, 0.35);
          T.eyeOpen = lerp(T.eyeOpen, 0.35, o); T.headY += 10 * o; T._squash = -0.2 * o + 0.3 * bump(p, 0.5, 0.9, 0.5);
          T.lookY = 0.8; T.mouthOpen = 0.12 * bump(p, 0.5, 0.9, 0.5);
        }
      };
    },

    headTilt: function (pet) { // meraklı kafa eğme
      var dir = Math.random() < 0.5 ? -1 : 1;
      return {
        name: 'headTilt', dur: 1.8, silent: true,
        update: function (T, dt, p) {
          var o = bump(p, 0, 1, 0.3);
          T.tilt += 14 * dir * o; T.earLift += 0.4 * o; T.pupil = lerp(T.pupil, 1, o);
          T.lookX = -dir * 0.3; T.lookY = -0.2; T.mouthOpen = 0.1 * o; T.browY = -4 * o;
        }
      };
    }
  };

  PetEngine.ACTIONS = Object.keys(ACTIONS);
  PetEngine.PALETTES = PALETTES;
  PetEngine.MOODS = Object.keys(MOOD_POSES);
  return PetEngine;
});
