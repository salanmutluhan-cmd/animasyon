/*!
 * PetEngine v3 — iki ayak üstünde duran 2D cartoon köpek & kedi bakım animasyon motoru
 * Bağımlılık yok. SVG + requestAnimationFrame ile prosedürel animasyon.
 *
 *   const pet = new PetEngine(document.getElementById('pet'), { breed: 'golden' });
 *   pet.feed(); pet.feedTreat(); pet.giveWater(); pet.bathe(); pet.throwBall(); pet.sleep(); pet.wake();
 *   pet.setBreed('dalmatian'); pet.setEyes('blue');
 *   pet.on('stats', s => console.log(s));
 *
 * Ekrandaki araçlar (alt tepsi): Mama (ağza götür), Su (hayvana ver), Top (fırlat), Duş (hayvanın üstüne götür).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const G = 460; // hayvanın yerel koordinatlarında zemin

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const rand = (a, b) => a + Math.random() * (b - a);
  const f = (n) => Math.round(n * 10) / 10;
  function bump(p, a, b, edge) {
    edge = edge || 0.15;
    if (p < a || p > b) return 0;
    const w = (b - a) * edge;
    return smooth01((p - a) / w) * smooth01((b - p) / w);
  }
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  // ---------------------------------------------------------------- renk yardımcıları
  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }
  function lum(c) { const [r, g, b] = hexRgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  // ================================================================ Geometri
  function parsePath(d) {
    const segs = [], re = /([MLCQZ])([^MLCQZ]*)/gi;
    let m;
    while ((m = re.exec(d))) segs.push([m[1].toUpperCase(), (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number)]);
    return segs;
  }
  function samplePath(d, step, count) {
    const raw = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const [c, n] of parsePath(d)) {
      if (c === 'M') { cx = n[0]; cy = n[1]; sx = cx; sy = cy; raw.push([cx, cy]); for (let i = 2; i < n.length; i += 2) { cx = n[i]; cy = n[i + 1]; raw.push([cx, cy]); } }
      else if (c === 'L') { for (let i = 0; i < n.length; i += 2) { cx = n[i]; cy = n[i + 1]; raw.push([cx, cy]); } }
      else if (c === 'C') {
        for (let i = 0; i < n.length; i += 6) {
          const x0 = cx, y0 = cy;
          for (let k = 1; k <= 16; k++) {
            const t = k / 16, u = 1 - t;
            raw.push([u * u * u * x0 + 3 * u * u * t * n[i] + 3 * u * t * t * n[i + 2] + t * t * t * n[i + 4],
                      u * u * u * y0 + 3 * u * u * t * n[i + 1] + 3 * u * t * t * n[i + 3] + t * t * t * n[i + 5]]);
          }
          cx = n[i + 4]; cy = n[i + 5];
        }
      } else if (c === 'Q') {
        for (let i = 0; i < n.length; i += 4) {
          const x0 = cx, y0 = cy;
          for (let k = 1; k <= 12; k++) {
            const t = k / 12, u = 1 - t;
            raw.push([u * u * x0 + 2 * u * t * n[i] + t * t * n[i + 2], u * u * y0 + 2 * u * t * n[i + 1] + t * t * n[i + 3]]);
          }
          cx = n[i + 2]; cy = n[i + 3];
        }
      } else if (c === 'Z') { raw.push([sx, sy]); cx = sx; cy = sy; }
    }
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const L = cum[cum.length - 1];
    const N = count || Math.max(6, Math.round(L / step));
    const out = [];
    let j = 1;
    for (let i = 0; i < N; i++) {
      const s = (i / N) * L;
      while (j < cum.length - 1 && cum[j] < s) j++;
      const seg = cum[j] - cum[j - 1] || 1, t = (s - cum[j - 1]) / seg;
      out.push([lerp(raw[j - 1][0], raw[j][0], t), lerp(raw[j - 1][1], raw[j][1], t)]);
    }
    return out;
  }
  // Yumuşak tüy: yuvarlak kabarık tutamlar, uçları hafifçe aşağı akar (sivri diken yok)
  function furD(pts, o) {
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    const seed = o.seed || 1;
    let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (let i = 0; i < n; i++) {
      const A = pts[i], B = pts[(i + 1) % n];
      const tx = B[0] - A[0], ty = B[1] - A[1], len = Math.hypot(tx, ty) || 1;
      const ux = tx / len, uy = ty / len;
      const nx = uy * sgn, ny = -ux * sgn; // dışa bakan normal
      const k = o.amount ? o.amount((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, nx, ny, i, n) : 1;
      if (k <= 0.02) { d += ' L' + f(B[0]) + ' ' + f(B[1]); continue; }
      const h = (o.h + hash(i * 7.3 + seed) * (o.hv || 0)) * k;
      const fl = (o.flow || 0) * h;
      const tx2 = B[0] + nx * h * 0.3 + ux * len * 0.06, ty2 = B[1] + ny * h * 0.3 + uy * len * 0.06 + fl * 0.55;
      d += ' C' + f(A[0] + nx * h * 1.15 + ux * len * 0.05) + ' ' + f(A[1] + ny * h * 1.15 + uy * len * 0.05 + fl * 0.3) +
           ' ' + f(B[0] + nx * h * 1.05 - ux * len * 0.15) + ' ' + f(B[1] + ny * h * 1.05 - uy * len * 0.15 + fl * 0.6) +
           ' ' + f(tx2) + ' ' + f(ty2) +
           ' Q' + f(B[0] + nx * h * 0.05) + ' ' + f(B[1] + ny * h * 0.05 + fl * 0.1) + ' ' + f(B[0]) + ' ' + f(B[1]);
    }
    return d + 'Z';
  }
  function ellipseD(cx, cy, rx, ry) {
    const k = 0.5523;
    return 'M' + (cx - rx) + ' ' + cy +
      ' C' + (cx - rx) + ' ' + (cy - k * ry) + ' ' + (cx - k * rx) + ' ' + (cy - ry) + ' ' + cx + ' ' + (cy - ry) +
      ' C' + (cx + k * rx) + ' ' + (cy - ry) + ' ' + (cx + rx) + ' ' + (cy - k * ry) + ' ' + (cx + rx) + ' ' + cy +
      ' C' + (cx + rx) + ' ' + (cy + k * ry) + ' ' + (cx + k * rx) + ' ' + (cy + ry) + ' ' + cx + ' ' + (cy + ry) +
      ' C' + (cx - k * rx) + ' ' + (cy + ry) + ' ' + (cx - rx) + ' ' + (cy + k * ry) + ' ' + (cx - rx) + ' ' + cy + 'Z';
  }
  const fur = (d, o) => furD(samplePath(d, o.step || 10, o.count), o);
  // Ön pati (ayak): kubbe + 4 parmak çıkıntısı, alt kenar y
  function pawD(x, y, w) {
    let d = 'M' + f(x + w) + ' ' + f(y - 5) + ' C' + f(x + w) + ' ' + f(y - 26) + ' ' + f(x - w) + ' ' + f(y - 26) + ' ' + f(x - w) + ' ' + f(y - 5);
    const tw = (2 * w) / 4;
    for (let j = 0; j < 4; j++) {
      const x1 = x - w + j * tw, x2 = x1 + tw;
      d += ' Q' + f(x1 - 1) + ' ' + f(y + 4) + ' ' + f(x1 + tw / 2) + ' ' + f(y + 2) + ' Q' + f(x2 + 1) + ' ' + f(y + 4) + ' ' + f(x2) + ' ' + f(j === 3 ? y - 5 : y - 3);
    }
    return d + 'Z';
  }
  function toeLines(x, y, w) {
    const tw = (2 * w) / 4;
    let d = '';
    for (let j = 1; j < 4; j++) { const xx = x - w + j * tw; d += 'M' + f(xx) + ' ' + f(y - 3) + ' L' + f(xx + (j - 2) * 0.8) + ' ' + f(y - 11) + ' '; }
    return d;
  }
  // İki kemikli kol/bacak için ters kinematik (dirsek dışa doğru)
  function ik(sx, sy, tx, ty, L1, L2, sign) {
    let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy);
    const max = L1 + L2 - 0.5;
    if (d > max) { dx *= max / d; dy *= max / d; d = max; }
    if (d < 12) { const k = 12 / (d || 1); dx *= k; dy *= k; d = 12; }
    const a = Math.atan2(dy, dx);
    const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const ang = a + sign * A;
    return { ex: sx + Math.cos(ang) * L1, ey: sy + Math.sin(ang) * L1, hx: sx + dx, hy: sy + dy };
  }

  // ================================================================ Cinsler ve göz renkleri
  const EYES = {
    brown:    { name: 'Kahverengi', c: '#7A4A26' },
    darkbrown:{ name: 'Koyu kahve', c: '#3E2414' },
    hazel:    { name: 'Ela', c: '#9A7A34' },
    green:    { name: 'Yeşil', c: '#76B33C' },
    emerald:  { name: 'Zümrüt', c: '#2E9E6A' },
    blue:     { name: 'Mavi', c: '#3F92DE' },
    iceblue:  { name: 'Buz mavisi', c: '#8ED0F2' },
    amber:    { name: 'Kehribar', c: '#E0A229' },
    yellow:   { name: 'Sarı', c: '#E6C532' },
    copper:   { name: 'Bakır', c: '#D97A2B' },
    grey:     { name: 'Gri', c: '#8E99A6' },
    odd:      { name: 'Ela-Mavi (Van)', l: '#3F92DE', r: '#E0A229' },
    oddgreen: { name: 'Mavi-Yeşil', l: '#3F92DE', r: '#76B33C' }
  };

  // Gerçek cinslere göre renk ve desen kombinasyonları
  const BREEDS = {
    // ---- köpekler
    golden:     { species: 'dog', name: 'Golden Retriever', eyes: 'brown', ears: 'floppy', fluff: 1.35, muzzle: 'light', paws: 'fur', pattern: [],
                  colors: { fur: '#E6AE5E', furShade: '#C98C3C', light: '#F8E2BC', ear: '#D69A45' } },
    kangal:     { species: 'dog', name: 'Kangal', eyes: 'amber', ears: 'floppy', fluff: 1, muzzle: 'mask', paws: 'fur', pattern: ['mask'],
                  colors: { fur: '#E4CF9E', furShade: '#C6AE78', light: '#F3E8CA', ear: '#3B302A', mask: '#3B302A' } },
    dalmatian:  { species: 'dog', name: 'Dalmaçyalı', eyes: 'brown', ears: 'floppy', fluff: 0.8, muzzle: 'fur', paws: 'fur', pattern: ['spots'],
                  colors: { fur: '#FAF9F5', furShade: '#DCDAD3', light: '#FFFFFF', ear: '#2A2726', spot: '#272322', nose: '#272322' } },
    husky:      { species: 'dog', name: 'Sibirya Kurdu (Husky)', eyes: 'iceblue', ears: 'pointy', fluff: 1.3, muzzle: 'light', paws: 'light', pattern: ['husky'],
                  colors: { fur: '#7E8898', furShade: '#5E6878', light: '#FFFFFF', ear: '#6C7686', earInner: '#F4CBD3', nose: '#2A2628' } },
    bulldog:    { species: 'dog', name: 'İngiliz Bulldog', eyes: 'darkbrown', ears: 'floppySmall', fluff: 0.7, muzzle: 'light', paws: 'light', pattern: ['blaze', 'wrinkles'],
                  colors: { fur: '#D6A267', furShade: '#B67F45', light: '#FBF4EA', ear: '#B9824A' } },
    beagle:     { species: 'dog', name: 'Beagle', eyes: 'brown', ears: 'floppy', fluff: 0.8, muzzle: 'light', paws: 'light', pattern: ['saddle', 'blaze'],
                  colors: { fur: '#C9853F', furShade: '#A8692C', light: '#FFFFFF', ear: '#9C5B26', saddle: '#2E2622' } },
    pug:        { species: 'dog', name: 'Pug', eyes: 'darkbrown', ears: 'floppySmall', fluff: 0.7, muzzle: 'mask', paws: 'fur', pattern: ['mask', 'wrinkles'],
                  colors: { fur: '#E6CA97', furShade: '#C8A973', light: '#F2E2C0', ear: '#2B2420', mask: '#2B2420' } },
    labrador:   { species: 'dog', name: 'Siyah Labrador', eyes: 'brown', ears: 'floppy', fluff: 0.9, muzzle: 'fur', paws: 'fur', pattern: [],
                  colors: { fur: '#33302E', furShade: '#211E1D', light: '#46413E', ear: '#2A2726', nose: '#141010', pad: '#4A3E3E' } },
    collie:     { species: 'dog', name: 'Border Collie', eyes: 'hazel', ears: 'floppySmall', fluff: 1.3, muzzle: 'light', paws: 'light', pattern: ['blaze'],
                  colors: { fur: '#2C2826', furShade: '#1C1918', light: '#FFFFFF', ear: '#2C2826', nose: '#1A1414' } },
    shiba:      { species: 'dog', name: 'Shiba Inu', eyes: 'darkbrown', ears: 'pointy', fluff: 1.1, muzzle: 'light', paws: 'light', pattern: ['urajiro'],
                  colors: { fur: '#D9873F', furShade: '#B86A28', light: '#FBF0DC', ear: '#D9873F', earInner: '#F8DCC0' } },
    rottweiler: { species: 'dog', name: 'Rottweiler', eyes: 'darkbrown', ears: 'floppySmall', fluff: 0.8, muzzle: 'light', paws: 'light', pattern: ['tan'],
                  colors: { fur: '#2A2422', furShade: '#1A1615', light: '#B8692E', tan: '#B8692E', ear: '#231E1D', nose: '#141010', pad: '#4A3E3E' } },
    pomeranian: { species: 'dog', name: 'Pomeranian', eyes: 'darkbrown', ears: 'pointy', fluff: 1.8, muzzle: 'light', paws: 'fur', pattern: [],
                  colors: { fur: '#F0A44C', furShade: '#D4862F', light: '#FCE3BE', ear: '#E89A40', earInner: '#F8D2B0' } },
    // ---- kediler
    tabby:      { species: 'cat', name: 'Sarman (Tekir)', eyes: 'green', ears: 'pointy', fluff: 1, muzzle: 'light', paws: 'light', pattern: ['tabby'],
                  colors: { fur: '#F5A85C', furShade: '#D9802F', light: '#FFF7EC', stripe: '#D47528' } },
    van:        { species: 'cat', name: 'Van Kedisi', eyes: 'odd', ears: 'pointy', fluff: 1.35, muzzle: 'light', paws: 'fur', pattern: ['van'],
                  colors: { fur: '#FBF8F2', furShade: '#E4DCCE', light: '#FFFFFF', patch: '#D88A48' } },
    ankara:     { species: 'cat', name: 'Ankara Kedisi', eyes: 'blue', ears: 'pointy', fluff: 1.7, muzzle: 'light', paws: 'fur', pattern: [],
                  colors: { fur: '#FFFFFF', furShade: '#E5E2EC', light: '#FFFFFF', earInner: '#FFC4D0' } },
    british:    { species: 'cat', name: 'British Shorthair', eyes: 'copper', ears: 'pointy', fluff: 1.1, muzzle: 'fur', paws: 'fur', pattern: [],
                  colors: { fur: '#8E98A7', furShade: '#6F798A', light: '#A9B2BF', earInner: '#CFA8B2', nose: '#6E7382', pad: '#8C7F86' } },
    siamese:    { species: 'cat', name: 'Siyam', eyes: 'blue', ears: 'pointy', fluff: 0.8, muzzle: 'fur', paws: 'point', pattern: ['points'],
                  colors: { fur: '#F3E6D2', furShade: '#D9C5A6', light: '#FBF4E8', point: '#4A362C', ear: '#4A362C', earInner: '#8A6A5C', nose: '#4A362C' } },
    tuxedo:     { species: 'cat', name: 'Smokin (Siyah-Beyaz)', eyes: 'amber', ears: 'pointy', fluff: 1, muzzle: 'light', paws: 'light', pattern: ['catBlaze'],
                  colors: { fur: '#2A2626', furShade: '#191616', light: '#FFFFFF', earInner: '#B88894', nose: '#FF8FA3' } },
    calico:     { species: 'cat', name: 'Üç Renkli (Calico)', eyes: 'amber', ears: 'pointy', fluff: 1, muzzle: 'light', paws: 'light', pattern: ['calico'],
                  colors: { fur: '#FFFFFF', furShade: '#E7E1D8', light: '#FFFFFF', patchA: '#E8963F', patchB: '#2E2724' } },
    black:      { species: 'cat', name: 'Siyah Kedi', eyes: 'yellow', ears: 'pointy', fluff: 1, muzzle: 'fur', paws: 'fur', pattern: [],
                  colors: { fur: '#272325', furShade: '#151314', light: '#38323A', nose: '#4A4045', earInner: '#5C4A52', pad: '#4A3E44' } },
    silver:     { species: 'cat', name: 'Gri Tekir', eyes: 'green', ears: 'pointy', fluff: 1, muzzle: 'light', paws: 'light', pattern: ['tabby'],
                  colors: { fur: '#AEB4BD', furShade: '#8A919C', light: '#F1F2F5', stripe: '#515862', nose: '#C98A95' } },
    mainecoon:  { species: 'cat', name: 'Maine Coon', eyes: 'amber', ears: 'pointy', fluff: 1.8, muzzle: 'light', paws: 'light', pattern: ['tabby', 'earTufts'],
                  colors: { fur: '#9A7552', furShade: '#76573A', light: '#EDE1CF', stripe: '#4A3424' } },
    scottish:   { species: 'cat', name: 'Scottish Fold', eyes: 'copper', ears: 'folded', fluff: 1.1, muzzle: 'light', paws: 'light', pattern: [],
                  colors: { fur: '#CBC3B8', furShade: '#AAA095', light: '#F4F0EA' } }
  };
  const DEFAULT_BREED = { dog: 'golden', cat: 'tabby' };

  function resolveColors(b, eyesId, custom) {
    const C = Object.assign({}, b.colors, custom || {});
    C.line = C.line || '#4A2C22';
    C.furShade = C.furShade || mix(C.fur, '#000000', 0.18);
    C.furDeep = C.furDeep || mix(C.furShade, '#000000', 0.2);
    C.light = C.light || mix(C.fur, '#ffffff', 0.7);
    C.lightShade = C.lightShade || mix(C.light, '#8A6A50', 0.16);
    C.ear = C.ear || C.fur;
    C.earShade = C.earShade || mix(C.ear, '#000000', 0.22);
    C.earInner = C.earInner || '#F7B5C3';
    C.nose = C.nose || (b.species === 'cat' ? '#FF8597' : '#3A2622');
    C.pupil = '#1A1210'; C.cheek = '#FF8FA3'; C.tongue = '#FF7E95'; C.mouth = '#8E2F3C';
    C.pad = C.pad || '#F4A3B4';
    C.stripe = C.stripe || C.furDeep;
    const dark = lum(C.fur) < 0.25;
    C.brow = C.brow || (dark ? mix(C.fur, '#ffffff', 0.4) : mix(C.fur, '#000000', 0.32));
    C.muzzle = b.muzzle === 'mask' ? C.mask : b.muzzle === 'fur' ? mix(C.fur, C.light, 0.35) : C.light;
    C.paw = b.paws === 'light' ? C.light : b.paws === 'point' ? C.point : C.fur;
    C.lineFace = dark ? '#E9DAD0' : C.line;
    C.lineMouth = lum(C.muzzle) < 0.25 ? '#E9DAD0' : C.line;
    C.tex = dark ? mix(C.fur, '#ffffff', 0.12) : C.furShade;
    const E = EYES[eyesId] || EYES[b.eyes] || EYES.brown;
    C.irisL = E.l || E.c; C.irisR = E.r || E.c;
    return C;
  }

  const SPECIES = {
    dog: {
      eyes: [{ cx: 166, cy: 132, rx: 18, ry: 21 }, { cx: 234, cy: 132, rx: 18, ry: 21 }],
      mouth: { x: 200, y: 176, hw: 18, depth: 36 }, tongueW: 11, cheekY: 176, headCY: 140
    },
    cat: {
      eyes: [{ cx: 162, cy: 136, rx: 21, ry: 22 }, { cx: 238, cy: 136, rx: 21, ry: 22 }],
      mouth: { x: 200, y: 176, hw: 13, depth: 28 }, tongueW: 8, cheekY: 180, headCY: 142
    }
  };
  // Kol / bacak iskeleti (yerel koordinat)
  const SHOULDER = [[146, 250], [254, 250]];
  const L1 = 48, L2 = 46, ARM_W = 17;
  const REST = [[128, 338], [272, 338]];
  const HIP = [[170, 384], [230, 384]];
  const FOOT = [[164, G], [236, G]];
  const SIT_DROP = 48;

  // ================================================================ Poz parametreleri
  const POSE_DEFAULT = {
    headX: 0, headY: 0, tilt: 0, headScale: 1, faceX: 0,
    lookX: 0, lookY: 0, eyeOpen: 1, squint: 0, closedCurve: 1, pupil: 0.3,
    brow: 0, browY: 0, smile: 0.4, mouthOpen: 0, tongue: 0, tongueX: 0,
    earLift: 0, tailBase: 0, wagFreq: 1.2, wagAmp: 8,
    sit: 0, blush: 0, breathRate: 0.33, breathAmp: 1, whisker: 0,
    h0x: REST[0][0], h0y: REST[0][1], h1x: REST[1][0], h1y: REST[1][1],
    foot0: 0, foot1: 0, itemTilt: 0, teeth: 0
  };
  const POSE_SPEED = {
    mouthOpen: 16, tongue: 14, tongueX: 14, eyeOpen: 12, squint: 10, closedCurve: 14,
    sit: 3, headY: 8, headX: 8, tilt: 7, lookX: 9, lookY: 9, smile: 8, brow: 6, faceX: 7,
    wagFreq: 4, wagAmp: 4, tailBase: 4, breathRate: 2, breathAmp: 2, blush: 4,
    h0x: 11, h0y: 11, h1x: 11, h1y: 11, foot0: 14, foot1: 14, itemTilt: 8, teeth: 10
  };
  const MOOD_POSES = {
    happy:   { smile: 0.9, earLift: 0.35, tailBase: -10, wagFreq: 2.2, wagAmp: 18, pupil: 0.5 },
    neutral: { smile: 0.4, earLift: 0.05, tailBase: 0, wagFreq: 1.1, wagAmp: 8 },
    hungry:  { smile: -0.45, brow: 0.85, earLift: -0.45, tailBase: 18, wagFreq: 0.6, wagAmp: 3, lookY: 0.25, headY: 4,
               h0x: 180, h0y: 330, h1x: 222, h1y: 336 },
    thirsty: { smile: 0.15, brow: 0.45, mouthOpen: 0.38, tongue: 0.75, breathRate: 2.3, breathAmp: 1.3, earLift: -0.2, tailBase: 10, wagFreq: 0.8, wagAmp: 4 },
    tired:   { eyeOpen: 0.42, brow: 0.55, headY: 10, tilt: 5, earLift: -0.65, tailBase: 28, wagFreq: 0.4, wagAmp: 2, smile: 0, breathRate: 0.24, breathAmp: 1.3, lookY: 0.35,
               h0x: 146, h0y: 352, h1x: 254, h1y: 352 },
    dirty:   { smile: 0, brow: 0.35, earLift: -0.25, tailBase: 12, wagFreq: 0.7, wagAmp: 5 },
    sad:     { smile: -0.7, brow: 1, earLift: -0.85, tailBase: 32, wagFreq: 0.3, wagAmp: 0, headY: 8, lookY: 0.45, pupil: 0.7,
               h0x: 186, h0y: 366, h1x: 214, h1y: 366 },
    sick:    { eyeOpen: 0.55, brow: 0.75, earLift: -0.6, headY: 8, tilt: 6, smile: -0.35, tailBase: 30, wagFreq: 0.4, wagAmp: 2, blush: 0.9, breathRate: 0.5,
               lookY: 0.3, h0x: 182, h0y: 322, h1x: 220, h1y: 332 },
    sleeping:{ sit: 1, eyeOpen: 0, closedCurve: -1, smile: 0.2, earLift: -0.7, tailBase: 40, wagFreq: 0.25, wagAmp: 1.5,
               breathRate: 0.21, breathAmp: 2.2, tilt: 10, headY: 8, headX: -4, h0x: 168, h0y: 376, h1x: 232, h1y: 376 }
  };
  const DEFAULT_DECAY = { fullness: 6, hydration: 8, energy: 5, energyRegen: 22, happiness: 3, cleanliness: 4, lowStatPenalty: 3 };

  let uidCounter = 0;

  // ================================================================ SVG parçaları
  function eyeMarkup(e, i, C, uid) {
    const id = uid + '-eye' + i;
    return '' +
      '<clipPath id="' + id + '"><ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '"/></clipPath>' +
      '<g data-r="eye' + i + '">' +
        '<g clip-path="url(#' + id + ')">' +
          '<ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '" fill="#fff"/>' +
          '<ellipse cx="' + e.cx + '" cy="' + (e.cy - e.ry * 0.75) + '" rx="' + e.rx + '" ry="' + (e.ry * 0.45) + '" fill="#E9E3F0"/>' +
          '<ellipse data-r="iris' + i + '" rx="' + (e.rx * 0.74) + '" ry="' + (e.ry * 0.78) + '" fill="url(#' + uid + '-iris' + i + ')"/>' +
          '<ellipse data-r="pupil' + i + '" rx="6" ry="10" fill="' + C.pupil + '"/>' +
          '<circle data-r="hl' + i + 'a" r="5" fill="#fff"/>' +
          '<circle data-r="hl' + i + 'b" r="2.3" fill="#fff"/>' +
          '<path data-r="lid' + i + '" fill="' + C.fur + '"/>' +
          '<path data-r="low' + i + '" fill="' + C.fur + '"/>' +
          '<path data-r="lidEdge' + i + '" fill="none" stroke="' + C.line + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path data-r="lowEdge' + i + '" fill="none" stroke="' + C.line + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '</g>' +
        '<ellipse cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.rx + '" ry="' + e.ry + '" fill="none" stroke="' + C.line + '" stroke-width="3.5"/>' +
      '</g>' +
      '<path data-r="closed' + i + '" fill="none" stroke="' + C.lineFace + '" stroke-width="4.5" stroke-linecap="round" display="none"/>';
  }

  function treatMarkup(sp, P, line) {
    if (sp === 'cat') {
      const shapes = '<ellipse cx="-4" cy="0" rx="18" ry="11"/><path d="M10 0 L26 -11 L24 0 L26 11 Z"/>';
      return '<g fill="' + line + '" stroke="' + line + '" stroke-width="7" stroke-linejoin="round">' + shapes + '</g>' +
        '<g fill="' + P.fish + '">' + shapes + '</g>' +
        '<path d="M-2 -7 Q4 0 -2 7 M4 -6 Q10 0 4 6" stroke="#E07A93" stroke-width="2" fill="none"/>' +
        '<circle cx="-14" cy="-2" r="2.4" fill="' + line + '"/>';
    }
    const shapes = '<rect x="-17" y="-6" width="34" height="12"/><circle cx="-19" cy="-7" r="8"/><circle cx="-19" cy="7" r="8"/>' +
      '<circle cx="19" cy="-7" r="8"/><circle cx="19" cy="7" r="8"/>';
    return '<g fill="' + line + '" stroke="' + line + '" stroke-width="7">' + shapes + '</g>' +
      '<g fill="' + P.treat + '">' + shapes + '</g>' +
      '<path d="M-12 -2 L12 -2" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.6"/>' +
      '<circle cx="-6" cy="3" r="1.4" fill="#B98040"/><circle cx="5" cy="2" r="1.4" fill="#B98040"/>';
  }
  function bowlMarkup(col, colShade, inner, line) {
    return '<ellipse cx="0" cy="-6" rx="31" ry="8" fill="' + colShade + '" stroke="' + line + '" stroke-width="3.5"/>' + inner +
      '<path d="M-31 -6 L-24 14 Q0 21 24 14 L31 -6 Q0 3 -31 -6 Z" fill="' + col + '" stroke="' + line + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<g fill="#fff" opacity="0.8"><ellipse cx="0" cy="9" rx="3.6" ry="3"/><circle cx="-4.5" cy="4.5" r="1.6"/><circle cx="0" cy="3.5" r="1.6"/><circle cx="4.5" cy="4.5" r="1.6"/></g>';
  }
  function waterIconMarkup(P, line) { return bowlMarkup(P.waterBowl, P.waterBowlShade, '<ellipse data-r="waterLvl" cx="0" cy="-5" rx="25" ry="5" fill="' + P.water + '"/>', line); }
  function foodIconMarkup(P, line) {
    let k = '';
    [[-14, -9], [-4, -11], [6, -10], [15, -8], [-9, -6], [2, -6], [11, -5]].forEach((p, i) => {
      k += '<ellipse data-r="kib' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" rx="5" ry="3.6" fill="' + (i % 2 ? P.kibble : P.kibble2) + '" stroke="' + line + '" stroke-width="1.5"/>';
    });
    return bowlMarkup(P.foodBowl, P.foodBowlShade, k, line);
  }
  function ballMarkup(line) {
    // renkli plaj topu
    return '<circle r="24" fill="#FFFFFF" stroke="' + line + '" stroke-width="3.5"/>' +
      '<path d="M0 -24 C-16 -14 -16 14 0 24 C-26 18 -26 -18 0 -24 Z" fill="#FF6F91"/>' +
      '<path d="M0 -24 C16 -14 16 14 0 24 C26 18 26 -18 0 -24 Z" fill="#5BC0EB"/>' +
      '<path d="M-6 -23 C-2 -10 -2 10 -6 23 M6 -23 C2 -10 2 10 6 23" stroke="#FFD166" stroke-width="5" fill="none"/>' +
      '<circle r="24" fill="none" stroke="' + line + '" stroke-width="3.5"/>' +
      '<circle r="5" fill="#fff" stroke="' + line + '" stroke-width="2"/>' +
      '<ellipse cx="-9" cy="-11" rx="6" ry="3.5" fill="#fff" opacity="0.6" transform="rotate(-35 -9 -11)"/>';
  }
  function showerMarkup(P, line) {
    return '<path d="M16 -14 L58 -58" stroke="' + line + '" stroke-width="17" stroke-linecap="round"/>' +
      '<path d="M16 -14 L58 -58" stroke="' + P.chrome + '" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="M22 -24 L50 -52" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.7"/>' +
      '<path d="M-32 2 Q-30 -24 0 -26 Q30 -24 32 2 Z" fill="' + P.chrome + '" stroke="' + line + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<path d="M-20 -12 Q-14 -20 -2 -21" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>' +
      '<ellipse cx="0" cy="2" rx="32" ry="9" fill="' + P.chromeDark + '" stroke="' + line + '" stroke-width="3.5"/>' +
      '<g fill="#E8F6FF"><circle cx="-20" cy="2" r="2"/><circle cx="-10" cy="0" r="2"/><circle cx="0" cy="-1" r="2"/><circle cx="10" cy="0" r="2"/>' +
      '<circle cx="20" cy="2" r="2"/><circle cx="-12" cy="5" r="2"/><circle cx="0" cy="5.5" r="2"/><circle cx="12" cy="5" r="2"/></g>';
  }

  // ================================================================ Mama çeşitleri
  // fx: istatistiklere etkisi. Menüde küçük renkli çubuklarla gösterilir.
  const FOODS = {
    kibble: { name: 'Kuru mama', desc: 'Çok besleyici', fx: { fullness: 30, happiness: 1, energy: 2 } },
    meat:   { name: { dog: 'Tavuk but', cat: 'Ton balığı' }, desc: 'Enerji verir', fx: { fullness: 22, energy: 8, happiness: 5 } },
    treat:  { name: { dog: 'Kemik bisküvi', cat: 'Balık ödülü' }, desc: 'Mutlu eder', fx: { fullness: 8, happiness: 12 } },
    veggie: { name: { dog: 'Havuç', cat: 'Kedi otu' }, desc: 'Sağlıklı', fx: { fullness: 6, hydration: 6, happiness: 3, energy: 4 } },
    milk:   { name: 'Süt', desc: 'Susuzluk giderir', fx: { fullness: 8, hydration: 18, happiness: 5 }, drink: true },
    cake:   { name: 'Pati kurabiyesi', desc: 'Çok mutlu eder', fx: { fullness: 10, happiness: 18, energy: 4 } }
  };
  const foodName = (id, sp) => (typeof FOODS[id].name === 'string' ? FOODS[id].name : FOODS[id].name[sp]);
  const STAT_COLORS = { fullness: '#F4A259', happiness: '#F06C8B', hydration: '#4FA9D6', energy: '#8E7CF0', cleanliness: '#5CC9A7' };

  // İki geçişli çizim: önce kalın kontur, sonra dolgu → birleşik dış çizgi
  const twoPass = (shapes, fill, line, w) => '<g fill="' + line + '" stroke="' + line + '" stroke-width="' + (w || 6) + '" stroke-linejoin="round">' + shapes + '</g><g fill="' + fill + '">' + shapes + '</g>';
  function foodIcon(id, sp, P, line) {
    switch (id) {
      case 'kibble': {
        let k = '';
        [[-12, 7], [0, 8], [12, 7], [-6, -1], [6, -1], [0, -9]].forEach((q, i) => {
          k += '<ellipse cx="' + q[0] + '" cy="' + q[1] + '" rx="7.5" ry="6" fill="' + (i % 2 ? P.kibble : P.kibble2) + '" stroke="' + line + '" stroke-width="2.2"/>' +
            '<ellipse cx="' + (q[0] - 2) + '" cy="' + (q[1] - 2) + '" rx="2.5" ry="1.4" fill="#fff" opacity="0.45"/>';
        });
        return k;
      }
      case 'meat':
        if (sp === 'cat') {
          return '<rect x="-20" y="-6" width="40" height="20" rx="5" fill="#5BB3E0" stroke="' + line + '" stroke-width="3"/>' +
            '<path d="M-6 4 q6 -6 12 0 q-6 6 -12 0 Z M6 4 l5 -4 l0 8 Z" fill="#fff" opacity="0.9"/>' +
            '<ellipse cx="0" cy="-6" rx="20" ry="6" fill="#D9E2EA" stroke="' + line + '" stroke-width="3"/>' +
            '<ellipse cx="0" cy="-6" rx="15" ry="3.6" fill="#F59A8B"/><path d="M-9 -7 L-3 -5 M2 -7 L8 -5" stroke="#FFC2B8" stroke-width="1.6"/>';
        }
        return '<g transform="rotate(-30)">' + twoPass('<ellipse cx="-6" cy="0" rx="16" ry="12"/><rect x="6" y="-3.5" width="16" height="7"/><circle cx="23" cy="-5" r="5"/><circle cx="23" cy="5" r="5"/>', '#C8743A', line) +
          '<g fill="#FFF8EC"><rect x="8" y="-3.5" width="14" height="7"/><circle cx="23" cy="-5" r="5"/><circle cx="23" cy="5" r="5"/></g>' +
          '<ellipse cx="-10" cy="-4" rx="6" ry="3" fill="#fff" opacity="0.35"/></g>';
      case 'veggie':
        if (sp === 'cat') {
          return '<g stroke="' + line + '" stroke-width="2.4" stroke-linejoin="round">' +
            '<path d="M0 16 Q-14 2 -12 -14 Q2 -6 0 16 Z" fill="#7CC48A"/><path d="M0 16 Q14 2 12 -14 Q-2 -6 0 16 Z" fill="#8FD39B"/>' +
            '<path d="M0 16 Q-4 -2 0 -18 Q4 -2 0 16 Z" fill="#6AB57A"/></g><path d="M0 16 V22" stroke="#5FA36A" stroke-width="3" stroke-linecap="round"/>';
        }
        return '<g transform="rotate(35)"><path d="M-6 -12 Q0 -16 6 -12 L1.5 20 Q0 23 -1.5 20 Z" fill="#F7931E" stroke="' + line + '" stroke-width="2.6" stroke-linejoin="round"/>' +
          '<path d="M-3 -3 h4 M-2 5 h4 M-1 12 h3" stroke="#C96A10" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M0 -13 Q-8 -24 -4 -27 M0 -13 Q0 -26 3 -28 M0 -13 Q8 -22 9 -25" stroke="#5FA36A" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>';
      case 'milk':
        return '<path d="M-11 -12 L-11 -16 L11 -16 L11 -12 L15 -2 L15 20 Q15 24 11 24 L-11 24 Q-15 24 -15 20 L-15 -2 Z" fill="#FFFFFF" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
          '<rect x="-12" y="-24" width="24" height="9" rx="3" fill="#7FC8F8" stroke="' + line + '" stroke-width="3"/>' +
          '<rect x="-15" y="2" width="30" height="13" fill="#CFEAFB"/><path d="M0 12 C-6 7 -4 3 0 6 C4 3 6 7 0 12 Z" fill="#FF6F91"/>' +
          '<path d="M-10 -6 V18" stroke="#fff" stroke-width="3" opacity="0.8" stroke-linecap="round"/>';
      case 'cake':
        return '<path d="M-16 2 L-11 22 L11 22 L16 2 Z" fill="#F7A9BC" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
          '<path d="M-9 4 L-6 21 M0 4 V21 M9 4 L6 21" stroke="#E07A93" stroke-width="2"/>' +
          '<path d="M-19 3 Q-21 -8 -10 -10 Q-8 -20 2 -18 Q14 -20 14 -9 Q22 -7 19 3 Z" fill="#FFF3E0" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
          '<circle cx="-6" cy="-4" r="1.8" fill="#7FC8F8"/><circle cx="7" cy="-2" r="1.8" fill="#FFD166"/><circle cx="1" cy="-10" r="1.8" fill="#8BD3B6"/>' +
          '<circle cx="3" cy="-21" r="5" fill="#E8344E" stroke="' + line + '" stroke-width="2.4"/><path d="M4 -26 q3 -5 7 -6" stroke="#5FA36A" stroke-width="2" fill="none"/>';
      default:
        return treatMarkup(sp, P, line);
    }
  }
  function spongeMarkup(line, foamy) {
    return '<rect x="-28" y="-17" width="56" height="34" rx="12" fill="#FFD45C" stroke="' + line + '" stroke-width="3.5"/>' +
      '<rect x="-28" y="3" width="56" height="14" rx="8" fill="#7FC8A9" stroke="' + line + '" stroke-width="3.5"/>' +
      '<g fill="#E8B23A"><ellipse cx="-14" cy="-8" rx="4" ry="3"/><ellipse cx="2" cy="-10" rx="3" ry="2.4"/><ellipse cx="15" cy="-6" rx="4" ry="3"/><ellipse cx="-4" cy="-3" rx="2.4" ry="2"/></g>' +
      (foamy ? '<g fill="#fff" stroke="#B9DDF2" stroke-width="1.5"><circle cx="-16" cy="-19" r="7"/><circle cx="-4" cy="-23" r="9"/><circle cx="10" cy="-20" r="7"/><circle cx="20" cy="-15" r="5"/></g>' : '');
  }
  function bulbMarkup(line) {
    return '<circle data-r="bulbGlow" cx="0" cy="-6" r="26" fill="#FFE066" opacity="0.35"/>' +
      '<path data-r="bulbGlass" d="M-15 -6 A15 15 0 1 1 15 -6 Q15 4 8 10 L8 15 L-8 15 L-8 10 Q-15 4 -15 -6 Z" fill="#FFE066" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M-5 -2 Q0 -10 5 -2 M0 -6 V10" stroke="#E0A229" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<rect x="-9" y="15" width="18" height="10" rx="3" fill="#B9C3CC" stroke="' + line + '" stroke-width="3"/>' +
      '<path d="M-9 20 H9" stroke="' + line + '" stroke-width="2"/><path d="M-8 -14 Q-12 -8 -10 -2" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8"/>';
  }
  function gamepadMarkup(line) {
    return '<path d="M-26 -6 Q-28 -16 -16 -16 L16 -16 Q28 -16 26 -6 L30 12 Q32 22 22 20 L14 10 L-14 10 L-22 20 Q-32 22 -30 12 Z" fill="#9B8DE8" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M-16 -8 V4 M-22 -2 H-10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="12" cy="-6" r="3.6" fill="#FF6F91"/><circle cx="19" cy="1" r="3.6" fill="#FFD166"/>';
  }
  function butterflyMarkup(line) {
    return '<g data-w="1"><path d="M0 0 C-8 -22 -30 -26 -28 -8 C-27 2 -12 4 0 0 Z" fill="#FF8FB1" stroke="' + line + '" stroke-width="2.4"/>' +
      '<path d="M0 2 C-12 4 -24 10 -18 20 C-12 26 -4 14 0 2 Z" fill="#FFB7CC" stroke="' + line + '" stroke-width="2.4"/>' +
      '<circle cx="-16" cy="-10" r="4" fill="#fff" opacity="0.8"/></g>' +
      '<g data-w="2"><path d="M0 0 C8 -22 30 -26 28 -8 C27 2 12 4 0 0 Z" fill="#FF8FB1" stroke="' + line + '" stroke-width="2.4"/>' +
      '<path d="M0 2 C12 4 24 10 18 20 C12 26 4 14 0 2 Z" fill="#FFB7CC" stroke="' + line + '" stroke-width="2.4"/>' +
      '<circle cx="16" cy="-10" r="4" fill="#fff" opacity="0.8"/></g>' +
      '<ellipse cx="0" cy="4" rx="3.2" ry="13" fill="' + line + '"/><path d="M-1 -8 Q-6 -18 -10 -19 M1 -8 Q6 -18 10 -19" stroke="' + line + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
  }
  function soapBubbleMarkup() {
    return '<circle r="16" fill="#E6F6FF" fill-opacity="0.35" stroke="#9FD8F5" stroke-width="2"/>' +
      '<path d="M-9 -6 A10 10 0 0 1 -2 -12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<circle cx="7" cy="7" r="2" fill="#fff" opacity="0.8"/><path d="M10 -10 A14 14 0 0 1 14 -2" stroke="#FFB7CC" stroke-width="2" fill="none" opacity="0.7"/>';
  }

  // ================================================================ Ses efektleri (dosyasız, WebAudio ile sentez)
  class Sfx {
    constructor(on) { this.on = on !== false; this.ctx = null; this.last = {}; this.loop = null; }
    _c() {
      if (!this.on) return null;
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
        this.out = this.ctx.createGain(); this.out.gain.value = 0.6; this.out.connect(this.ctx.destination);
        const len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* yoksay */ } }
      return this.ctx;
    }
    unlock() { this._c(); }
    _env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
    tone(freq, dur, o) {
      const c = this._c(); if (!c) return; o = o || {};
      const t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      this._env(g, t, o.a || 0.01, o.vol || 0.2, dur);
      osc.connect(g); g.connect(this.out); osc.start(t); osc.stop(t + dur + 0.05);
    }
    noise(dur, o) {
      const c = this._c(); if (!c) return; o = o || {};
      const t = c.currentTime + (o.delay || 0), src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.noiseBuf; src.loop = true;
      fl.type = o.filter || 'bandpass'; fl.frequency.setValueAtTime(o.freq || 1000, t);
      if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      fl.Q.value = o.q || 1;
      this._env(g, t, o.a || 0.005, o.vol || 0.2, dur);
      src.connect(fl); fl.connect(g); g.connect(this.out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    play(name) {
      if (!this.on) return;
      const now = Date.now(), gap = { crunch: 90, lap: 110, squish: 160, pop: 45, boing: 150, sparkle: 120, snore: 2500, brush: 140, scrub: 110, coin: 150 }[name] || 60;
      if (this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;
      switch (name) {
        case 'crunch': for (let i = 0; i < 3; i++) this.noise(0.05, { freq: 2200 + Math.random() * 1400, q: 2.5, vol: 0.32, delay: i * 0.055 }); break;
        case 'lap': this.tone(480, 0.09, { to: 950, vol: 0.16 }); this.noise(0.05, { freq: 1800, q: 3, vol: 0.06 }); break;
        case 'gulp': this.tone(320, 0.12, { to: 170, vol: 0.16 }); break;
        case 'squish': this.noise(0.18, { filter: 'lowpass', freq: 1700, to: 320, q: 4, vol: 0.24 }); this.tone(220, 0.12, { to: 140, vol: 0.05 }); break;
        case 'pop': this.tone(700 + Math.random() * 500, 0.06, { to: 1700, vol: 0.16 }); break;
        case 'boing': this.tone(330, 0.35, { to: 140, type: 'triangle', vol: 0.28 }); this.tone(660, 0.2, { to: 300, vol: 0.07 }); break;
        case 'shake': this.noise(0.8, { freq: 900, q: 0.8, vol: 0.16, a: 0.05 }); break;
        case 'chime': this.tone(880, 0.18, { vol: 0.13 }); this.tone(1320, 0.25, { vol: 0.11, delay: 0.1 }); this.tone(1760, 0.3, { vol: 0.09, delay: 0.2 }); break;
        case 'sparkle': this.tone(1500, 0.12, { vol: 0.06 }); this.tone(2000, 0.15, { vol: 0.05, delay: 0.06 }); break;
        case 'woof': this.tone(430, 0.15, { to: 250, type: 'sawtooth', vol: 0.09 }); this.noise(0.1, { filter: 'lowpass', freq: 900, vol: 0.06 }); break;
        case 'meow': this.tone(620, 0.32, { to: 920, vol: 0.1 }); this.tone(920, 0.22, { to: 560, vol: 0.08, delay: 0.17 }); break;
        case 'snore': this.noise(1.1, { filter: 'lowpass', freq: 320, q: 2, vol: 0.09, a: 0.35 }); break;
        case 'pew': this.tone(1100, 0.14, { to: 1500, vol: 0.06 }); break;
        case 'brush': this.noise(0.12, { freq: 3200, q: 1.2, vol: 0.05 }); break;
        case 'scrub': this.noise(0.08, { freq: 4200, q: 2, vol: 0.05 }); break;
        case 'achoo': this.noise(0.25, { filter: 'highpass', freq: 1800, vol: 0.16, a: 0.02 }); this.tone(520, 0.2, { to: 300, vol: 0.06 }); break;
        case 'coin': this.tone(1320, 0.08, { vol: 0.05 }); this.tone(1760, 0.14, { vol: 0.045, delay: 0.07 }); break;
      }
    }
    water(on) {
      if (on && !this.loop) {
        const c = this._c(); if (!c) return;
        const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
        src.buffer = this.noiseBuf; src.loop = true; fl.type = 'lowpass'; fl.frequency.value = 1500; fl.Q.value = 0.4;
        g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.04, c.currentTime + 0.3);
        src.connect(fl); fl.connect(g); g.connect(this.out); src.start();
        this.loop = { src, g };
      } else if (!on && this.loop && this.ctx) {
        const c = this.ctx, l = this.loop; this.loop = null;
        try { l.g.gain.cancelScheduledValues(c.currentTime); l.g.gain.setValueAtTime(0.04, c.currentTime); l.g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.2); l.src.stop(c.currentTime + 0.25); } catch (e) { /* yoksay */ }
      }
    }
    setOn(v) { if (!v) this.water(false); this.on = !!v; }
  }

  // Desenler (cinse göre). Kafa / gövde / kuyruk katmanları, ilgili şekle kırpılır.
  function patternMarkup(part, b, C, uid) {
    const pt = b.pattern || [], dog = b.species === 'dog';
    let s = '';
    const el = (cx, cy, rx, ry, fill, op) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (op ? ' opacity="' + op + '"' : '') + '/>';
    const softBlob = (cx, cy, rx, ry, fill, seed) => '<path d="' + fur(ellipseD(cx, cy, rx, ry), { step: 12, h: 4, hv: 3, flow: 0.4, seed }) + '" fill="' + fill + '"/>';
    if (part === 'head') {
      if (pt.includes('spots')) [[148, 92, 10], [254, 172, 8], [226, 76, 7], [128, 150, 7], [272, 116, 9], [178, 70, 6], [118, 120, 5]].forEach((p) => { s += el(p[0], p[1], p[2], p[2] * 0.9, C.spot); });
      if (pt.includes('calico')) s += softBlob(140, 104, 58, 46, C.patchA, 3) + softBlob(270, 96, 44, 38, C.patchB, 4);
      if (pt.includes('van')) s += softBlob(146, 92, 40, 26, C.patch, 5) + softBlob(254, 92, 40, 26, C.patch, 6);
      if (pt.includes('husky')) s += '<path d="M200 106 C226 106 260 124 270 158 C278 192 246 218 200 218 C154 218 122 192 130 158 C140 124 174 106 200 106 Z" fill="' + C.light + '"/>' +
        el(168, 104, 8, 6, C.light) + el(232, 104, 8, 6, C.light) + '<path d="M200 64 L188 118 L200 128 L212 118 Z" fill="' + C.furShade + '" opacity="0.7"/>';
      if (pt.includes('blaze')) s += '<path d="M200 60 C210 60 213 98 214 128 C215 148 185 148 186 128 C187 98 190 60 200 60 Z" fill="' + C.light + '"/>';
      if (pt.includes('catBlaze')) s += '<path d="M200 96 C214 120 236 150 240 178 C242 210 158 210 160 178 C164 150 186 120 200 96 Z" fill="' + C.light + '"/>';
      if (pt.includes('urajiro')) s += el(148, 178, 36, 28, C.light) + el(252, 178, 36, 28, C.light) + el(170, 104, 6, 5, C.light) + el(230, 104, 6, 5, C.light);
      if (pt.includes('tan')) s += el(168, 102, 8, 6, C.tan) + el(232, 102, 8, 6, C.tan) + el(148, 186, 22, 16, C.tan) + el(252, 186, 22, 16, C.tan);
      if (pt.includes('mask')) s += '<ellipse cx="200" cy="158" rx="86" ry="70" fill="url(#' + uid + '-mask)"/>';
      if (pt.includes('points')) s += '<ellipse cx="200" cy="168" rx="92" ry="78" fill="url(#' + uid + '-point)"/>';
      if (pt.includes('tabby')) s += '<path d="M200 76 L200 100 M184 79 L188 98 M216 79 L212 98 M108 150 L126 148 M292 150 L274 148 M110 162 L126 158 M290 162 L274 158" stroke="' + C.stripe + '" stroke-width="6" stroke-linecap="round"/>';
      if (pt.includes('wrinkles')) s += '<path d="M176 96 q24 -10 48 0 M182 108 q18 -7 36 0" stroke="' + C.furDeep + '" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>';
    } else if (part === 'body') {
      if (pt.includes('spots')) [[150, 268, 11], [248, 250, 9], [140, 330, 10], [262, 320, 12], [182, 392, 8], [236, 396, 9], [214, 228, 6], [132, 292, 6], [270, 370, 7]].forEach((p) => { s += el(p[0], p[1], p[2], p[2] * 0.9, C.spot); });
      if (pt.includes('calico')) s += softBlob(146, 300, 50, 60, C.patchA, 7) + softBlob(264, 352, 42, 48, C.patchB, 8);
      if (pt.includes('saddle')) s += softBlob(108, 316, 50, 96, C.saddle, 9) + softBlob(292, 316, 50, 96, C.saddle, 10);
      if (pt.includes('tan')) s += el(176, 244, 18, 12, C.tan) + el(224, 244, 18, 12, C.tan);
      if (pt.includes('tabby')) s += '<path d="M126 272 L152 278 M122 306 L150 308 M126 342 L152 338 M274 272 L248 278 M278 306 L250 308 M274 342 L248 338" stroke="' + C.stripe + '" stroke-width="6" stroke-linecap="round"/>';
    } else if (part === 'tail') {
      if (pt.includes('spots')) s += el(300, 362, 7, 6, C.spot) + el(324, 330, 6, 5, C.spot);
      if (pt.includes('tabby')) s += dog ? '' : '<path d="M296 302 L322 296 M304 330 L330 332 M290 362 L310 374" stroke="' + C.stripe + '" stroke-width="6" stroke-linecap="round"/>';
      if (pt.includes('points')) s += '<rect x="200" y="200" width="200" height="260" fill="' + C.point + '" opacity="0.92"/>';
      if (pt.includes('van')) s += '<rect x="200" y="200" width="200" height="260" fill="' + C.patch + '"/><path d="M294 300 L322 294 M302 330 L330 330 M288 362 L310 372" stroke="' + mix(C.patch, '#000000', 0.25) + '" stroke-width="6" stroke-linecap="round"/>';
      if (pt.includes('saddle')) s += '<rect x="200" y="200" width="200" height="260" fill="' + C.saddle + '"/>' + el(dog ? 328 : 320, dog ? 316 : 290, 16, 14, C.light);
      if (pt.includes('calico')) s += '<rect x="280" y="200" width="120" height="260" fill="' + C.patchB + '"/>';
    }
    return s;
  }

  function buildPet(b, C, P, uid, hq) {
    const sp = b.species, S = SPECIES[sp], L = C.line, isDog = sp === 'dog', fl = b.fluff || 1;
    const st = ' stroke="' + L + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';
    const tex = (d, op) => hq ? '<path d="' + d + '" fill="url(#' + uid + '-tex)" opacity="' + (op || 0.5) + '"/>' : '';
    const strands = (d, col, w, op) => '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (w || 2.4) + '" stroke-linecap="round" opacity="' + (op || 0.6) + '"/>';
    const furOr = (d, o) => hq ? fur(d, o) : d;
    const clipped = (id, d, inner) => inner ? '<clipPath id="' + uid + '-' + id + '"><path d="' + d + '"/></clipPath><g clip-path="url(#' + uid + '-' + id + ')">' + inner + '</g>' : '';

    // ---- kuyruk
    const tailD = isDog
      ? 'M232 400 C292 402 332 372 338 322 C340 302 316 298 313 318 C309 352 284 376 232 380 Z'
      : 'M234 404 C306 410 340 360 328 292 C324 272 300 276 303 294 C314 348 300 384 234 384 Z';
    const tailFur = furOr(tailD, { step: 16, h: (isDog ? 3.5 : 2.5) * fl, hv: 1.5, flow: 0.5, seed: 11, amount: (x, y, nx) => (x < 280 || nx < 0 ? 0 : 1) });
    const tail = '<path d="' + tailFur + '" fill="url(#' + uid + '-gBody)"' + st + '/>' + tex(tailFur, 0.4) +
      clipped('tailClip', tailFur, patternMarkup('tail', b, C, uid)) +
      '<path d="' + tailFur + '" fill="none"' + st + '/>';

    // ---- bacaklar (her karede güncellenir) + ayaklar
    const footMk = (i) => '<g data-r="foot' + i + '">' +
        '<path d="' + pawD(0, 0, 25) + '" fill="' + C.paw + '"' + st + '/>' +
        '<path d="M-14 -16 Q0 -23 14 -16" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.35"/>' +
        '<path d="' + toeLines(0, 0, 25) + '" stroke="' + L + '" stroke-width="2.6" stroke-linecap="round"/></g>';
    const soleMk = (i) => '<g data-r="sole' + i + '" opacity="0">' +
        '<ellipse cx="0" cy="0" rx="27" ry="23" fill="' + C.paw + '"' + st + '/>' +
        '<path d="M-14 8 Q-16 -2 0 -2 Q16 -2 14 8 Q12 16 0 16 Q-12 16 -14 8 Z" fill="' + C.pad + '"/>' +
        '<ellipse cx="-14" cy="-11" rx="5.5" ry="6.5" fill="' + C.pad + '"/><ellipse cx="0" cy="-15" rx="5.5" ry="6.5" fill="' + C.pad + '"/><ellipse cx="14" cy="-11" rx="5.5" ry="6.5" fill="' + C.pad + '"/></g>';
    const limb = (name, i) => '<g data-r="' + name + i + '">' +
      '<path data-r="' + name + 'O' + i + '" fill="none" stroke="' + L + '" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path data-r="' + name + 'F' + i + '" fill="none" stroke="' + C.fur + '" stroke-linecap="round" stroke-linejoin="round"/>' +
      (b.pattern.includes('points') ? '<path data-r="' + name + 'P' + i + '" fill="none" stroke="' + C.point + '" stroke-linecap="round" opacity="0.85"/>' : '') +
      '<path data-r="' + name + 'H' + i + '" fill="none" stroke="#ffffff" stroke-linecap="round" opacity="0.13"/>' +
      '<g data-r="' + name + 'D' + i + '"></g>' +
      '</g>';
    const legs = limb('leg', 0) + limb('leg', 1) + footMk(0) + footMk(1);
    const soles = soleMk(0) + soleMk(1);

    // ---- gövde
    const bodyD = 'M156 216 C126 240 118 292 124 342 C130 392 166 414 200 414 C234 414 270 392 276 342 C282 292 274 240 244 216 C230 206 170 206 156 216 Z';
    const bodyFur = furOr(bodyD, { step: 18, h: 3.5 * fl, hv: 1.5, flow: 0.7, seed: 3, amount: (x, y, nx, ny) => (y > 290 && y < 380 && Math.abs(nx) > 0.8 ? 1 : 0) });
    const bellyD = furOr('M200 238 C232 238 252 278 250 328 C248 376 228 402 200 402 C172 402 152 376 150 328 C148 278 168 238 200 238 Z',
      { step: 13, h: 4.5 * fl, hv: 2, flow: 0.7, seed: 8, amount: (x, y, nx, ny) => (y < 300 ? 1 : 0) });
    const mud = (cx, cy, r, seed) => '<path d="' + fur(ellipseD(cx, cy, r, r * 0.75), { step: 9, h: 3.5, hv: 2, seed }) + '" fill="' + P.mud + '" opacity="0.9"/>' +
      '<circle cx="' + (cx + r * 0.9) + '" cy="' + (cy + r * 0.6) + '" r="' + (r * 0.25) + '" fill="' + P.mud + '"/>';
    const body = '<g data-r="body">' +
      '<path d="' + bodyFur + '" fill="url(#' + uid + '-gBody)"' + st + '/>' + tex(bodyFur, 0.45) +
      clipped('bodyClip', bodyFur, patternMarkup('body', b, C, uid)) +
      '<path d="' + bellyD + '" fill="url(#' + uid + '-gLight)"/>' +
      strands('M186 262 q4 8 0 15 M200 268 q4 8 0 15 M214 262 q4 8 0 15', C.lightShade, 2.6, 1) +
      strands('M140 290 q-4 9 -2 18 M260 290 q4 9 2 18', C.furDeep, 2.4, 0.45) +
      '<ellipse cx="200" cy="218" rx="62" ry="12" fill="#000" opacity="0.06"/>' +           // kafanın gövdeye düşen gölgesi
      '<path d="M144 250 Q136 290 140 330" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.12"/>' + // parlama
      '<g data-r="mudBody" opacity="0">' + mud(150, 300, 18, 21) + mud(252, 262, 14, 22) + mud(258, 352, 16, 23) + mud(214, 330, 10, 25) + '</g>' +
      '<clipPath id="' + uid + '-wearClip"><path d="' + bodyFur + '"/></clipPath><g data-r="wearBody" clip-path="url(#' + uid + '-wearClip)"></g>' +
      '<path d="' + bodyFur + '" fill="none"' + st + '/>' +
      '</g>';

    // ---- kafa
    const headD = isDog
      ? 'M200 64 C256 64 290 96 288 142 C287 186 250 212 200 212 C150 212 113 186 112 142 C110 96 144 64 200 64 Z'
      : 'M200 72 C258 72 294 104 294 148 C294 162 302 168 306 174 C296 176 290 178 286 182 C272 206 240 216 200 216 C160 216 128 206 114 182 C110 178 104 176 94 174 C98 168 106 162 106 148 C106 104 142 72 200 72 Z';
    const headFur = furOr(headD, isDog
      ? { step: 14, h: 4.5 * fl, hv: 2, flow: 0.6, seed: 9, amount: (x, y) => (y > 150 && Math.abs(x - 200) > 55 ? 1 : fl > 1.5 && y < 90 ? 0.5 : 0) }
      : { step: 13, h: 3.5 * fl, hv: 1.5, flow: 0.5, seed: 9, amount: (x, y) => (y > 186 && Math.abs(x - 200) < 80 ? 1 : fl > 1.5 && y < 100 ? 0.45 : 0) });

    let earL, earR, earsBehind = !isDog || b.ears === 'pointy';
    const earTufts = b.pattern.includes('earTufts') ? '<path d="M120 34 L114 14 M120 34 L124 12 M120 34 L108 22" stroke="' + C.furDeep + '" stroke-width="3" stroke-linecap="round"/>' : '';
    if (b.ears === 'floppy' || b.ears === 'floppySmall') {
      const earD = furOr('M140 76 C104 60 70 92 74 148 C76 180 96 198 113 186 C127 174 126 128 148 100 Z',
        { step: 12, h: 5 * fl, hv: 2, flow: 0.8, seed: 13, amount: (x, y) => (y > 158 ? 1 : 0) });
      let ear = '<path d="' + earD + '" fill="url(#' + uid + '-gEar)"' + st + '/>' + tex(earD, 0.35) +
        '<path d="M132 84 C108 78 88 104 90 146 C92 168 102 178 110 172 C118 160 118 126 136 102 Z" fill="' + C.earShade + '" opacity="0.4"/>';
      if (b.pattern.includes('spots')) ear += '<ellipse cx="96" cy="130" rx="6" ry="5" fill="' + mix(C.ear, '#000000', 0.3) + '"/>';
      if (b.ears === 'floppySmall') ear = '<g transform="translate(140 80) scale(0.68) translate(-140 -80)">' + ear + '</g>';
      earL = '<g data-r="ear0">' + ear + '</g>';
      earR = '<g transform="translate(400 0) scale(-1 1)"><g data-r="ear1">' + ear + '</g></g>';
    } else if (b.ears === 'folded') {
      const fe = '<path d="M134 102 C126 84 134 66 152 64 C168 64 178 76 180 90 Z" fill="url(#' + uid + '-gEar)"' + st + '/>' +
        '<path d="M144 92 C142 82 148 74 158 74 C166 76 170 82 170 88 Z" fill="' + C.earInner + '" opacity="0.7"/>';
      earL = '<g data-r="ear0">' + fe + '</g>';
      earR = '<g transform="translate(400 0) scale(-1 1)"><g data-r="ear1">' + fe + '</g></g>';
    } else {
      const pe = (isDog
        ? '<path d="M134 112 C122 84 122 54 132 34 C156 44 172 62 182 86 Z" fill="url(#' + uid + '-gEar)"' + st + '/>' +
          '<path d="M140 100 C133 80 133 62 139 48 C154 57 164 68 170 82 Z" fill="' + C.earInner + '"/>'
        : '<path d="M130 116 C118 88 114 58 120 32 C146 40 168 58 182 82 Z" fill="url(#' + uid + '-gEar)"' + st + '/>' +
          '<path d="M136 102 C129 82 127 64 130 48 C146 56 158 66 166 80 Z" fill="' + C.earInner + '"/>') +
        '<path d="M128 58 L140 67 M126 70 L138 76 M132 82 L144 85" stroke="' + mix(C.light, '#ffffff', 0.5) + '" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>' + earTufts;
      earL = '<g data-r="ear0">' + pe + '</g>';
      earR = '<g transform="translate(400 0) scale(-1 1)"><g data-r="ear1">' + pe + '</g></g>';
    }

    let face = '';
    const mz = C.muzzle;
    if (isDog) {
      if (!b.pattern.length || b.pattern.every((p) => p === 'wrinkles')) face += '<ellipse cx="236" cy="124" rx="28" ry="26" fill="' + C.furShade + '" opacity="0.45"/>';
      face += '<path d="' + furOr(ellipseD(200, 180, 48, 32), { step: 13, h: 3.5, hv: 1.5, flow: 0.6, seed: 17, amount: (x, y, nx, ny) => (ny > 0.45 ? 1 : 0) }) + '" fill="' + mz + '"/>';
      face += '<g fill="' + mix(mz, '#6A4A30', 0.25) + '"><circle cx="176" cy="180" r="2"/><circle cx="168" cy="187" r="2"/><circle cx="180" cy="190" r="2"/>' +
              '<circle cx="224" cy="180" r="2"/><circle cx="232" cy="187" r="2"/><circle cx="220" cy="190" r="2"/></g>';
      if (b.pattern.includes('wrinkles')) face += '<path d="M156 176 q-4 12 6 20 M244 176 q4 12 -6 20" stroke="' + mix(mz, '#000000', 0.25) + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    } else {
      [[186, 182, 18], [214, 182, 19]].forEach((p) => {
        face += '<path d="' + furOr(ellipseD(p[0], p[1], 21, 15), { step: 11, h: 3, hv: 1.5, flow: 0.5, seed: p[2], amount: (x, y, nx, ny) => (ny > 0.35 ? 1 : 0) }) + '" fill="' + mz + '"/>';
      });
      face += '<ellipse cx="200" cy="194" rx="14" ry="9" fill="' + mz + '"/>';
      face += '<g fill="' + mix(mz, '#6A4A30', 0.25) + '"><circle cx="180" cy="181" r="1.8"/><circle cx="173" cy="186" r="1.8"/><circle cx="220" cy="181" r="1.8"/><circle cx="227" cy="186" r="1.8"/></g>';
    }

    const eyes = eyeMarkup(S.eyes[0], 0, C, uid) + eyeMarkup(S.eyes[1], 1, C, uid);
    const browW = isDog ? 6 : 4;
    const brows = '<path data-r="brow0" fill="none" stroke="' + C.brow + '" stroke-width="' + browW + '" stroke-linecap="round"/>' +
                  '<path data-r="brow1" fill="none" stroke="' + C.brow + '" stroke-width="' + browW + '" stroke-linecap="round"/>';
    const LM = C.lineMouth;
    const nose = isDog
      ? '<path d="M200 168 L200 176" stroke="' + LM + '" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M183 152 Q200 141 217 152 Q218 164 200 169 Q182 164 183 152 Z" fill="url(#' + uid + '-gNose)"' + st + '/>' +
        '<path d="M190 158 q3 -2 5 1 M205 159 q2 -3 5 -1" stroke="#1B1210" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
        '<ellipse cx="194" cy="150" rx="6" ry="2.6" fill="#fff" opacity="0.6"/>'
      : '<path d="M200 169 L200 176" stroke="' + LM + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M191 160 Q200 155 209 160 Q206 168 200 170 Q194 168 191 160 Z" fill="' + C.nose + '" stroke="' + L + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<ellipse cx="197" cy="159.5" rx="3" ry="1.4" fill="#fff" opacity="0.7"/>';
    const mouth =
      '<path data-r="mouthOpen" fill="' + C.mouth + '" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<g clip-path="url(#' + uid + '-mouth)"><ellipse data-r="mouthTongue" fill="' + C.tongue + '"/><path data-r="teeth" fill="#fff" stroke="#E6D8D0" stroke-width="1.2" opacity="0"/></g>' +
      '<g data-r="tongueOut"><path data-r="tongue" fill="' + C.tongue + '" stroke="' + L + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path data-r="tongueLine" stroke="#E0607A" stroke-width="2.5" stroke-linecap="round" fill="none"/></g>' +
      '<path data-r="mouthLine" fill="none" stroke="' + LM + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
    const wcol = lum(C.fur) < 0.3 ? '#E9DAD0' : L;
    const wh = '<path d="M170 178 L120 170"/><path d="M170 185 L118 186"/><path d="M172 191 L124 202"/>';
    const whiskers = isDog ? '' :
      '<g data-r="whisk0" stroke="' + wcol + '" stroke-width="2.2" stroke-linecap="round" opacity="0.8">' + wh + '</g>' +
      '<g transform="translate(400 0) scale(-1 1)"><g data-r="whisk1" stroke="' + wcol + '" stroke-width="2.2" stroke-linecap="round" opacity="0.8">' + wh + '</g></g>';
    const cheeks = '<g data-r="cheeks" opacity="0">' +
      '<ellipse cx="146" cy="' + S.cheekY + '" rx="15" ry="9" fill="' + C.cheek + '"/>' +
      '<ellipse cx="254" cy="' + S.cheekY + '" rx="15" ry="9" fill="' + C.cheek + '"/></g>';
    const headTuft = isDog
      ? '<path d="M188 70 Q192 56 199 66 Q204 52 210 68 Q215 60 214 74" fill="' + C.fur + '" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"/>'
      : '<path d="M190 78 Q194 66 200 74 Q206 64 210 78" fill="' + C.fur + '" stroke="' + L + '" stroke-width="3" stroke-linejoin="round"/>';

    // hastalık: kızarık burun, alında ter damlası
    const sickFx = '<g data-r="sickFx" opacity="0"><ellipse cx="200" cy="' + (isDog ? 156 : 163) + '" rx="' + (isDog ? 22 : 13) + '" ry="' + (isDog ? 14 : 9) + '" fill="#FF5E5E" opacity="0.45"/>' +
      '<path d="M252 92 C256 100 258 104 258 107 A6 6 0 0 1 246 107 C246 104 248 100 252 92 Z" fill="#9EDCFA" stroke="' + L + '" stroke-width="2"/>' +
      '<path d="M140 104 l8 4 M138 114 l9 1" stroke="#7FB4D8" stroke-width="2.5" stroke-linecap="round"/></g>';
    const head = '<g data-r="head">' +
      (earsBehind ? '<g data-r="ears">' + earL + earR + '</g>' : '') +
      headTuft +
      '<path d="' + headFur + '" fill="url(#' + uid + '-gHead)"' + st + '/>' + tex(headFur, 0.35) +
      clipped('headClip', headFur, patternMarkup('head', b, C, uid)) +
      '<path d="' + headFur + '" fill="none"' + st + '/>' +
      strands(isDog ? 'M126 152 q7 6 9 16 M274 152 q-7 6 -9 16' : 'M118 166 q8 2 12 8 M282 166 q-8 2 -12 8', C.furDeep, 2.4, 0.4) +
      '<ellipse cx="200" cy="96" rx="44" ry="16" fill="#fff" opacity="0.13"/>' +
      '<g data-r="mudHead" opacity="0">' + mud(150, 102, 13, 31) + mud(262, 168, 10, 32) + '</g>' +
      '<g data-r="face">' + face + cheeks + eyes + brows + nose + sickFx + mouth + whiskers + '<g data-r="wearEyes"></g></g>' +
      (!earsBehind ? '<g data-r="ears">' + earL + earR + '</g>' : '') +
      '<g data-r="wearHead"></g>' +
      '<g data-r="foamHead"></g>' +
      '</g>';

    // ---- kollar (her karede güncellenir)
    const hand = (i) => '<g data-r="hand' + i + '">' +
      '<ellipse cx="0" cy="0" rx="19" ry="17" fill="' + C.paw + '"' + st + '/>' +
      '<path d="M-8 6 L-8 15 M0 8 L0 17 M8 6 L8 15" stroke="' + L + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M-10 -8 Q0 -14 10 -8" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.3"/></g>';
    // kazak giyilince üst kolu saran kollar
    const sleeve = (i) => '<g data-r="sleeve' + i + '" display="none"><path data-r="sleeveO' + i + '" fill="none" stroke="' + L + '" stroke-linecap="round"/>' +
      '<path data-r="sleeveF' + i + '" fill="none" stroke="#9FD8F5" stroke-linecap="round"/><path data-r="sleeveC' + i + '" fill="none" stroke="#6DBBE6" stroke-linecap="butt"/></g>';
    const arms = limb('arm', 0) + sleeve(0) + hand(0) + limb('arm', 1) + sleeve(1) + hand(1);

    // ---- elde tutulan nesneler (kap, mama)
    const handItem = '<g data-r="handItem" display="none">' +
      '<g data-r="itemFood" display="none"><g transform="scale(1.7)">' + foodIconMarkup(P, L).replace(/data-r="kib/g, 'data-r="hk') + '</g></g>' +
      '<g data-r="itemWater" display="none"><g transform="scale(1.7)">' + waterIconMarkup(P, L).replace('data-r="waterLvl"', 'data-r="handWater"') + '</g></g>' +
      '<g data-r="itemTreat" display="none"><g data-r="itemTreatS">' + treatMarkup(sp, P, L) + '</g></g>' +
      '</g>';

    const iris = (i, c) => '<radialGradient id="' + uid + '-iris' + i + '" cx="50%" cy="60%" r="60%"><stop offset="0.25" stop-color="' + mix(c, '#ffffff', 0.25) + '"/><stop offset="0.7" stop-color="' + c + '"/><stop offset="1" stop-color="' + mix(c, '#000000', 0.55) + '"/></radialGradient>';
    const defs =
      '<radialGradient id="' + uid + '-gHead" cx="50%" cy="36%" r="64%"><stop offset="0.6" stop-color="' + C.fur + '"/><stop offset="1" stop-color="' + C.furShade + '"/></radialGradient>' +
      '<radialGradient id="' + uid + '-gBody" cx="45%" cy="30%" r="75%"><stop offset="0.45" stop-color="' + C.fur + '"/><stop offset="1" stop-color="' + C.furShade + '"/></radialGradient>' +
      '<radialGradient id="' + uid + '-gLight" cx="50%" cy="35%" r="65%"><stop offset="0.6" stop-color="' + C.light + '"/><stop offset="1" stop-color="' + C.lightShade + '"/></radialGradient>' +
      iris(0, C.irisL) + iris(1, C.irisR) +
      '<radialGradient id="' + uid + '-gNose" cx="40%" cy="30%" r="70%"><stop offset="0" stop-color="' + mix(C.nose, '#ffffff', 0.3) + '"/><stop offset="1" stop-color="' + C.nose + '"/></radialGradient>' +
      '<linearGradient id="' + uid + '-gEar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + C.ear + '"/><stop offset="1" stop-color="' + C.earShade + '"/></linearGradient>' +
      '<radialGradient id="' + uid + '-mask" cx="50%" cy="62%" r="50%"><stop offset="0.55" stop-color="' + (C.mask || C.furDeep) + '"/><stop offset="1" stop-color="' + (C.mask || C.furDeep) + '" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + uid + '-point" cx="50%" cy="60%" r="50%"><stop offset="0.35" stop-color="' + (C.point || C.furDeep) + '"/><stop offset="1" stop-color="' + (C.point || C.furDeep) + '" stop-opacity="0"/></radialGradient>' +
      '<pattern id="' + uid + '-tex" width="24" height="24" patternUnits="userSpaceOnUse">' +
        '<path d="M4 3 q2 3 0 7 M16 12 q2 3 0 7" stroke="' + C.tex + '" stroke-width="1.5" fill="none" stroke-linecap="round"/></pattern>' +
      '<clipPath id="' + uid + '-mouth"><path data-r="mouthClip"/></clipPath>';

    const pet =
      '<ellipse data-r="shadow" cx="200" cy="' + (G + 2) + '" rx="96" ry="13" fill="' + P.shadow + '"/>' +
      '<g data-r="root">' +
        '<g data-r="wearBack"></g>' +
        '<g data-r="tail">' + tail + '</g>' +
        legs +
        '<g data-r="upper">' + body + '<g data-r="foamBody"></g><g data-r="wearNeck"></g>' + head + handItem + arms + '</g>' + soles +
      '</g>';
    return { defs, pet };
  }

  // ================================================================ Oda (arka plan)
  const SCENE = {
    wallTop: '#FFE6EE', wallBottom: '#FFF3EC', floor: '#F2D9BC', floorLine: '#E5C5A2', base: '#FFFFFF',
    rug: '#F9CCD7', rugEdge: '#F2A9BC', tray: 'rgba(255,255,255,0.92)', trayEdge: '#F3CFD9', text: '#8E5E55',
    sofa: '#A9CDBF', sofaLight: '#C1DED3', sofaDark: '#88B3A4', sofaLine: '#5F8678', wood: '#C99A6B', woodDark: '#9C7049'
  };
  function roomMarkup(Wv, Hv, fy, gy, SC, uid) {
    const L = '#6B4B3E';
    let s = '<rect x="0" y="0" width="' + f(Wv) + '" height="' + f(fy) + '" fill="url(#' + uid + '-wall)"/>';
    // duvar kağıdı: küçük kalpler/benekler
    let dots = '';
    for (let y = 36, row = 0; y < fy - 20; y += 64, row++) for (let x = (row % 2) * 40 + 22; x < Wv; x += 80) dots += '<circle cx="' + x + '" cy="' + y + '" r="5"/>';
    s += '<g fill="#fff" opacity="0.55">' + dots + '</g>';
    // koltuk ölçüleri
    const cx = Wv / 2, W = Math.min(Wv * 0.9, 640), sb = fy + 46, seat = sb - 66, back = sb - 196, arm = sb - 116;
    // pencere
    const wy = back - 130;
    if (wy > 80) {
      const wx = Wv * 0.2;
      s += '<g transform="translate(' + f(wx) + ' ' + f(wy) + ')">' +
        '<rect x="-74" y="-66" width="148" height="132" rx="16" fill="#fff" stroke="' + SC.trayEdge + '" stroke-width="6"/>' +
        '<rect data-c="sky" x="-62" y="-54" width="124" height="108" rx="9" fill="#CFEAFB"/>' +
        '<g data-c="moon" opacity="0"><circle cx="30" cy="-22" r="14" fill="#FFF3C4"/><circle cx="37" cy="-27" r="12" fill="#2B3A6B"/>' +
          '<g fill="#FFF3C4"><circle cx="-40" cy="-36" r="2"/><circle cx="-18" cy="-20" r="1.6"/><circle cx="-44" cy="-4" r="1.8"/><circle cx="8" cy="-40" r="1.5"/><circle cx="44" cy="12" r="1.7"/><circle cx="-24" cy="30" r="1.5"/></g></g>' +
        '<circle data-c="sun" cx="34" cy="-24" r="15" fill="#FFE08A"/>' +
        '<path data-c="cloud" d="M-56 28 q14 -14 30 -4 q14 -12 30 2 q12 -8 22 2 L-8 54 L-62 54 Z" fill="#fff" opacity="0.9"/>' +
        '<path d="M0 -54 V54 M-62 0 H62" stroke="#fff" stroke-width="7"/>' +
        '<path data-c="curtL" fill="' + SC.rug + '" stroke="' + SC.rugEdge + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<path data-c="curtR" fill="' + SC.rug + '" stroke="' + SC.rugEdge + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<rect x="-106" y="-82" width="212" height="10" rx="5" fill="' + SC.rugEdge + '"/></g>';
    }
    // raf: kitaplar, saksı, çerçeve
    const shy = back - 92;
    if (shy > 90) {
      const sx = Math.min(Wv * 0.8, Wv - 100);
      const books = [['#F28AA4', 18, 52], ['#7FC8F8', 14, 44], ['#FFD166', 16, 56], ['#9B8DE8', 12, 40]];
      let bx = -78, bk = '';
      books.forEach((bkk) => { bk += '<rect x="' + bx + '" y="' + (-bkk[2]) + '" width="' + bkk[1] + '" height="' + bkk[2] + '" rx="3" fill="' + bkk[0] + '" stroke="' + L + '" stroke-width="2.5"/>' +
        '<path d="M' + (bx + 3) + ' ' + (-bkk[2] + 8) + ' h' + (bkk[1] - 6) + '" stroke="#fff" stroke-width="2" opacity="0.7"/>'; bx += bkk[1] + 1; });
      s += '<g transform="translate(' + f(sx) + ' ' + f(shy) + ')">' + bk +
        '<g transform="rotate(14 -14 0)"><rect x="-18" y="-44" width="12" height="44" rx="3" fill="#8FD3B6" stroke="' + L + '" stroke-width="2.5"/></g>' +
        '<path d="M18 0 L22 -26 L44 -26 L48 0 Z" fill="#E59E6D" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="M33 -26 C24 -46 14 -50 10 -60 M33 -26 C34 -50 40 -58 36 -70 M33 -26 C42 -44 54 -48 58 -58" stroke="#5FA36A" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="11" cy="-58" rx="8" ry="4" fill="#7CC48A" transform="rotate(-30 11 -58)"/><ellipse cx="36" cy="-68" rx="5" ry="8" fill="#7CC48A"/><ellipse cx="57" cy="-56" rx="8" ry="4" fill="#7CC48A" transform="rotate(30 57 -56)"/>' +
        '<rect x="60" y="-40" width="34" height="40" rx="4" fill="#fff" stroke="' + SC.rugEdge + '" stroke-width="3"/>' +
        '<path d="M77 -12 C65 -20 69 -31 77 -25 C85 -31 89 -20 77 -12 Z" fill="#FF6F91"/>' +
        '<rect x="-92" y="0" width="196" height="12" rx="4" fill="' + SC.wood + '" stroke="' + L + '" stroke-width="2.5"/>' +
        '<path d="M-70 12 L-70 28 L-56 12 M82 12 L82 28 L68 12" fill="' + SC.woodDark + '" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round"/></g>';
    }
    // zemin
    s += '<rect x="0" y="' + f(fy - 10) + '" width="' + f(Wv) + '" height="10" fill="' + SC.base + '"/>';
    s += '<rect x="0" y="' + f(fy) + '" width="' + f(Wv) + '" height="' + f(Hv - fy) + '" fill="' + SC.floor + '"/>';
    let bd = '';
    for (let y = fy + 34, k = 0; y < Hv; y += 42, k++) {
      bd += '<path d="M0 ' + f(y) + ' L' + f(Wv) + ' ' + f(y) + '"/>';
      for (let x = (k % 2) * 90 + 60; x < Wv; x += 180) bd += '<path d="M' + x + ' ' + f(y - 42) + ' V' + f(y) + '"/>';
    }
    s += '<g stroke="' + SC.floorLine + '" stroke-width="2.5">' + bd + '</g>';
    // koltuk
    const sl = SC.sofaLine;
    const x0 = cx - W / 2;
    s += '<g stroke="' + sl + '" stroke-width="3.5" stroke-linejoin="round">' +
      '<rect x="' + f(x0 + 42) + '" y="' + f(sb) + '" width="10" height="16" rx="3" fill="' + SC.woodDark + '"/>' +
      '<rect x="' + f(x0 + W - 52) + '" y="' + f(sb) + '" width="10" height="16" rx="3" fill="' + SC.woodDark + '"/>' +
      '<rect x="' + f(x0 + 34) + '" y="' + f(back) + '" width="' + f(W - 68) + '" height="' + f(sb - back - 20) + '" rx="44" fill="' + SC.sofa + '"/>' +
      '<rect x="' + f(x0 + 64) + '" y="' + f(back + 16) + '" width="' + f((W - 140) / 2) + '" height="96" rx="30" fill="' + SC.sofaLight + '"/>' +
      '<rect x="' + f(cx + 6) + '" y="' + f(back + 16) + '" width="' + f((W - 140) / 2) + '" height="96" rx="30" fill="' + SC.sofaLight + '"/>' +
      '<rect x="' + f(x0 + 44) + '" y="' + f(seat) + '" width="' + f(W - 88) + '" height="52" rx="20" fill="' + SC.sofaLight + '"/>' +
      '<rect x="' + f(x0 + 44) + '" y="' + f(seat + 38) + '" width="' + f(W - 88) + '" height="' + f(sb - seat - 34) + '" rx="12" fill="' + SC.sofaDark + '"/>' +
      '<rect x="' + f(x0) + '" y="' + f(arm) + '" width="74" height="' + f(sb - arm + 4) + '" rx="32" fill="' + SC.sofa + '"/>' +
      '<rect x="' + f(x0 + W - 74) + '" y="' + f(arm) + '" width="74" height="' + f(sb - arm + 4) + '" rx="32" fill="' + SC.sofa + '"/>' +
      '</g>' +
      '<path d="M' + f(x0 + 16) + ' ' + f(arm + 22) + ' q20 -10 42 0 M' + f(x0 + W - 58) + ' ' + f(arm + 22) + ' q20 -10 42 0" stroke="#fff" stroke-width="5" opacity="0.4" fill="none" stroke-linecap="round"/>' +
      // yastıklar
      '<g transform="translate(' + f(x0 + 110) + ' ' + f(seat - 26) + ') rotate(-12)"><rect x="-34" y="-30" width="68" height="60" rx="18" fill="#F7A9BC" stroke="' + sl + '" stroke-width="3.5"/>' +
        '<path d="M0 12 C-16 2 -10 -14 0 -6 C10 -14 16 2 0 12 Z" fill="#fff" opacity="0.85"/></g>' +
      '<g transform="translate(' + f(x0 + W - 110) + ' ' + f(seat - 24) + ') rotate(10)"><rect x="-32" y="-28" width="64" height="56" rx="18" fill="#FFD98A" stroke="' + sl + '" stroke-width="3.5"/>' +
        '<circle cx="0" cy="0" r="9" fill="#fff" opacity="0.8"/></g>';
    // halı
    s += '<ellipse cx="' + f(cx) + '" cy="' + f(gy + 4) + '" rx="' + f(Wv * 0.42) + '" ry="46" fill="' + SC.rug + '" stroke="' + SC.rugEdge + '" stroke-width="5" stroke-dasharray="2 11" stroke-linecap="round"/>';
    s += '<ellipse cx="' + f(cx) + '" cy="' + f(gy + 4) + '" rx="' + f(Wv * 0.32) + '" ry="30" fill="none" stroke="#fff" stroke-width="3" opacity="0.6"/>';
    return s;
  }

  const FONT = '-apple-system, Roboto, Segoe UI, sans-serif';
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // ================================================================ SVG ikonlar (emoji yerine; 24x24, merkez 0,0)
  const IL = '#6B4B3E';
  const isw = (w) => ' stroke="' + IL + '" stroke-width="' + (w || 2) + '" stroke-linejoin="round" stroke-linecap="round"';
  function faceIcon(kind) {
    const fill = kind === 'angry' ? '#FF9A7A' : kind === 'sick' ? '#CFE8A8' : '#FFD166';
    const ln = ' fill="none"' + isw(1.8);
    let s = '<circle r="11" fill="' + fill + '"' + isw(2) + '/>';
    switch (kind) {
      case 'happy': s += '<path d="M-6 -2 Q-4 -5 -2 -2 M2 -2 Q4 -5 6 -2"' + ln + '/><path d="M-5 3 Q0 8.5 5 3"' + ln + '/><circle cx="-7" cy="2.5" r="1.8" fill="#FF8FB1"/><circle cx="7" cy="2.5" r="1.8" fill="#FF8FB1"/>'; break;
      case 'sad': s += '<circle cx="-4" cy="-2" r="1.5" fill="' + IL + '"/><circle cx="4" cy="-2" r="1.5" fill="' + IL + '"/><path d="M-4 6 Q0 2 4 6"' + ln + '/><path d="M6.5 0 q2.2 3 0 4.4 q-2.2 -1.4 0 -4.4 Z" fill="#4FA9D6"/>'; break;
      case 'tired': s += '<path d="M-6.5 -2 H-2 M2 -2 H6.5"' + ln + '/><circle cx="0" cy="5" r="2" fill="' + IL + '"/>'; break;
      case 'pain': s += '<path d="M-6.5 -4.5 L-3 -2 L-6.5 0.5 M6.5 -4.5 L3 -2 L6.5 0.5"' + ln + '/><path d="M-5 5 q1.25 -2 2.5 0 t2.5 0 t2.5 0 t2.5 0"' + ln + '/>'; break;
      case 'angry': s += '<path d="M-7 -6.5 L-2 -4 M7 -6.5 L2 -4"' + ln + '/><circle cx="-4" cy="-1" r="1.5" fill="' + IL + '"/><circle cx="4" cy="-1" r="1.5" fill="' + IL + '"/><path d="M-4 6.5 Q0 3 4 6.5"' + ln + '/>'; break;
      case 'anxious': s += '<circle cx="-4" cy="-2" r="2.8" fill="#fff"' + isw(1.4) + '/><circle cx="4" cy="-2" r="2.8" fill="#fff"' + isw(1.4) + '/><circle cx="-4" cy="-2" r="1.2" fill="' + IL + '"/><circle cx="4" cy="-2" r="1.2" fill="' + IL + '"/>' +
        '<path d="M-5 5.5 q1.25 -1.6 2.5 0 t2.5 0 t2.5 0 t2.5 0"' + ln + '/><path d="M8.5 -9 q2 3 0 4 q-2 -1 0 -4 Z" fill="#7FC8F8"/>'; break;
      case 'sick': s += '<path d="M-6.5 -2 H-2 M2 -2 H6.5"' + ln + '/><path d="M-4 5.5 q2 -2 4 0 t4 0"' + ln + '/>'; break;
      default: s += '<circle cx="-4" cy="-2" r="1.5" fill="' + IL + '"/><circle cx="4" cy="-2" r="1.5" fill="' + IL + '"/><path d="M-4 5 H4"' + ln + '/>';
    }
    return s;
  }
  let ICONS = null;
  function iconLib() {
    if (ICONS) return ICONS;
    const flowerPetals = () => { let p = ''; for (let k = 0; k < 5; k++) { const a = (k * 72 - 90) * Math.PI / 180; p += '<circle cx="' + f(Math.cos(a) * 5.5) + '" cy="' + f(Math.sin(a) * 5.5) + '" r="4.2"/>'; } return p; };
    const care = (id, sc) => '<g transform="scale(' + (sc || 0.42) + ')">' + careIcon(id, IL) + '</g>';
    ICONS = {
      heart: '<path d="M0 9 C-14 0 -10 -13 0 -5 C10 -13 14 0 0 9 Z" fill="#FF6F91"' + isw(2) + '/><path d="M-6 -4 q-2 2 -1 5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8"/>',
      star: '<path d="M0 -11 L3.2 -3.6 L11 -3.4 L5 1.8 L7 9.6 L0 5.2 L-7 9.6 L-5 1.8 L-11 -3.4 L-3.2 -3.6 Z" fill="#FFD166"' + isw(2) + '/>',
      coin: '<circle r="10.5" fill="#FFD166" stroke="#D68A00" stroke-width="2"/><g fill="#D68A00"><ellipse cx="0" cy="2.6" rx="3.6" ry="2.9"/><circle cx="-4.4" cy="-2" r="1.6"/><circle cx="-1.6" cy="-4.6" r="1.6"/><circle cx="1.6" cy="-4.6" r="1.6"/><circle cx="4.4" cy="-2" r="1.6"/></g>',
      lock: '<path d="M-5 -3 V-6 A5 5 0 0 1 5 -6 V-3" fill="none"' + isw(2.4) + '/><rect x="-8" y="-3" width="16" height="13" rx="3" fill="#C9B8B0"' + isw(2) + '/><circle cx="0" cy="3" r="1.8" fill="' + IL + '"/>',
      check: '<circle r="10.5" fill="#5CC9A7"/><path d="M-5 0 L-1.5 4 L5.5 -4" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
      close: '<circle r="10.5" fill="#fff" fill-opacity="0.3"/><path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
      paw: '<g fill="#C98A5B"><ellipse cx="0" cy="3.5" rx="6" ry="5"/><circle cx="-7" cy="-3" r="2.6"/><circle cx="-2.6" cy="-7.4" r="2.6"/><circle cx="2.6" cy="-7.4" r="2.6"/><circle cx="7" cy="-3" r="2.6"/></g>',
      list: '<rect x="-8" y="-9" width="16" height="20" rx="3" fill="#fff"' + isw(2) + '/><rect x="-4" y="-12" width="8" height="5" rx="2" fill="#F06C8B"' + isw(1.6) + '/><path d="M-4 -2 H4 M-4 2.5 H4 M-4 7 H1" stroke="#C9A79E" stroke-width="2" stroke-linecap="round"/>',
      bag: '<path d="M-4 -5 V-7 A4 4 0 0 1 4 -7 V-5" fill="none"' + isw(2) + '/><path d="M-9 -5 H9 L8 10 Q0 12 -8 10 Z" fill="#FF8FB1"' + isw(2) + '/><circle cx="-4" cy="-1" r="1.3" fill="' + IL + '"/><circle cx="4" cy="-1" r="1.3" fill="' + IL + '"/>',
      hanger: '<path d="M0 -12 q3 0 3 3 q0 2 -3 3" fill="none"' + isw(1.8) + '/><path d="M-4 -6 L4 -6 L6 0 L10 11 L-10 11 L-6 0 Z" fill="#9B8DE8"' + isw(2) + '/><path d="M-6 0 H6" stroke="#fff" stroke-width="2" opacity="0.7"/>',
      chat: '<path d="M-10 -8 Q-10 -11 -7 -11 H7 Q10 -11 10 -8 V3 Q10 6 7 6 H-1 L-6 10 L-5 6 H-7 Q-10 6 -10 3 Z" fill="#7FC8F8"' + isw(2) + '/><g fill="#fff"><circle cx="-4.5" cy="-2.5" r="1.6"/><circle cx="0" cy="-2.5" r="1.6"/><circle cx="4.5" cy="-2.5" r="1.6"/></g>',
      vet: '<rect x="-10" y="-7" width="20" height="16" rx="4" fill="#fff"' + isw(2) + '/><path d="M-4 -7 V-10 H4 V-7" fill="none"' + isw(2) + '/><path d="M0 -3 V6 M-4.5 1.5 H4.5" stroke="#E05A5A" stroke-width="3" stroke-linecap="round"/>',
      drop: '<path d="M0 -11 C5 -3 7 1 7 4 A7 7 0 0 1 -7 4 C-7 1 -5 -3 0 -11 Z" fill="#4FA9D6"' + isw(1.8) + '/><path d="M-3 3 q0 3 3 4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      food: '<g transform="rotate(-35)"><ellipse cx="0" cy="-3" rx="7" ry="8" fill="#D9793B"' + isw(2) + '/><rect x="-1.8" y="4" width="3.6" height="7" fill="#fff"' + isw(1.5) + '/><circle cx="-2" cy="11.5" r="2.4" fill="#fff"' + isw(1.5) + '/><circle cx="2" cy="11.5" r="2.4" fill="#fff"' + isw(1.5) + '/></g>',
      bath: '<g fill="#BFE3F2"' + isw(1.4) + '><circle cx="-5" cy="-3" r="3"/><circle cx="0" cy="-5" r="3.6"/><circle cx="5" cy="-3" r="3"/></g><path d="M-11 0 H11 V3 Q11 9 5 9 H-5 Q-11 9 -11 3 Z" fill="#fff"' + isw(2) + '/><path d="M-7 9 v2 M7 9 v2"' + isw(2) + '/>',
      sparkle: '<path d="M0 -11 Q1.6 -1.6 11 0 Q1.6 1.6 0 11 Q-1.6 1.6 -11 0 Q-1.6 -1.6 0 -11 Z" fill="#FFD166"' + isw(1.6) + '/>',
      tooth: '<path d="M-8 -8 Q-8 -11 -4 -11 Q0 -9 4 -11 Q8 -11 8 -7 Q8 0 5 4 L4 10 Q3 11 2 10 L0 4 L-2 10 Q-3 11 -4 10 L-5 4 Q-8 0 -8 -8 Z" fill="#fff"' + isw(1.8) + '/>',
      gamepad: '<g transform="scale(0.42)">' + gamepadMarkup(IL) + '</g>',
      ball: '<g transform="scale(0.45)">' + ballMarkup(IL) + '</g>',
      laser: '<circle r="9" fill="#FF3B5C" opacity="0.25"/><circle r="5" fill="#FF2244"/><circle cx="-1.5" cy="-1.5" r="1.4" fill="#fff"/>',
      bubble: '<g transform="scale(0.62)">' + soapBubbleMarkup() + '</g>',
      butterfly: '<g transform="scale(0.4)">' + butterflyMarkup(IL) + '</g>',
      moon: '<path d="M4 -10 A10 10 0 1 0 9 6 A8 8 0 1 1 4 -10 Z" fill="#FFE08A"' + isw(1.8) + '/>',
      sun: '<path d="M0 -11 V-8 M0 8 V11 M-11 0 H-8 M8 0 H11 M-7.8 -7.8 L-5.7 -5.7 M5.7 5.7 L7.8 7.8 M-7.8 7.8 L-5.7 5.7 M5.7 -5.7 L7.8 -7.8" stroke="#F4A259" stroke-width="2.2" stroke-linecap="round"/><circle r="5.6" fill="#FFD166"' + isw(1.6) + '/>',
      flower: '<g fill="#FF8FB1"' + isw(1.3) + '>' + flowerPetals() + '</g><circle r="3.2" fill="#FFD166"' + isw(1.3) + '/>',
      sprout: '<path d="M0 10 V-2" stroke="#5FA36A" stroke-width="2.4" stroke-linecap="round"/><path d="M0 -1 C-2 -8 -9 -9 -10 -4 C-8 0 -3 0 0 -1 Z M0 2 C2 -5 9 -6 10 -1 C8 3 3 3 0 2 Z" fill="#7CC48A"' + isw(1.4) + '/><path d="M-6 10 H6"' + isw(2) + '/>',
      leaf: '<path d="M-8 8 C-10 -4 -2 -10 9 -9 C9 2 2 9 -8 8 Z" fill="#E59E6D"' + isw(1.6) + '/><path d="M-8 8 L4 -4"' + isw(1.4) + '/>',
      choco: care('choco', 0.42), bottle: care('bottle', 0.4), glass: care('glass', 0.45), thermo: care('thermo', 0.36), pill: care('vitamin', 0.42), pouch: care('pouch', 0.42), syrup: care('syrup', 0.4),
      party: '<path d="M-9 10 L-3 -4 L5 4 Z" fill="#9B8DE8"' + isw(1.8) + '/><g fill="#FF8FB1"><circle cx="4" cy="-8" r="1.8"/><circle cx="9" cy="-2" r="1.8"/></g><g fill="#FFD166"><circle cx="-1" cy="-10" r="1.6"/><circle cx="10" cy="-9" r="1.6"/></g><path d="M2 -3 q4 -5 8 -4" stroke="#7FC8F8" stroke-width="2" fill="none" stroke-linecap="round"/>',
      search: '<circle cx="-2" cy="-2" r="6.5" fill="#E6F6FF"' + isw(2.2) + '/><path d="M3 3 L9 9" stroke="' + IL + '" stroke-width="3" stroke-linecap="round"/>',
      gift: '<rect x="-9" y="-3" width="18" height="13" rx="2" fill="#FF8FB1"' + isw(1.8) + '/><rect x="-10" y="-7" width="20" height="5" rx="1.5" fill="#FFB7CC"' + isw(1.8) + '/><path d="M0 -7 V10" stroke="#FFD166" stroke-width="3"/><path d="M0 -7 C-6 -13 -9 -8 0 -7 C9 -8 6 -13 0 -7" fill="none"' + isw(1.6) + '/>',
      bolt: '<path d="M2 -11 L-7 2 H-1 L-3 11 L7 -2 H1 Z" fill="#FFD166"' + isw(1.8) + '/>',
      calendar: '<rect x="-10" y="-8" width="20" height="18" rx="3" fill="#fff"' + isw(2) + '/><path d="M-10 -2 V-5 Q-10 -8 -7 -8 H7 Q10 -8 10 -5 V-2 Z" fill="#F06C8B"/><path d="M-5 -11 V-6 M5 -11 V-6"' + isw(2) + '/><path d="M0 7.5 C-5 4 -4 0 0 2.5 C4 0 5 4 0 7.5 Z" fill="#FF6F91"/>',
      wind: '<path d="M-10 -3 H4 A3 3 0 1 0 1 -6 M-10 2 H7 A3 3 0 1 1 4 5 M-8 7 H0" fill="none" stroke="#4FA9D6" stroke-width="2.4" stroke-linecap="round"/>',
      note: '<path d="M-3 7 V-8 L7 -10 V4" fill="none"' + isw(2) + '/><ellipse cx="-6" cy="7" rx="3.6" ry="2.8" fill="#9B8DE8"' + isw(1.6) + '/><ellipse cx="4" cy="4" rx="3.6" ry="2.8" fill="#9B8DE8"' + isw(1.6) + '/>',
      plus: '<circle r="10.5" fill="#F6DCE3"/><path d="M0 -5 V5 M-5 0 H5" stroke="' + IL + '" stroke-width="2.6" stroke-linecap="round"/>',
      home: '<g transform="scale(0.42)">' + homeIconMarkup(IL) + '</g>',
      rainbow: '<path d="M-11 6 A11 11 0 0 1 11 6" fill="none" stroke="#FF8FB1" stroke-width="3"/><path d="M-7.5 6 A7.5 7.5 0 0 1 7.5 6" fill="none" stroke="#FFD166" stroke-width="3"/><path d="M-4 6 A4 4 0 0 1 4 6" fill="none" stroke="#7FC8F8" stroke-width="3"/>'
    };
    return ICONS;
  }
  // bir ikonu (x, y) merkezine, size boyutunda çizer
  function icon(name, x, y, size) {
    const lib = iconLib();
    const m = lib[name] || (name && name.indexOf('face-') === 0 ? faceIcon(name.slice(5)) : '');
    return m ? '<g transform="translate(' + f(x) + ' ' + f(y) + ') scale(' + Math.round((size || 24) / 24 * 1000) / 1000 + ')">' + m + '</g>' : '';
  }

  // ================================================================ Kıyafetler (hayvanın yerel koordinatlarında çizilir)
  // slot: head (kafa), eyes (gözlük), neck (boyun), body (gövde). Para zor kazanılır: fiyatlar bilerek yüksek.
  const CLOTHES = {
    bow:       { slot: 'head', name: 'Fiyonk', price: 40, level: 1 },
    party:     { slot: 'head', name: 'Parti şapkası', price: 60, level: 1 },
    cap:       { slot: 'head', name: 'Kep', price: 90, level: 2 },
    beret:     { slot: 'head', name: 'Bere', price: 100, level: 2 },
    flower:    { slot: 'head', name: 'Çiçek taç', price: 110, level: 2 },
    bunny:     { slot: 'head', name: 'Tavşan kulakları', price: 120, level: 2 },
    chef:      { slot: 'head', name: 'Aşçı şapkası', price: 130, level: 3 },
    heartband: { slot: 'head', name: 'Kalpli taç bandı', price: 150, level: 4 },
    santa:     { slot: 'head', name: 'Yılbaşı şapkası', price: 180, level: 4 },
    witch:     { slot: 'head', name: 'Cadı şapkası', price: 200, level: 4 },
    cowboy:    { slot: 'head', name: 'Kovboy şapkası', price: 240, level: 5 },
    crown:     { slot: 'head', name: 'Taç', price: 350, level: 6 },
    tiara:     { slot: 'head', name: 'Prenses tacı', price: 400, level: 7 },
    round:     { slot: 'eyes', name: 'Yuvarlak gözlük', price: 70, level: 1 },
    square:    { slot: 'eyes', name: 'Kare gözlük', price: 90, level: 2 },
    heart:     { slot: 'eyes', name: 'Kalp gözlük', price: 140, level: 3 },
    starg:     { slot: 'eyes', name: 'Yıldız gözlük', price: 170, level: 4 },
    sun:       { slot: 'eyes', name: 'Güneş gözlüğü', price: 220, level: 5 },
    collar:    { slot: 'neck', name: 'Tasma', price: 40, level: 1 },
    bandana:   { slot: 'neck', name: 'Bandana', price: 60, level: 1 },
    bowtie:    { slot: 'neck', name: 'Papyon', price: 80, level: 2 },
    scarf:     { slot: 'neck', name: 'Atkı', price: 100, level: 2 },
    tie:       { slot: 'neck', name: 'Kravat', price: 110, level: 3 },
    bell:      { slot: 'neck', name: 'Çıngıraklı tasma', price: 120, level: 3 },
    pearls:    { slot: 'neck', name: 'İnci kolye', price: 150, level: 3 },
    lei:       { slot: 'neck', name: 'Çiçek kolye', price: 160, level: 4 },
    sweater:   { slot: 'body', name: 'Kazak', price: 160, level: 3 },
    hoodie:    { slot: 'body', name: 'Kapüşonlu', price: 180, level: 3 },
    tutu:      { slot: 'body', name: 'Tütü etek', price: 200, level: 4 },
    raincoat:  { slot: 'body', name: 'Yağmurluk', price: 220, level: 4 },
    overalls:  { slot: 'body', name: 'Tulum', price: 260, level: 5 },
    cape:      { slot: 'body', name: 'Pelerin', price: 450, level: 8 }
  };
  const CLOTH_SLOTS = ['head', 'eyes', 'neck', 'body'];
  const CLOTH_TABS = { head: 'Kafa', eyes: 'Göz', neck: 'Boyun', body: 'Gövde' };
  // gövde kıyafetleri: kollar da aynı renge boyanır [kol, manşet]
  const SLEEVES = { sweater: ['#9FD8F5', '#6DBBE6'], hoodie: ['#FF9EBB', '#F27BA0'], raincoat: ['#FFD84D', '#E8B400'] };
  function neckCurve(n, fn) { // boyun eğrisi boyunca n nokta
    let s = '';
    for (let i = 0; i < n; i++) { const t = i / (n - 1), u = 1 - t; s += fn(u * u * 148 + 2 * u * t * 200 + t * t * 252, u * u * 222 + 2 * u * t * 252 + t * t * 222, i); }
    return s;
  }
  function clothMarkup(id, sp, L) {
    const hy = sp === 'dog' ? 68 : 76, E = SPECIES[sp].eyes;
    const st = ' stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"';
    const band = (col) => '<path d="M-70 10 Q0 -40 70 10" fill="none" stroke="' + L + '" stroke-width="9" stroke-linecap="round"/><path d="M-70 10 Q0 -40 70 10" fill="none" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/>';
    const bodyRect = (col) => '<rect x="100" y="196" width="200" height="240" fill="' + col + '"/>';
    switch (id) {
      case 'party': return '<g transform="translate(206 ' + (hy + 4) + ') rotate(10)"><path d="M-28 4 L0 -66 L28 4 Q0 13 -28 4 Z" fill="#9B8DE8"' + st + '/>' +
        '<circle cx="-8" cy="-14" r="5" fill="#FFD166"/><circle cx="10" cy="-30" r="4.5" fill="#FF8FB1"/><circle cx="-2" cy="-46" r="3.5" fill="#7FE0C2"/><circle cx="12" cy="-6" r="4" fill="#7FE0C2"/>' +
        '<circle cx="0" cy="-68" r="10" fill="#FF6F91"' + st + '/></g>';
      case 'crown': return '<g transform="translate(200 ' + (hy - 2) + ')"><path d="M-36 8 L-38 -26 L-18 -8 L0 -36 L18 -8 L38 -26 L36 8 Q0 16 -36 8 Z" fill="#FFD166"' + st + '/>' +
        '<path d="M-34 0 Q0 8 34 0" stroke="#E0A229" stroke-width="3" fill="none"/><circle cx="0" cy="-2" r="6" fill="#FF5E86" stroke="' + L + '" stroke-width="2"/>' +
        '<circle cx="-20" cy="0" r="4" fill="#4FA9D6" stroke="' + L + '" stroke-width="2"/><circle cx="20" cy="0" r="4" fill="#4FA9D6" stroke="' + L + '" stroke-width="2"/>' +
        '<circle cx="0" cy="-36" r="4" fill="#fff" stroke="' + L + '" stroke-width="2"/><path d="M-26 -14 L-22 -2" stroke="#fff" stroke-width="3" opacity="0.7" stroke-linecap="round"/></g>';
      case 'beret': return '<g transform="translate(212 ' + (hy + 6) + ') rotate(-10)"><ellipse cx="0" cy="-10" rx="56" ry="22" fill="#E2556F"' + st + '/>' +
        '<path d="M-50 -2 Q0 14 50 -2" stroke="#B23A55" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M0 -32 L2 -42" stroke="' + L + '" stroke-width="5" stroke-linecap="round"/><path d="M-30 -20 Q-10 -28 10 -26" stroke="#fff" stroke-width="4" opacity="0.35" fill="none" stroke-linecap="round"/></g>';
      case 'flower': {
        let s = '';
        const cy = SPECIES[sp].headCY, cols = ['#FF8FB1', '#FFD166', '#FFFFFF', '#9B8DE8', '#FF8FB1', '#FFD166', '#FFFFFF'];
        for (let i = 0; i < 7; i++) {
          const a = (-150 + i * 20) * Math.PI / 180, x = 200 + Math.cos(a) * 84, y = cy + Math.sin(a) * 70;
          s += '<ellipse cx="' + f(x + 9) + '" cy="' + f(y + 5) + '" rx="8" ry="4" fill="#7CC48A" transform="rotate(30 ' + f(x + 9) + ' ' + f(y + 5) + ')"/>';
          let pe = '';
          for (let k = 0; k < 5; k++) { const b = k * 72 * Math.PI / 180; pe += '<circle cx="' + f(x + Math.cos(b) * 6.5) + '" cy="' + f(y + Math.sin(b) * 6.5) + '" r="5.5"/>'; }
          s += '<g fill="' + cols[i] + '" stroke="' + L + '" stroke-width="1.8">' + pe + '</g><circle cx="' + f(x) + '" cy="' + f(y) + '" r="4" fill="#FFB347" stroke="' + L + '" stroke-width="1.5"/>';
        }
        return s;
      }
      case 'bow': return '<g transform="translate(150 ' + (hy + 18) + ') rotate(-22)"><path d="M0 0 C-14 -20 -36 -16 -32 2 C-30 16 -12 12 0 0 Z M0 0 C14 -20 36 -16 32 2 C30 16 12 12 0 0 Z" fill="#FF6F91"' + st + '/>' +
        '<circle cx="-20" cy="-2" r="2.5" fill="#fff"/><circle cx="20" cy="-2" r="2.5" fill="#fff"/><circle cx="-12" cy="-8" r="2" fill="#fff"/><circle cx="12" cy="-8" r="2" fill="#fff"/>' +
        '<ellipse cx="0" cy="0" rx="7" ry="8" fill="#E2456A"' + st + '/></g>';
      case 'cap': return '<g transform="translate(200 ' + (hy + 10) + ')"><path d="M-46 4 C-46 -40 46 -40 46 4 Z" fill="#4FA9D6"' + st + '/><path d="M8 2 C40 -2 70 2 78 10 C60 14 30 12 8 10 Z" fill="#2F7FAE"' + st + '/>' +
        '<path d="M0 -30 V2 M-24 -22 Q-20 -6 -20 2 M24 -22 Q20 -6 20 2" stroke="#2F7FAE" stroke-width="2" fill="none"/><circle cx="0" cy="-32" r="4.5" fill="#2F7FAE"/>' +
        '<path d="M-30 -20 Q-20 -30 -6 -32" stroke="#fff" stroke-width="3.5" opacity="0.4" fill="none" stroke-linecap="round"/></g>';
      case 'bunny': {
        const ear = (x, r) => '<g transform="translate(' + x + ' -16) rotate(' + r + ')"><ellipse cx="0" cy="-40" rx="13" ry="40" fill="#fff"' + st + '/><ellipse cx="0" cy="-38" rx="6" ry="30" fill="#FFB7CC"/></g>';
        return '<g transform="translate(200 ' + (hy + 14) + ')">' + band('#FFB7CC') + ear(-24, -12) + ear(24, 14) + '</g>';
      }
      case 'chef': return '<g transform="translate(200 ' + (hy + 2) + ')"><path d="M-32 -14 C-52 -20 -46 -56 -22 -50 C-18 -72 18 -72 22 -50 C46 -56 52 -20 32 -14 Z" fill="#fff"' + st + '/>' +
        '<rect x="-32" y="-16" width="64" height="20" rx="4" fill="#fff"' + st + '/><path d="M-12 -18 V-36 M12 -18 V-36" stroke="#E6D8D0" stroke-width="2.5"/></g>';
      case 'heartband': {
        const h = (x) => '<path transform="translate(' + x + ' -58) scale(1.25)" d="M0 7 C-14 -3 -9 -16 0 -8 C9 -16 14 -3 0 7 Z" fill="#FF6F91"' + st + '/>';
        return '<g transform="translate(200 ' + (hy + 14) + ')">' + band('#9B8DE8') + '<path d="M-22 -16 Q-28 -36 -34 -50 M22 -16 Q28 -36 34 -50" stroke="' + L + '" stroke-width="3" fill="none"/>' + h(-34) + h(34) + '</g>';
      }
      case 'santa': return '<g transform="translate(206 ' + (hy + 6) + ') rotate(12)"><path d="M-34 0 C-30 -40 10 -62 40 -40 C26 -40 18 -30 22 -4 Z" fill="#E2456A"' + st + '/>' +
        '<circle cx="42" cy="-40" r="10" fill="#fff"' + st + '/><rect x="-40" y="-10" width="68" height="18" rx="9" fill="#fff"' + st + '/></g>';
      case 'witch': return '<g transform="translate(204 ' + (hy + 4) + ') rotate(-8)"><ellipse cx="0" cy="0" rx="64" ry="13" fill="#6C4FB8"' + st + '/>' +
        '<path d="M-30 -2 L-6 -70 Q4 -82 16 -74 L10 -66 L30 -2 Z" fill="#7E62C9"' + st + '/><path d="M-28 -12 Q0 -4 28 -12 L30 -2 Q0 6 -30 -2 Z" fill="#FFD166"/>' +
        '<rect x="-6" y="-13" width="12" height="10" rx="2" fill="none" stroke="#B07A12" stroke-width="2.5"/></g>';
      case 'cowboy': return '<g transform="translate(200 ' + (hy + 2) + ') rotate(-6)"><path d="M-34 -4 C-36 -38 -20 -50 0 -40 C20 -50 36 -38 34 -4 Q0 6 -34 -4 Z" fill="#C98A5B"' + st + '/>' +
        '<path d="M-34 -10 Q0 0 34 -10" stroke="#7B4A2E" stroke-width="6" fill="none"/><path d="M-74 4 Q-70 -14 -50 -6 Q0 8 50 -6 Q70 -14 74 4 Q0 26 -74 4 Z" fill="#B87A4B"' + st + '/></g>';
      case 'tiara': return '<g transform="translate(200 ' + (hy - 2) + ')"><path d="M-40 8 Q0 -2 40 8" fill="none" stroke="#C9D6DF" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M-30 4 L-24 -10 L-14 0 L0 -22 L14 0 L24 -10 L30 4" fill="#E6EEF2" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round"/><circle cx="0" cy="-8" r="5.5" fill="#FF5E86" stroke="' + L + '" stroke-width="2"/>' +
        '<circle cx="-24" cy="-6" r="3" fill="#7FC8F8"/><circle cx="24" cy="-6" r="3" fill="#7FC8F8"/><circle cx="0" cy="-22" r="2.5" fill="#fff" stroke="' + L + '" stroke-width="1.5"/></g>';
      case 'round': case 'square': {
        let s = '';
        const col = id === 'round' ? '#5B4636' : '#2F2A3A';
        E.forEach((e) => {
          s += id === 'round' ? '<circle cx="' + e.cx + '" cy="' + e.cy + '" r="' + (e.rx + 9) + '" fill="#E6F6FF" fill-opacity="0.18" stroke="' + col + '" stroke-width="5"/>'
            : '<rect x="' + (e.cx - e.rx - 9) + '" y="' + (e.cy - e.ry - 6) + '" width="' + (e.rx * 2 + 18) + '" height="' + (e.ry * 2 + 12) + '" rx="7" fill="#E6F6FF" fill-opacity="0.18" stroke="' + col + '" stroke-width="5"/>';
        });
        return s + '<path d="M' + (E[0].cx + E[0].rx + 9) + ' ' + (E[0].cy - 2) + ' Q200 ' + (E[0].cy - 12) + ' ' + (E[1].cx - E[1].rx - 9) + ' ' + (E[1].cy - 2) + '" stroke="' + col + '" stroke-width="5" fill="none"/>' +
          '<path d="M' + (E[0].cx - E[0].rx - 9) + ' ' + E[0].cy + ' L' + (E[0].cx - E[0].rx - 30) + ' ' + (E[0].cy - 6) + ' M' + (E[1].cx + E[1].rx + 9) + ' ' + E[1].cy + ' L' + (E[1].cx + E[1].rx + 30) + ' ' + (E[1].cy - 6) + '" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M' + (E[0].cx - 12) + ' ' + (E[0].cy - 16) + ' q6 -5 12 -4 M' + (E[1].cx - 12) + ' ' + (E[1].cy - 16) + ' q6 -5 12 -4" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8"/>';
      }
      case 'heart': case 'starg': {
        let s = '';
        const shape = id === 'heart' ? 'M0 10 C-18 -2 -13 -19 0 -9 C13 -19 18 -2 0 10 Z' : 'M0 -13 L4 -4.5 L13 -4 L6 2 L8.5 11 L0 6 L-8.5 11 L-6 2 L-13 -4 L-4 -4.5 Z';
        const fl = id === 'heart' ? '#FF8FB1' : '#FFD166', sk = id === 'heart' ? '#FF3E7F' : '#F4A259';
        E.forEach((e) => { s += '<path transform="translate(' + e.cx + ' ' + (e.cy + 2) + ') scale(' + (id === 'heart' ? 2.3 : 2.2) + ')" d="' + shape + '" fill="' + fl + '" fill-opacity="0.35" stroke="' + sk + '" stroke-width="2" stroke-linejoin="round"/>'; });
        return s + '<path d="M' + (E[0].cx + 26) + ' ' + (E[0].cy - 6) + ' Q200 ' + (E[0].cy - 14) + ' ' + (E[1].cx - 26) + ' ' + (E[1].cy - 6) + '" stroke="' + sk + '" stroke-width="4.5" fill="none"/>';
      }
      case 'sun': {
        let s = '';
        E.forEach((e) => { s += '<rect x="' + (e.cx - e.rx - 11) + '" y="' + (e.cy - e.ry - 4) + '" width="' + (e.rx * 2 + 22) + '" height="' + (e.ry * 2 + 10) + '" rx="14" fill="#2A2340" fill-opacity="0.92" stroke="#111" stroke-width="4"/>' +
          '<path d="M' + (e.cx - e.rx) + ' ' + (e.cy - 6) + ' L' + (e.cx - e.rx + 12) + ' ' + (e.cy - e.ry + 4) + '" stroke="#fff" stroke-width="4" opacity="0.6" stroke-linecap="round"/>'; });
        return s + '<path d="M' + (E[0].cx + E[0].rx + 11) + ' ' + (E[0].cy - 6) + ' L' + (E[1].cx - E[1].rx - 11) + ' ' + (E[1].cy - 6) + '" stroke="#111" stroke-width="5"/>';
      }
      case 'collar': case 'bell': {
        const col = id === 'collar' ? '#F06C8B' : '#4FA9D6';
        let s = '<path d="M146 220 Q200 250 254 220" stroke="' + L + '" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M146 220 Q200 250 254 220" stroke="' + col + '" stroke-width="10" fill="none" stroke-linecap="round"/>' +
          '<g fill="#fff"><circle cx="170" cy="230" r="2"/><circle cx="230" cy="230" r="2"/></g>';
        if (id === 'collar') s += '<circle cx="200" cy="246" r="9" fill="#FFD166" stroke="' + L + '" stroke-width="3"/><path d="M196 244 h8" stroke="#E0A229" stroke-width="2"/>';
        else s += '<circle cx="200" cy="250" r="11" fill="#FFD166" stroke="' + L + '" stroke-width="3"/><path d="M190 250 H210" stroke="' + L + '" stroke-width="2"/><circle cx="200" cy="255" r="2.5" fill="' + L + '"/><path d="M195 244 q3 -3 6 -1" stroke="#fff" stroke-width="2" fill="none"/>';
        return s;
      }
      case 'bandana': return '<path d="M144 218 Q200 248 256 218 L244 236 Q200 296 156 236 Z" fill="#E2456A"' + st + '/>' +
        '<g fill="#fff"><circle cx="186" cy="246" r="3"/><circle cx="212" cy="250" r="3"/><circle cx="198" cy="266" r="3"/><circle cx="170" cy="236" r="2.5"/><circle cx="230" cy="238" r="2.5"/></g>';
      case 'bowtie': return '<g transform="translate(200 238)"><path d="M0 0 L-28 -14 Q-32 0 -28 14 Z M0 0 L28 -14 Q32 0 28 14 Z" fill="#E2456A"' + st + '/>' +
        '<g fill="#fff"><circle cx="-18" cy="-4" r="2.4"/><circle cx="-14" cy="6" r="2.4"/><circle cx="18" cy="-4" r="2.4"/><circle cx="14" cy="6" r="2.4"/></g><rect x="-7" y="-8" width="14" height="16" rx="5" fill="#B23A55"' + st + '/></g>';
      case 'tie': return '<path d="M196 244 L204 244 L212 300 L200 316 L188 300 Z" fill="#5B7FE0"' + st + '/><path d="M191 268 L209 263 M189 288 L211 283" stroke="#FFD166" stroke-width="4"/>' +
        '<path d="M190 232 L210 232 L205 246 L195 246 Z" fill="#4E6FC9"' + st + '/>';
      case 'pearls': return neckCurve(13, (x, y) => '<circle cx="' + f(x) + '" cy="' + f(y + 4) + '" r="6" fill="#fff" stroke="#CDBFB6" stroke-width="1.8"/><circle cx="' + f(x - 2) + '" cy="' + f(y + 2) + '" r="1.6" fill="#fff"/>');
      case 'lei': {
        const cols = ['#FF8FB1', '#FFD166', '#9B8DE8', '#7FC8F8', '#FFFFFF'];
        return neckCurve(9, (x, y, i) => { let p = ''; for (let k = 0; k < 5; k++) { const b = k * 72 * Math.PI / 180; p += '<circle cx="' + f(x + Math.cos(b) * 6) + '" cy="' + f(y + 6 + Math.sin(b) * 6) + '" r="5"/>'; }
          return '<g fill="' + cols[i % cols.length] + '" stroke="' + L + '" stroke-width="1.6">' + p + '</g><circle cx="' + f(x) + '" cy="' + f(y + 6) + '" r="3.2" fill="#FFB347"/>'; });
      }
      case 'scarf': return '<path d="M144 218 Q200 254 256 218" stroke="' + L + '" stroke-width="24" fill="none" stroke-linecap="round"/><path d="M144 218 Q200 254 256 218" stroke="#7FC8F8" stroke-width="18" fill="none" stroke-linecap="round"/>' +
        '<path d="M170 232 l4 -12 M196 240 l4 -14 M222 236 l4 -12" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M222 236 L232 300 L254 296 L244 228 Z" fill="#7FC8F8"' + st + '/><path d="M228 258 L248 255 M230 276 L250 273" stroke="#fff" stroke-width="5"/>' +
        '<path d="M234 300 v8 M240 299 v8 M246 298 v8 M252 297 v8" stroke="' + L + '" stroke-width="2.5" stroke-linecap="round"/>';
      case 'sweater': return '<rect x="100" y="196" width="200" height="140" fill="#9FD8F5"/>' +
        '<path d="M100 258 H300 M100 282 H300" stroke="#fff" stroke-width="7" opacity="0.8"/><path d="M100 270 H300" stroke="#FF8FB1" stroke-width="5"/>' +
        '<rect x="100" y="326" width="200" height="14" fill="#6DBBE6"/><path d="M110 326 v14 M124 326 v14 M138 326 v14 M152 326 v14 M166 326 v14 M180 326 v14 M194 326 v14 M208 326 v14 M222 326 v14 M236 326 v14 M250 326 v14 M264 326 v14 M278 326 v14 M292 326 v14" stroke="#4E9FCC" stroke-width="2"/>' +
        '<path d="M100 340 H300" stroke="' + L + '" stroke-width="3.5"/><path d="M150 216 Q200 244 250 216" stroke="#6DBBE6" stroke-width="12" fill="none"/>';
      case 'hoodie': return '<rect x="100" y="196" width="200" height="150" fill="#FF9EBB"/><path d="M150 216 Q200 246 250 216" stroke="#F27BA0" stroke-width="12" fill="none"/>' +
        '<path d="M186 236 L182 276 M214 236 L218 276" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="182" cy="279" r="3" fill="#fff"/><circle cx="218" cy="279" r="3" fill="#fff"/>' +
        '<path d="M164 296 H236 L246 330 H154 Z" fill="#F27BA0" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round"/><rect x="100" y="334" width="200" height="12" fill="#F27BA0"/><path d="M100 346 H300" stroke="' + L + '" stroke-width="3.5"/>';
      case 'raincoat': return bodyRect('#FFD84D') + '<path d="M200 236 V436" stroke="#E8B400" stroke-width="4"/><g fill="#fff" stroke="' + L + '" stroke-width="2"><circle cx="212" cy="262" r="5"/><circle cx="212" cy="298" r="5"/><circle cx="212" cy="334" r="5"/><circle cx="212" cy="370" r="5"/></g>' +
        '<path d="M146 214 L176 250 L200 236 L224 250 L254 214" fill="#E8B400" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round"/><path d="M130 300 h28 M242 300 h28" stroke="#E8B400" stroke-width="5" stroke-linecap="round"/>';
      case 'overalls': return '<rect x="100" y="320" width="200" height="120" fill="#5B8FD6"/><rect x="162" y="262" width="76" height="70" rx="6" fill="#5B8FD6" stroke="' + L + '" stroke-width="2.5"/>' +
        '<path d="M148 222 L168 268 M252 222 L232 268" stroke="#4A7BC0" stroke-width="10" stroke-linecap="round"/><circle cx="168" cy="270" r="5" fill="#FFD166" stroke="' + L + '" stroke-width="2"/><circle cx="232" cy="270" r="5" fill="#FFD166" stroke="' + L + '" stroke-width="2"/>' +
        '<rect x="186" y="284" width="28" height="22" rx="4" fill="#4A7BC0"/><path d="M100 322 H300" stroke="' + L + '" stroke-width="3"/><path d="M200 330 V440" stroke="#4A7BC0" stroke-width="3" stroke-dasharray="6 5"/>';
      case 'tutu': { // gövdenin üstüne (kırpılmadan) bele çizilir
        let s = '<path d="M122 352 Q200 372 278 352 L290 372 Q200 394 110 372 Z" fill="#FFB7CC"' + st + '/>';
        for (let i = 0; i < 9; i++) { const x = 110 + i * 22.5; s += '<ellipse cx="' + f(x) + '" cy="' + f(384 + Math.sin(i * 1.3) * 2) + '" rx="15" ry="11" fill="' + (i % 2 ? '#FF9EBB' : '#FFC9D9') + '" stroke="' + L + '" stroke-width="2.5"/>'; }
        return s + '<path d="M124 356 Q200 376 276 356" stroke="#F27BA0" stroke-width="6" fill="none"/><circle cx="200" cy="368" r="6" fill="#F27BA0" stroke="' + L + '" stroke-width="2"/>';
      }
      case 'cape': return '<path d="M138 224 C100 300 88 380 94 430 Q200 446 306 430 C312 380 300 300 262 224 Z" fill="#D64561"' + st + '/>' +
        '<path d="M98 420 Q200 436 302 420" stroke="#FFD166" stroke-width="5" fill="none"/><path d="M118 300 Q110 360 112 410" stroke="#fff" stroke-width="5" opacity="0.25" fill="none" stroke-linecap="round"/>';
    }
    return '';
  }
  // mağaza / dolap önizlemesi için: kıyafeti kendi merkezine taşı
  function clothPreview(id, sp, L) {
    const c = { head: [200, sp === 'dog' ? 52 : 60, 0.85], eyes: [200, 134, 0.62], neck: [200, 238, 0.85], body: [200, 300, 0.36] }[CLOTHES[id].slot];
    const o = { flower: [200, 86, 0.85], bow: [150, 84, 1.1], scarf: [200, 254, 0.62], tie: [200, 272, 0.75], cape: [200, 330, 0.3], tutu: [200, 376, 0.42],
      bunny: [200, 30, 0.6], heartband: [200, 50, 0.6], witch: [200, 40, 0.65], cowboy: [200, 64, 0.62], chef: [200, 44, 0.8], santa: [210, 54, 0.75], cap: [214, 62, 0.75],
      pearls: [200, 242, 0.62], lei: [200, 244, 0.6], bandana: [200, 244, 0.75], overalls: [200, 330, 0.36] }[id];
    const k = o || c;
    return '<g transform="scale(' + k[2] + ') translate(' + (-k[0]) + ' ' + (-k[1]) + ')">' + clothMarkup(id, sp, L) + '</g>';
  }

  // ================================================================ Bakım ve hediye eşyaları
  function careIcon(id, L) {
    const st = ' stroke="' + L + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
    switch (id) {
      case 'brush': return '<g transform="rotate(-30)"><rect x="-6" y="4" width="12" height="40" rx="6" fill="#C98A5B"' + st + '/>' +
        '<rect x="-24" y="-26" width="48" height="32" rx="14" fill="#FF8FB1"' + st + '/><path d="M-16 -26 v-8 M-8 -26 v-9 M0 -26 v-9 M8 -26 v-9 M16 -26 v-8" stroke="' + L + '" stroke-width="2.6" stroke-linecap="round"/></g>';
      case 'tooth': return '<g transform="rotate(-35)"><rect x="-5" y="-4" width="10" height="54" rx="5" fill="#7FC8F8"' + st + '/>' +
        '<rect x="-9" y="-28" width="18" height="26" rx="5" fill="#fff"' + st + '/><path d="M-5 -24 h10 M-5 -18 h10 M-5 -12 h10" stroke="#9FD8F5" stroke-width="2.5"/>' +
        '<path d="M-10 -30 Q-4 -40 2 -33 Q8 -42 12 -31" fill="#fff" stroke="#9FD8F5" stroke-width="3"/></g>';
      case 'thermo': return '<g transform="rotate(-40)"><rect x="-6" y="-38" width="12" height="62" rx="6" fill="#fff"' + st + '/><circle cx="0" cy="26" r="9" fill="#FF5E86"' + st + '/>' +
        '<rect x="-2" y="-14" width="4" height="36" fill="#FF5E86"/><path d="M6 -30 h-5 M6 -22 h-5 M6 -14 h-5 M6 -6 h-5" stroke="' + L + '" stroke-width="1.8"/></g>';
      case 'syrup': return '<g><rect x="-14" y="-10" width="28" height="36" rx="8" fill="#B45A8C"' + st + '/><rect x="-8" y="-24" width="16" height="14" rx="3" fill="#fff"' + st + '/>' +
        '<rect x="-10" y="0" width="20" height="14" rx="3" fill="#fff"/><path d="M-4 7 h8 M0 3 v8" stroke="#FF5E86" stroke-width="3"/></g>' +
        '<g transform="translate(22 -6) rotate(-30)"><ellipse cx="0" cy="-12" rx="9" ry="6" fill="#E6EEF2"' + st + '/><ellipse cx="0" cy="-12" rx="5" ry="3" fill="#FF8FB1"/><rect x="-2" y="-6" width="4" height="26" rx="2" fill="#E6EEF2"' + st + '/></g>';
      case 'vitamin': return '<g transform="rotate(-25)"><path d="M-22 0 A11 11 0 0 1 -11 -11 H0 V11 H-11 A11 11 0 0 1 -22 0 Z" fill="#FFB347"' + st + '/><path d="M0 -11 H11 A11 11 0 0 1 11 11 H0 Z" fill="#fff"' + st + '/>' +
        '<path d="M-14 -5 h8" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8"/></g><path d="M18 -18 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 Z" fill="#FFD166" stroke="' + L + '" stroke-width="1.5"/>';
      case 'bottle': return '<g><rect x="-22" y="-20" width="44" height="46" rx="18" fill="#FF8FB1"' + st + '/><rect x="-8" y="-32" width="16" height="14" rx="4" fill="#9B8DE8"' + st + '/>' +
        '<path d="M0 12 C-12 4 -8 -8 0 -2 C8 -8 12 4 0 12 Z" fill="#fff"/><path d="M-14 -10 q-3 10 0 20" stroke="#fff" stroke-width="3" fill="none" opacity="0.6" stroke-linecap="round"/>' +
        '<path d="M-6 -42 q-4 -6 0 -12 M6 -42 q4 -6 0 -12" stroke="#FFB7CC" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
      case 'choco': return '<g transform="rotate(-8)"><rect x="-22" y="-16" width="44" height="32" rx="4" fill="#7B4A2E"' + st + '/>' +
        '<path d="M-8 -16 v32 M6 -16 v32 M-22 0 h28" stroke="#5A3420" stroke-width="2.5"/><path d="M6 -18 H24 V18 H6 Z" fill="#E2456A"' + st + '/><path d="M10 -6 h10 M10 2 h10" stroke="#FFD166" stroke-width="2.5"/></g>';
      case 'glass': return '<g><path d="M-16 -24 L16 -24 L12 24 Q0 28 -12 24 Z" fill="#E6F6FF" fill-opacity="0.7"' + st + '/><path d="M-14 -8 L14 -8 L12 22 Q0 26 -12 22 Z" fill="#9EDCFA"/>' +
        '<path d="M-10 -20 L-8 16" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8"/><circle cx="4" cy="4" r="2.5" fill="#fff"/><circle cx="-3" cy="12" r="2" fill="#fff"/></g>';
      case 'pouch': return '<g><path d="M-24 -14 Q-26 22 -18 24 H18 Q26 22 24 -14 Z" fill="#FF8FB1"' + st + '/><path d="M-24 -14 H24" stroke="' + L + '" stroke-width="3"/>' +
        '<path d="M-22 -14 Q0 -24 22 -14" fill="#FFB7CC"' + st + '/><path d="M14 -18 l6 -10" stroke="#C9D6DF" stroke-width="4" stroke-linecap="round"/><circle cx="21" cy="-30" r="3" fill="#C9D6DF" stroke="' + L + '" stroke-width="1.5"/>' +
        '<path d="M0 14 C-10 7 -7 -3 0 2 C7 -3 10 7 0 14 Z" fill="#fff"/></g>';
    }
    return '';
  }
  // ilaçlar: sürüklenip ağzına götürülür
  const MEDS = {
    thermo:  { name: 'Termometre', desc: 'Ateşini ölç', fx: {} },
    syrup:   { name: 'Şurup', desc: 'Hastalığı iyileştirir', fx: { health: 35, happiness: -2 } },
    vitamin: { name: 'Vitamin', desc: 'Güç ve enerji', fx: { health: 15, energy: 8 } }
  };

  // ================================================================ Ödüller: para zor kazanılır, her bakımın günlük sınırı var
  // xp: deneyim, coins: pati parası, cap: bir günde kaç kez ödül verir (gece 12'de sıfırlanır)
  const REWARDS = {
    eat:       { xp: 2, coins: 1, cap: 3 },
    drink:     { xp: 2, coins: 1, cap: 2 },
    bath:      { xp: 5, coins: 2, cap: 1 },
    brush:     { xp: 3, coins: 1, cap: 1 },
    teeth:     { xp: 3, coins: 1, cap: 2 },
    hide:      { xp: 3, coins: 1, cap: 2 },
    play:      { xp: 1, coins: 0, cap: 8 },
    pet:       { xp: 1, coins: 0, cap: 3 },
    med:       { xp: 2, coins: 0, cap: 2 },
    userWater: { xp: 2, coins: 1, cap: 4 },
    mood:      { xp: 2, coins: 1, cap: 1 },
    checkin:   { xp: 8, coins: 4, cap: 1 },
    medLog:    { xp: 3, coins: 1, cap: 1 },
    forecast:  { xp: 2, coins: 1, cap: 1 }
  };
  const QUEST_REWARD = { xp: 10, coins: 5 }, QUEST_BONUS = 10, LEVEL_BONUS = 5;

  // ================================================================ Günlük görev havuzu (her gün 4 görev: 1 kişisel + 3 bakım)
  const QUESTS = {
    feed:      { text: 'Mama ver', n: 2, icon: 'food' },
    feed3:     { text: 'Gün içinde 3 kez mama ver', n: 3, icon: 'food' },
    healthy:   { text: 'Sağlıklı bir şey yedir', n: 1, icon: 'sprout' },
    treat:     { text: 'Ödül maması ver', n: 1, icon: 'gift' },
    water:     { text: 'Su ver', n: 1, icon: 'drop' },
    water2:    { text: 'İki kez su ver', n: 2, icon: 'drop' },
    bath:      { text: 'Banyo yaptır', n: 1, icon: 'bath' },
    brush:     { text: 'Tüylerini tara', n: 1, icon: 'sparkle' },
    teeth:     { text: 'Dişlerini fırçala', n: 1, icon: 'tooth' },
    teeth2:    { text: 'Dişlerini sabah ve akşam fırçala', n: 2, icon: 'tooth' },
    play:      { text: 'Oyun oyna (5 vuruş)', n: 5, icon: 'gamepad' },
    ball:      { text: 'Topa 3 kez vurdur', n: 3, icon: 'ball' },
    laser:     { text: 'Lazeri 3 kez yakalat', n: 3, icon: 'laser' },
    bubbles:   { text: '6 baloncuk patlat', n: 6, icon: 'bubble' },
    butterfly: { text: 'Kelebekle oynat', n: 2, icon: 'butterfly' },
    hide:      { text: 'Saklambaçta onu bul', n: 1, icon: 'search' },
    pet:       { text: 'Onu sev (10 kez okşa)', n: 10, icon: 'heart' },
    sleep:     { text: 'Işığı kapatıp onu uyut', n: 1, icon: 'moon' },
    wear:      { text: 'Ona bir kıyafet giydir', n: 1, icon: 'hanger' },
    vitamin:   { text: 'Vitamin ver', n: 1, icon: 'pill' },
    userWater: { text: 'Sen de 2 bardak su iç', n: 2, icon: 'glass' },
    userWater4:{ text: 'Sen de 4 bardak su iç', n: 4, icon: 'glass' },
    mood:      { text: 'Ona bugün nasıl olduğunu anlat', n: 1, icon: 'chat' },
    checkin:   { text: 'Bugünkü şikayetlerini ona söyle', n: 1, icon: 'calendar' }
  };
  const SELF_QUESTS = ['userWater', 'userWater4', 'mood', 'checkin'];
  const QUEST_COUNT = 4;

  // ================================================================ Kullanıcının ruh hali ve regl döngüsü
  const USER_MOODS = {
    happy:   { name: 'Mutlu' },
    sad:     { name: 'Üzgün' },
    tired:   { name: 'Yorgun' },
    pain:    { name: 'Ağrılı' },
    angry:   { name: 'Sinirli' },
    anxious: { name: 'Kaygılı' }
  };
  const CYCLE = {
    period:     { label: 'Regl', icon: 'flower', tips: [['Kendine iyi bak, ben yanındayım', 'heart'], ['Karnın ağrıyorsa sıcak su torbası iyi gelir', 'bottle'], ['Bugün dinlenmeyi hak ediyorsun', 'flower'], ['Bol su içmeyi unutma', 'drop'], ['Hafif bir yürüyüş ağrıya iyi gelebilir', 'sprout'], ['Sana sarılmaya geldim', 'heart']] },
    pms:        { label: 'PMS', icon: 'choco', tips: [['Duyguların dalgalıysa bu çok normal', 'heart'], ['Biraz bitter çikolata ister misin?', 'choco'], ['Bugün kendine biraz zaman ayır', 'flower'], ['Tuzu ve kafeini azaltmak iyi gelebilir', 'drop']] },
    follicular: { label: 'Enerjik dönem', icon: 'sprout', tips: [['Enerjin yükseliyor!', 'sprout'], ['Yeni bir şeye başlamak için harika bir gün', 'sparkle'], ['Biraz dans edelim mi?', 'note']] },
    ovulation:  { label: 'Yumurtlama', icon: 'sun', tips: [['Bugün ışıl ışılsın!', 'sun'], ['Enerjin çok yüksek, hadi oynayalım!', 'ball'], ['Su içmeyi unutma', 'drop']] },
    luteal:     { label: 'Sakin dönem', icon: 'leaf', tips: [['Kendine nazik ol', 'leaf'], ['Sıcak bir bitki çayı iyi gelebilir', 'heart'], ['Bu akşam erken uyumak iyi gelebilir', 'moon']] }
  };
  const NEED_LINES = {
    hungry: [['Karnım acıktı!', 'food'], ['Mama zamanı geldi mi?', 'food']],
    thirsty: [['Susadım', 'drop'], ['Biraz su alabilir miyim?', 'drop']],
    tired: [['Uykum geldi…', 'moon'], ['Işığı kapatır mısın?', 'moon']],
    dirty: [['Banyo yapmak istiyorum', 'bath'], ['Biraz kokuyor olabilirim…', 'bath']],
    sad: [['Sıkıldım, oynayalım mı?', 'ball'], ['Beni sever misin?', 'heart']],
    sick: [['Kendimi iyi hissetmiyorum', 'face-sick'], ['Veterinere gidelim mi?', 'vet']],
    happy: [['Seni çok seviyorum!', 'heart'], ['Bugün harika bir gün!', 'sun'], ['Yaşasın!', 'party']],
    neutral: [['Ne yapalım?', 'paw'], ['Merhaba!', 'paw']]
  };
  // uygulamadan liste gelmezse kullanılacak hazır şikayetler (Elora uygulamasındakiyle aynı)
  const DEFAULT_SYMPTOMS = ['Karın ağrısı', 'Bel ağrısı', 'Göğüs hassasiyeti', 'Baş ağrısı', 'Yorgunluk / halsizlik', 'Ruh hali değişimi', 'Şişkinlik', 'Bulantı', 'İshal', 'Kabızlık'];

  // saklambaç: saklandığı yerden kafasının üstü görünür
  function peekMarkup(b, C) {
    const L = C.line, st = ' stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"';
    let ears = '';
    if (b.ears === 'floppy' || b.ears === 'floppySmall') ears = '<ellipse cx="-44" cy="8" rx="13" ry="24" fill="' + C.ear + '"' + st + ' transform="rotate(20 -44 8)"/><ellipse cx="44" cy="8" rx="13" ry="24" fill="' + C.ear + '"' + st + ' transform="rotate(-20 44 8)"/>';
    else if (b.ears === 'folded') ears = '<path d="M-34 -12 L-24 -30 L-12 -18 Z M34 -12 L24 -30 L12 -18 Z" fill="' + C.ear + '"' + st + '/>';
    else ears = '<path d="M-38 -4 L-40 -46 L-12 -22 Z M38 -4 L40 -46 L12 -22 Z" fill="' + C.ear + '"' + st + '/><path d="M-34 -10 L-35 -34 L-18 -20 Z M34 -10 L35 -34 L18 -20 Z" fill="' + C.earInner + '"/>';
    return ears + '<path d="M-48 40 C-50 -22 50 -22 48 40 Z" fill="' + C.fur + '"' + st + '/>' +
      '<g fill="#2A1A14"><ellipse cx="-17" cy="12" rx="7" ry="8"/><ellipse cx="17" cy="12" rx="7" ry="8"/></g>' +
      '<g fill="#fff"><circle cx="-15" cy="9" r="2.6"/><circle cx="19" cy="9" r="2.6"/></g>';
  }
  // saklambaçta sayarken: patileriyle gözlerini kapatmış yüz
  function coverEyesMarkup(b, C) {
    const L = C.line, st = ' stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"';
    const paw = (x, r) => '<g transform="translate(' + x + ' 14) rotate(' + r + ')"><ellipse rx="20" ry="17" fill="' + C.paw + '"' + st + '/><path d="M-8 6 L-8 14 M0 8 L0 16 M8 6 L8 14" stroke="' + L + '" stroke-width="2.6" stroke-linecap="round"/></g>';
    return peekMarkup(b, C) + '<path d="M-48 40 C-48 60 48 60 48 40 Z" fill="' + C.fur + '"' + st + '/>' + paw(-18, 12) + paw(18, -12) +
      '<path d="M-8 40 Q0 46 8 40" fill="none" stroke="' + L + '" stroke-width="3" stroke-linecap="round"/>';
  }
  function boxMarkup(L, back) {
    const st = ' stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"';
    if (back) return '<path d="M-60 -50 L-72 -78 L-10 -70 L0 -50 Z M60 -50 L72 -78 L10 -70 L0 -50 Z" fill="#C99A63"' + st + '/>';
    return '<rect x="-64" y="-50" width="128" height="96" rx="6" fill="#DDB07A"' + st + '/><path d="M-64 -36 H64" stroke="#C99A63" stroke-width="4"/>' +
      '<path d="M-12 -50 V-30 H12 V-50" fill="#F2D6A8" stroke="#C99A63" stroke-width="3"/><path d="M-36 6 C-44 -4 -38 -14 -30 -8 C-22 -14 -16 -4 -24 6 L-30 12 Z" fill="#E59E6D" opacity="0.6"/>';
  }
  function basketMarkup(L) {
    const st = ' stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"';
    let w = '';
    for (let x = -50; x <= 50; x += 14) w += '<path d="M' + x + ' -40 L' + (x * 0.86) + ' 40"/>';
    return '<path d="M-60 -40 H60 L52 40 Q0 48 -52 40 Z" fill="#E8C48F"' + st + '/><g stroke="#C99A63" stroke-width="3">' + w + '<path d="M-58 -16 H58 M-55 12 H55"/></g>' +
      '<rect x="-66" y="-48" width="132" height="14" rx="7" fill="#D9AE73"' + st + '/>' +
      '<path d="M-40 -48 Q-30 -66 -14 -50 M12 -50 Q30 -70 44 -48" stroke="' + L + '" stroke-width="3" fill="#9FD8F5"/>';
  }

  // Banyo: fayanslı duvar, küvet, lavabo ve ayna, havlu, paspas
  function bathMarkup(Wv, Hv, fy, gy) {
    const L = '#5B7A8C', cx = Wv / 2;
    let s = '<rect x="0" y="0" width="' + f(Wv) + '" height="' + f(fy) + '" fill="#E6F6FA"/>';
    let dots = '';
    for (let y = 40, row = 0; y < fy - 200; y += 70, row++) for (let x = (row % 2) * 45 + 30; x < Wv; x += 90) dots += '<circle cx="' + x + '" cy="' + y + '" r="9" fill="none" stroke="#fff" stroke-width="3"/>';
    s += '<g opacity="0.8">' + dots + '</g>';
    // alt duvar fayansları
    const ty = fy - 190;
    s += '<rect x="0" y="' + f(ty) + '" width="' + f(Wv) + '" height="' + f(fy - ty) + '" fill="#BFE8E2"/>';
    let tl = '';
    for (let y = ty + 46; y < fy; y += 46) tl += '<path d="M0 ' + f(y) + ' H' + f(Wv) + '"/>';
    for (let x = 46; x < Wv; x += 46) tl += '<path d="M' + x + ' ' + f(ty) + ' V' + f(fy) + '"/>';
    s += '<g stroke="#fff" stroke-width="3" opacity="0.85">' + tl + '</g>';
    s += '<rect x="0" y="' + f(ty - 12) + '" width="' + f(Wv) + '" height="14" fill="#8FD3C8" stroke="' + L + '" stroke-width="2"/>';
    // ayna + lavabo (sol)
    const mx = Math.max(90, Wv * 0.15), my = ty - 110;
    if (my > 70) s += '<g transform="translate(' + f(mx) + ' ' + f(my) + ')"><ellipse rx="56" ry="70" fill="#F4D6A0" stroke="' + L + '" stroke-width="4"/><ellipse rx="44" ry="58" fill="#D8F0FA"/>' +
      '<path d="M-24 -30 L4 -46 M-28 -10 L14 -34" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.8"/></g>';
    s += '<g transform="translate(' + f(mx) + ' ' + f(ty + 20) + ')" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round">' +
      '<rect x="-12" y="-46" width="8" height="24" rx="3" fill="#C9D6DF"/><path d="M-12 -46 h26 v8 h-18" fill="#C9D6DF"/>' +
      '<path d="M-24 40 L-16 ' + f(fy - ty - 20) + ' L16 ' + f(fy - ty - 20) + ' L24 40 Z" fill="#fff"/>' +
      '<path d="M-62 -24 H62 Q60 40 0 44 Q-60 40 -62 -24 Z" fill="#fff"/><path d="M-52 -18 H52" stroke="#D5E6EE" stroke-width="5"/>' +
      '<rect x="34" y="-60" width="18" height="34" rx="6" fill="#FFB7CC"/><rect x="38" y="-68" width="10" height="9" rx="2" fill="#9B8DE8"/></g>';
    // havlu askısı (sol üst, aynanın sağı)
    const hx = mx + 110, hy = ty - 150;
    if (hy > 60) s += '<g transform="translate(' + f(hx) + ' ' + f(hy) + ')"><rect x="-40" y="-6" width="80" height="8" rx="4" fill="#C9D6DF" stroke="' + L + '" stroke-width="2.5"/>' +
      '<path d="M-32 0 H32 V70 Q32 80 22 80 H-22 Q-32 80 -32 70 Z" fill="#FFB7CC" stroke="' + L + '" stroke-width="3"/><path d="M-32 58 H32" stroke="#fff" stroke-width="5"/><path d="M-32 66 H32" stroke="#F28AA4" stroke-width="3"/></g>';
    // küvet (sağ)
    const bx = Math.min(Wv * 0.8, Wv - 120), bw = 250, bt = fy - 120;
    s += '<g transform="translate(' + f(bx) + ' 0)">' +
      '<path d="M90 ' + f(bt - 160) + ' V' + f(bt - 70) + '" stroke="#C9D6DF" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M90 ' + f(bt - 160) + ' Q90 ' + f(bt - 190) + ' 60 ' + f(bt - 190) + ' L40 ' + f(bt - 190) + '" stroke="#C9D6DF" stroke-width="8" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="34" cy="' + f(bt - 184) + '" rx="22" ry="9" fill="#C9D6DF" stroke="' + L + '" stroke-width="3"/>' +
      '<g fill="#fff" stroke="#BFE3F2" stroke-width="2"><circle cx="-80" cy="' + f(bt - 10) + '" r="18"/><circle cx="-52" cy="' + f(bt - 18) + '" r="22"/><circle cx="-20" cy="' + f(bt - 12) + '" r="18"/><circle cx="18" cy="' + f(bt - 16) + '" r="20"/><circle cx="52" cy="' + f(bt - 10) + '" r="17"/><circle cx="80" cy="' + f(bt - 6) + '" r="14"/></g>' +
      '<g stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round">' +
        '<path d="M' + f(-bw / 2 + 14) + ' ' + f(fy + 6) + ' l-8 18 h22 l4 -18 Z M' + f(bw / 2 - 14) + ' ' + f(fy + 6) + ' l8 18 h-22 l-4 -18 Z" fill="#F4D6A0"/>' +
        '<path d="M' + f(-bw / 2) + ' ' + f(bt) + ' H' + f(bw / 2) + ' Q' + f(bw / 2) + ' ' + f(fy + 14) + ' ' + f(bw / 2 - 60) + ' ' + f(fy + 14) + ' H' + f(-bw / 2 + 60) + ' Q' + f(-bw / 2) + ' ' + f(fy + 14) + ' ' + f(-bw / 2) + ' ' + f(bt) + ' Z" fill="#fff"/>' +
        '<rect x="' + f(-bw / 2 - 10) + '" y="' + f(bt - 8) + '" width="' + f(bw + 20) + '" height="16" rx="8" fill="#fff"/></g>' +
      '<path d="M' + f(-bw / 2 + 20) + ' ' + f(bt + 30) + ' Q' + f(-bw / 2 + 24) + ' ' + f(fy - 4) + ' ' + f(-bw / 2 + 70) + ' ' + f(fy + 2) + '" stroke="#D5E6EE" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      // lastik ördek
      '<g transform="translate(' + f(-bw / 2 + 30) + ' ' + f(bt - 26) + ')" stroke="' + L + '" stroke-width="2.5" stroke-linejoin="round">' +
        '<path d="M-20 4 Q-22 18 0 18 Q22 18 20 2 Q14 -4 8 2 Q2 -6 -10 -2 Q-18 -2 -20 4 Z" fill="#FFD84D"/><circle cx="-6" cy="-12" r="11" fill="#FFD84D"/>' +
        '<path d="M-16 -12 L-26 -9 L-16 -6 Z" fill="#FF9B3D"/><circle cx="-9" cy="-14" r="2" fill="' + L + '" stroke="none"/></g></g>';
    // zemin: dama fayans
    s += '<rect x="0" y="' + f(fy - 8) + '" width="' + f(Wv) + '" height="8" fill="#8FD3C8"/>';
    s += '<rect x="0" y="' + f(fy) + '" width="' + f(Wv) + '" height="' + f(Hv - fy) + '" fill="#F3F7F8"/>';
    let ck = '';
    for (let y = fy, r = 0; y < Hv; y += 40, r++) for (let x = (r % 2) * 40; x < Wv; x += 80) ck += '<rect x="' + x + '" y="' + f(y) + '" width="40" height="40"/>';
    s += '<g fill="#DCEBF0">' + ck + '</g>';
    // paspas
    s += '<rect x="' + f(cx - Wv * 0.3) + '" y="' + f(gy - 30) + '" width="' + f(Wv * 0.6) + '" height="64" rx="32" fill="#9FD8F5" stroke="' + L + '" stroke-width="3"/>' +
      '<rect x="' + f(cx - Wv * 0.3 + 12) + '" y="' + f(gy - 20) + '" width="' + f(Wv * 0.6 - 24) + '" height="44" rx="22" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="3 9" stroke-linecap="round"/>';
    return s;
  }
  function homeIconMarkup(line) {
    return '<path d="M-24 -2 L0 -24 L24 -2" fill="none" stroke="' + line + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M-18 -6 V20 H18 V-6 L0 -20 Z" fill="#F7A9BC" stroke="' + line + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<rect x="-6" y="4" width="12" height="16" rx="3" fill="#FFF3C4" stroke="' + line + '" stroke-width="2.5"/>' +
      '<path d="M6 -26 L14 -34 M-30 10 h-8" stroke="none"/>';
  }

  // ================================================================ Motor
  class PetEngine {
    constructor(container, options) {
      options = options || {};
      this.container = container;
      const sp = options.species === 'cat' ? 'cat' : 'dog';
      this.breed = BREEDS[options.breed] ? options.breed : DEFAULT_BREED[sp];
      this.species = BREEDS[this.breed].species;
      this.eyes = options.eyes && EYES[options.eyes] ? options.eyes : null; // null → cinsin varsayılanı
      this.timeScale = options.timeScale || 1;
      this.autoWake = options.autoWake !== false;
      this.decay = Object.assign({}, DEFAULT_DECAY, options.decay || {});
      this.customColors = options.colors || null;
      this.showTools = options.tools !== false;
      this.showBackground = options.background !== false;
      this.hq = options.quality !== 'low';
      this.scaleOpt = options.petScale || 0;
      this.labels = Object.assign({ food: 'Mama', water: 'Su', game: 'Oyun', light: 'Işık', bath: 'Banyo', home: 'Oda', sponge: 'Sünger', shower: 'Duş', brush: 'Tarak', tooth: 'Diş' }, options.labels || {});
      this.name = options.name || '';
      this.sfx = new Sfx(options.sound !== false);
      this.lightsOff = false; this.night = 0;   // ampul: ışık kapalıyken perde kapanır, oda kararır, hayvan uyur
      this.menu = null;                          // açık tepsi menüsü (mama / banyo / oyun)
      this.game = null;                          // aktif mini oyun (lazer / baloncuk / kelebek)
      this.soaped = false;                       // süngerle köpürtüldü mü
      this.scene = 'room'; this.sceneK = 0;      // 'room' | 'bath' — banyo ayrı sahne, sağa kayarak geçilir
      this._sceneDone = null;
      this.listeners = {};
      this.stats = Object.assign({ fullness: 80, hydration: 80, energy: 80, happiness: 80, cleanliness: 80, health: 100 }, options.stats || {});
      // ilerleme: seviye, pati parası, kıyafetler, günlük görevler
      this.progress = { level: 1, xp: 0, coins: 0, owned: [], wear: { head: null, eyes: null, neck: null, body: null }, quests: { date: '', list: [], bonus: false }, daily: null };
      this.talk = null; this.logOpts = null; this.connected = false; this.askAlways = !!options.ask; this._talkT = 8;
      this.showHud = options.hud !== undefined ? !!options.hud : options.tools !== false;
      this.useClock = options.clock !== false; this.hourOverride = null; this._clockT = 0; this._clockInfo = null;
      this.cycle = null; this._cycleNext = rand(30, 50); this._cycleFirst = false;
      this.userMood = null;
      this.waterEvery = (options.waterReminder === undefined ? 120 : Math.max(0, +options.waterReminder || 0)) * 60; this._waterT = 0;
      this.speech = null; this._sayCool = rand(6, 10); this.panel = null;
      this.groom = 0; this.teethT = 0; this.shine = 0; this.hidden = false; this._petAcc = 0; this._questT = 0;
      this.sleeping = false;
      this.paused = false;

      this.P = Object.assign({}, POSE_DEFAULT);
      this.t = 0; this.breathPhase = 0; this.wagPhase = 0;
      this.blink = { next: rand(1.5, 4), t: -1, dur: 0.18 };
      this.look = { x: 0, y: 0, next: 2 };
      this.earTwitch = { next: rand(3, 7), t: -1, side: 0 };
      this.idleNext = rand(4, 7);
      this.action = null; this.queue = [];
      this.pet = { level: 0, moving: 0, heartDist: 0, x: 200, y: 150, purr: 0 };
      this.item = { type: null, show: 0, amount: 1, scale: 1 };
      this.drag = null; this.auto = null;
      this.ball = { active: false, held: false, x: 0, y: 0, vx: 0, vy: 0, r: 24, rot: 0, hist: [], cool: 0, rest: 0 };
      this.wet = 0; this.showering = false; this.foam = [];
      this.particles = [];
      this.fx = { z: 0, sweat: rand(2, 4), drip: 0, foam: 0, spray: 0, stink: rand(2, 4) };
      this.mood = null;
      this._statsEmit = 0;
      this.raw = { hop: 0, shake: 0, squash: 0, rot: 0, fluff: 0 };

      if (options.state) this.setState(options.state);
      this._checkQuests();
      this._build();
      // bakım yaptıkça ödül ve görev ilerlemesi
      this.on('action', (a) => {
        if (a.phase !== 'end') return;
        const at = this._rewardAt();
        if (a.name === 'eat') { this._quest('feed'); this._quest('feed3'); this._earn('eat', at); }
        else if (a.name === 'drink') { this._quest('water'); this._quest('water2'); this._earn('drink', at); }
        else if (a.name === 'shakeDry') { this._quest('bath'); this._earn('bath', at); }
        else if (a.name === 'med') this._earn('med', at);
      });
      this.on('feed', (e) => { if (e.phase !== 'end') return; if (e.food === 'veggie') this._quest('healthy'); if (e.food === 'treat') this._quest('treat'); });
      this.on('med', (e) => { if (e.phase === 'end' && e.id === 'vitamin') this._quest('vitamin'); });
      this.on('sleep', () => this._quest('sleep'));
      this.on('play', (e) => {
        if (!e || e.kind === 'hide') return;
        this._quest('play');
        const k = { ball: 'ball', laser: 'laser', bubble: 'bubbles', butterfly: 'butterfly' }[e.kind];
        if (k) this._quest(k);
        this._earn('play');
      });
      this._loop = this._loop.bind(this);
      this._last = null;
      this._raf = requestAnimationFrame(this._loop);
      if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => this._layout()); this._ro.observe(container); }
      else { this._onResize = () => this._layout(); window.addEventListener('resize', this._onResize); }
    }

    // ---------------------------------------------------------------- olaylar
    on(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); return this; }
    off(ev, cb) { const l = this.listeners[ev]; if (l) this.listeners[ev] = cb ? l.filter((x) => x !== cb) : []; return this; }
    _emit(ev, data) {
      const call = (cb, args) => { try { cb.apply(null, args); } catch (e) { console.error(e); } };
      (this.listeners[ev] || []).slice().forEach((cb) => call(cb, [data]));
      (this.listeners['*'] || []).slice().forEach((cb) => call(cb, [ev, data]));
    }

    // ---------------------------------------------------------------- kurulum
    _build() {
      this.uid = 'pet' + (++uidCounter);
      const b = BREEDS[this.breed];
      const C = this.C = resolveColors(b, this.eyes, this.customColors);
      const P = Object.assign({}, PALETTES_PROPS);
      const SC = SCENE;
      const built = buildPet(b, C, P, this.uid, this.hq);
      const u = this.uid;
      const slot = (name, icon, label) => '<g data-r="slot' + name + '">' +
        '<rect x="-42" y="-44" width="84" height="88" rx="22" fill="' + SC.tray + '" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
        '<g data-r="icon' + name + '" transform="translate(0 -8)">' + icon + '</g>' +
        '<text y="34" text-anchor="middle" font-family="-apple-system, Roboto, Segoe UI, sans-serif" font-size="14" font-weight="700" fill="' + SC.text + '">' + label + '</text></g>';

      this.container.innerHTML =
        '<svg xmlns="' + SVGNS + '" viewBox="0 0 400 420" preserveAspectRatio="xMidYMid meet" ' +
        'style="width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden">' +
        '<defs>' + built.defs +
          '<linearGradient id="' + u + '-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + SC.wallTop + '"/><stop offset="1" stop-color="' + SC.wallBottom + '"/></linearGradient>' +
        '</defs>' +
        (this.showBackground ? '<g data-r="world"><g data-r="room"></g><g data-r="bathroom"></g></g>' : '') +
        '<ellipse data-r="ballShadow" fill="' + P.shadow + '" display="none"/>' +
        '<g data-r="pet">' + built.pet + '</g>' +
        '<g data-r="gameLayer"></g>' +
        '<g data-r="ball" display="none">' + ballMarkup(C.line) + '</g>' +
        '<rect data-r="night" x="0" y="0" width="10" height="10" fill="#141A3D" opacity="0" style="pointer-events:none"/>' +
        '<g data-r="nameTag" display="none"><rect data-r="nameBg" x="0" y="-19" height="38" rx="19" fill="rgba(255,255,255,0.92)" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
          '<g data-r="nameIcon"></g><text data-r="nameTxt" y="7" font-family="' + FONT + '" font-size="21" font-weight="800" fill="' + SC.text + '"></text></g>' +
        (this.showHud ? '<g data-r="hud" style="pointer-events:none">' +
          '<g transform="translate(14 14)"><rect width="184" height="48" rx="24" fill="rgba(255,255,255,0.94)" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
            '<path d="M24 4 L30 17 L44 18 L33 27 L37 41 L24 33 L11 41 L15 27 L4 18 L18 17 Z" fill="#FFD166" stroke="' + C.line + '" stroke-width="2.5" stroke-linejoin="round"/>' +
            '<text data-r="hudLv" x="24" y="31" text-anchor="middle" font-family="' + FONT + '" font-size="15" font-weight="900" fill="#6B3E2E">1</text>' +
            '<text x="56" y="20" font-family="' + FONT + '" font-size="11" font-weight="800" fill="#B08A82">SEVİYE</text>' +
            '<rect x="56" y="27" width="110" height="10" rx="5" fill="#F6DCE3"/><rect data-r="hudXp" x="56" y="27" width="0" height="10" rx="5" fill="#FFB347"/></g>' +
          '<g transform="translate(14 70)"><rect width="120" height="40" rx="20" fill="rgba(255,255,255,0.94)" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
            '<circle cx="20" cy="20" r="13" fill="#FFD166" stroke="#D68A00" stroke-width="2.5"/><g fill="#D68A00"><ellipse cx="20" cy="23" rx="4.5" ry="3.6"/><circle cx="14.5" cy="17" r="2"/><circle cx="18" cy="14" r="2"/><circle cx="22" cy="14" r="2"/><circle cx="25.5" cy="17" r="2"/></g>' +
            '<text data-r="hudCoins" x="42" y="26" font-family="' + FONT + '" font-size="17" font-weight="900" fill="#8E5E55">0</text></g>' +
          '<g data-r="hudCycle" transform="translate(14 118)" display="none"><rect data-r="hudCycleBg" width="150" height="34" rx="17" fill="#FFE3EC" stroke="#F7A9BC" stroke-width="2.5"/>' +
            '<g data-r="hudCycleIcon"></g><text data-r="hudCycleTxt" x="34" y="22" font-family="' + FONT + '" font-size="13" font-weight="800" fill="#C2456A"></text></g>' +
          '<g data-r="hudBtns"></g></g>' : '') +
        '<g data-r="speech" display="none" style="pointer-events:none"><path data-r="speechBg" fill="#fff" stroke="#F3CFD9" stroke-width="3" stroke-linejoin="round"/><g data-r="speechIcon"></g>' +
          '<text data-r="speechTxt" text-anchor="middle" font-family="' + FONT + '" font-size="17" font-weight="800" fill="' + SC.text + '"></text>' +
          '<g data-r="speechBtn" display="none"><rect data-r="speechBtnBg" height="36" rx="18" fill="#4FA9D6"/><text data-r="speechBtnTxt" text-anchor="middle" font-family="' + FONT + '" font-size="15" font-weight="800" fill="#fff"></text></g></g>' +
        '<g data-r="banner" display="none"><rect data-r="bannerBg" x="0" y="-18" height="36" rx="18" fill="#9B8DE8"/>' +
          '<g data-r="bannerIcon"></g><text data-r="bannerTxt" y="6" font-family="' + FONT + '" font-size="16" font-weight="800" fill="#fff"></text><g data-r="bannerX"></g></g>' +
        (this.showTools ? '<path data-r="hose" fill="none" stroke="' + P.hose + '" stroke-width="8" stroke-linecap="round"/>' +
          '<g data-r="tools">' +
            slot('Food', '<g transform="translate(0 2) scale(0.95)">' + foodIcon('kibble', this.species, P, C.line) + '</g>', this.labels.food) +
            slot('Water', waterIconMarkup(P, C.line), this.labels.water) +
            slot('Game', '<g transform="scale(0.9)">' + gamepadMarkup(C.line) + '</g>', this.labels.game) +
            slot('Light', '<g transform="translate(0 -2) scale(0.85)">' + bulbMarkup(C.line) + '</g>', this.labels.light) +
            slot('Bath', '<g transform="translate(-6 10) rotate(-20) scale(0.75)">' + showerMarkup(P, C.line) + '</g>', this.labels.bath) +
          '</g>' +
          '<g data-r="toolsBath">' +
            slot('Home', '<g transform="translate(0 2) scale(0.95)">' + homeIconMarkup(C.line) + '</g>', this.labels.home) +
            slot('Brush', '<g transform="translate(-2 -2) scale(0.66)">' + careIcon('brush', C.line) + '</g>', this.labels.brush) +
            slot('Tooth', '<g transform="translate(4 4) scale(0.85)">' + careIcon('tooth', C.line) + '</g>', this.labels.tooth) +
            slot('Sponge', '<g transform="scale(0.9)">' + spongeMarkup(C.line, true) + '</g>', this.labels.sponge) +
            slot('Shower', '<g transform="translate(-6 10) rotate(-20) scale(0.75)">' + showerMarkup(P, C.line) + '</g>', this.labels.shower) +
          '</g>' +
          '<g data-r="menu"></g>' +

          '<g data-r="held" style="pointer-events:none">' +
            '<g data-r="heldFood" display="none"></g>' +
            '<g data-r="heldWater" display="none"><g transform="scale(1.3)">' + waterIconMarkup(P, C.line) + '</g></g>' +
            '<g data-r="heldSponge" display="none"><g data-r="spongeArt">' + spongeMarkup(C.line, false) + '</g></g>' +
            '<g data-r="heldShower" display="none">' + showerMarkup(P, C.line) + '</g>' +
            '<g data-r="heldBrush" display="none"><g transform="scale(1.25)">' + careIcon('brush', C.line) + '</g></g>' +
            '<g data-r="heldTooth" display="none"><g transform="scale(1.4)">' + careIcon('tooth', C.line) + '</g></g>' +
          '</g>' : '') +
        '<g data-r="fx" style="pointer-events:none"></g>' +
        (this.showTools ? '<g data-r="panel"></g><g data-r="talk"></g>' : '') +
        '<g data-r="fxTop" style="pointer-events:none"></g>' +
        '</svg>';
      this.svg = this.container.querySelector('svg');
      const r = this.r = {};
      this.svg.querySelectorAll('[data-r]').forEach((n) => {
        const k = n.getAttribute('data-r');
        (r[k + 'All'] = r[k + 'All'] || []).push(n);
        if (!r[k]) r[k] = n;
      });
      // desen noktaları (kol/bacak)
      this._limbDeco();
      this.particles = []; this.foam = [];
      this.menu = null;
      if (this.game) this.stopGame(true);
      this._bindPointer();
      this.speech = null; this.panel = null;
      this._layout();
      this._renderName();
      this._renderScene();
      this._renderWear();
      this._renderHud();
    }

    _limbDeco() {
      const b = BREEDS[this.breed], C = this.C, r = this.r;
      const spots = b.pattern.includes('spots'), tabby = b.pattern.includes('tabby');
      ['arm', 'leg'].forEach((nm) => [0, 1].forEach((i) => {
        const g = r[nm + 'D' + i];
        let s = '';
        if (spots) s = '<circle r="5.5" fill="' + C.spot + '"/><circle r="4.5" fill="' + C.spot + '"/>';
        else if (tabby) s = '<path d="M-9 0 L9 0" stroke="' + C.stripe + '" stroke-width="5" stroke-linecap="round"/><path d="M-9 0 L9 0" stroke="' + C.stripe + '" stroke-width="5" stroke-linecap="round"/>';
        g.innerHTML = s;
      }));
      this._decoKind = spots ? 'spots' : tabby ? 'tabby' : null;
    }

    _layout() {
      const rect = this.container.getBoundingClientRect();
      const w = rect.width || 400, h = rect.height || 420;
      const Wv = Math.max(680, 600 * w / h), Hv = Wv * h / w;
      this.Wv = Wv; this.Hv = Hv;
      this.svg.setAttribute('viewBox', '0 0 ' + f(Wv) + ' ' + f(Hv));
      this.trayH = this.showTools ? 112 : 0;
      this.groundY = Hv - this.trayH - (this.showTools ? 44 : 30);
      this.s = this.scaleOpt || clamp(Math.min((this.groundY - 40) / 440, Wv * 0.6 / 330), 0.6, 1.25);
      this.petX = Wv / 2;
      const fy = this.groundY - 74;
      if (this.r.room) {
        this.r.room.innerHTML = roomMarkup(Wv, Hv, fy, this.groundY, SCENE, this.uid);
        const q = (k) => this.r.room.querySelector('[data-c="' + k + '"]');
        this.win = { sky: q('sky'), sun: q('sun'), moon: q('moon'), cloud: q('cloud'), curtL: q('curtL'), curtR: q('curtR') };
        this._lastNight = -1;
        this.r.bathroom.innerHTML = bathMarkup(Wv, Hv, fy, this.groundY);
      }
      this.r.night.setAttribute('width', f(Wv)); this.r.night.setAttribute('height', f(Hv));
      this.r.nameTag.setAttribute('transform', 'translate(' + f(Wv / 2) + ' 30)');
      this.r.banner.setAttribute('transform', 'translate(' + f(Wv / 2) + ' 76)');
      if (this.menu) this._closeMenu();
      this.floorY = this.groundY + 22; // topun durduğu zemin
      if (this.showTools) {
        const ty = Hv - this.trayH / 2 - 4;
        this.slots = { food: { x: 54, y: ty }, water: { x: 148, y: ty }, game: { x: 242, y: ty }, light: { x: 336, y: ty }, bath: { x: Wv - 54, y: ty },
          home: { x: 54, y: ty }, brush: { x: 148, y: ty }, tooth: { x: 242, y: ty }, sponge: { x: Wv - 148, y: ty }, shower: { x: Wv - 54, y: ty } };
        const place = (el, sl) => el.setAttribute('transform', 'translate(' + f(sl.x) + ' ' + f(sl.y) + ')');
        place(this.r.slotFood, this.slots.food); place(this.r.slotWater, this.slots.water); place(this.r.slotGame, this.slots.game);
        place(this.r.slotLight, this.slots.light); place(this.r.slotBath, this.slots.bath);
        place(this.r.slotHome, this.slots.home); place(this.r.slotSponge, this.slots.sponge); place(this.r.slotShower, this.slots.shower);
        place(this.r.slotBrush, this.slots.brush); place(this.r.slotTooth, this.slots.tooth);
      }
      const B = this.ball;
      if (B.active) { B.x = clamp(B.x, B.r, Wv - B.r); B.y = Math.min(B.y, this.floorY - B.r); }
      if (this.r) { this._renderScene(); this._layoutHud(); if (this.panel) this._closePanel(); }
    }

    // ---------------------------------------------------------------- özelleştirme
    setBreed(id) {
      if (!BREEDS[id] || id === this.breed) return false;
      this.breed = id; this.species = BREEDS[id].species;
      this._rebuild(); this._emit('breed', { breed: id, species: this.species });
      return true;
    }
    setSpecies(sp) {
      sp = sp === 'cat' ? 'cat' : 'dog';
      if (sp === this.species) return;
      this.setBreed(DEFAULT_BREED[sp]);
    }
    setEyes(id) { this.eyes = EYES[id] ? id : null; this._rebuild(); this._emit('eyes', { eyes: this.eyes }); }
    setColors(colors) { this.customColors = colors || null; this._rebuild(); }
    getBreeds(species) {
      return Object.keys(BREEDS).filter((k) => !species || BREEDS[k].species === species).map((k) => {
        const b = BREEDS[k], c = resolveColors(b, null);
        return { id: k, name: b.name, species: b.species, eyes: b.eyes, swatch: [c.fur, c.light, c.ear, c.spot || c.mask || c.patchA || c.patchB || c.saddle || c.point || c.patch || c.stripe || c.tan || c.furShade] };
      });
    }
    _rebuild() {
      this._unbindPointer(); this.drag = null; this.auto = null; this.showering = false;
      const ball = this.ball; this._build(); this.ball = ball;
    }
    setTimeScale(s) { this.timeScale = Math.max(0, +s || 0); }
    destroy() {
      cancelAnimationFrame(this._raf);
      this._unbindPointer();
      if (this._ro) this._ro.disconnect();
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      this.container.innerHTML = '';
      this.listeners = {};
    }
    pause() { this.paused = true; }
    resume() { this.paused = false; this._last = null; }

    // ---------------------------------------------------------------- koordinatlar
    _screenToWorld(e) {
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const pt = this.svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    _toWorld(lx, ly) { return { x: this.petX + (lx - 200) * this.s, y: this.groundY + (ly - G) * this.s }; }
    _toLocal(wx, wy) { return { x: 200 + (wx - this.petX) / this.s, y: G + (wy - this.groundY) / this.s }; }
    _upY() { return this.P.sit * SIT_DROP; }
    // gövde üst çerçevesi (kollar, kafa) için yerel koordinat
    _toUpper(wx, wy) { const l = this._toLocal(wx, wy); return { x: l.x, y: l.y - this._upY() - this.raw.hop }; }
    _headLocal() { const P = this.P; return { x: 200 + P.headX, y: SPECIES[this.species].headCY + P.headY + this._upY() }; }
    _mouthUpper() { const P = this.P; return { x: 200 + P.headX + P.faceX, y: SPECIES[this.species].mouth.y + 6 + P.headY }; }
    _mouthWorld() { const m = this._mouthUpper(); return this._toWorld(m.x, m.y + this._upY() + this.raw.hop); }

    _hit(lx, ly) {
      if (this.hidden) return null;
      const hd = this._headLocal();
      let dx = (lx - hd.x) / 100, dy = (ly - hd.y) / 88;
      if (dx * dx + dy * dy < 1) return 'head';
      const by = 320 + this._upY();
      dx = (lx - 200) / 105; dy = (ly - by) / 120;
      if (dx * dx + dy * dy < 1) return 'body';
      return null;
    }

    // ---------------------------------------------------------------- dokunma
    _bindPointer() {
      const svg = this.svg;
      this._ph = {
        down: (e) => {
          const w = this._screenToWorld(e);
          try { svg.setPointerCapture(e.pointerId); } catch (_) { /* yoksay */ }
          e.preventDefault();
          this.sfx.unlock();
          // konuşma balonundaki buton ("İçtim")
          const sp = this.speech;
          if (sp && sp.hit && w.x > sp.hit.x && w.x < sp.hit.x + sp.hit.w && w.y > sp.hit.y && w.y < sp.hit.y + sp.hit.h) { const fn = sp.onTap; this.speech = null; this.r.speech.setAttribute('display', 'none'); if (fn) fn(); return; }
          if (this.talk) { this._talkDown(w); return; }
          if (this.panel) { this._panelDown(w, e.pointerId); return; }
          // açık menü: bir seçeneğe dokunuldu mu?
          if (this.menu) {
            const cell = this.menu.cells.find((c) => w.x > c.x && w.x < c.x + c.w && w.y > c.y && w.y < c.y + c.h);
            if (cell) { this._menuPick(cell, w, e.pointerId); return; }
            const kind = this.menu.kind; this._closeMenu();
            const sk = this._slotAt(w);
            if (sk && ({ food: 'food', game: 'game' })[sk] === kind) return; // aynı tuş: menüyü kapat
          }
          // oyun şeridindeki kapatma düğmesi
          if (this.game && this.r.banner.getAttribute('display') !== 'none' && Math.abs(w.x - this.Wv / 2) < this._bannerW / 2 && Math.abs(w.y - 76) < 22) { this.stopGame(); return; }
          const B = this.ball;
          if (B.active && !B.held && Math.hypot(w.x - B.x, w.y - B.y) < B.r + 22) { this._grabBall(w, e.pointerId); return; }
          if (this._sceneMoving()) return;
          const hb = this.showHud && !this.drag && !this.auto ? this._hudAt(w) : null;
          if (hb) { if (this.game && this.game.kind === 'hide') this.stopGame(); this._openPanel(hb); return; }
          const sk = this.showTools && !this.auto && !this.drag ? this._slotAt(w) : null;
          if (sk && this.game && this.game.kind === 'hide' && sk !== 'game') this.stopGame();
          if (sk) {
            if (sk === 'food') this._openMenu('food');
            else if (sk === 'water') this._startDrag('water', w.x, w.y, e.pointerId);
            else if (sk === 'game') { if (this.game) this.stopGame(); else this._openMenu('game'); }
            else if (sk === 'light') this.toggleLights();
            else if (sk === 'bath') this.goBath();
            else if (sk === 'home') this.goRoom();
            else if (sk === 'sponge' || sk === 'shower' || sk === 'brush' || sk === 'tooth') this._startDrag(sk, w.x, w.y, e.pointerId);
            return;
          }
          if (this.game && this._gamePointerDown(w, e.pointerId)) return;
          this.pointer = { id: e.pointerId, x: w.x, y: w.y, t0: performance.now(), moved: 0 };
        },
        move: (e) => {
          const w = this._screenToWorld(e);
          const B = this.ball;
          if (B.held && B.pid === e.pointerId) { B.fx = w.x; B.fy = w.y; B.hist.push({ t: performance.now(), x: w.x, y: w.y }); if (B.hist.length > 12) B.hist.shift(); e.preventDefault(); return; }
          if (this.drag && this.drag.id === e.pointerId && !this.drag.returning) { this.drag.fx = w.x; this.drag.fy = w.y; e.preventDefault(); return; }
          const g = this.game;
          if (g && g.kind === 'laser' && g.pid === e.pointerId) { g.dot.x = w.x; g.dot.y = Math.min(w.y, this.floorY); e.preventDefault(); return; }
          const ptr = this.pointer; if (!ptr || ptr.id !== e.pointerId) return;
          const d = Math.hypot(w.x - ptr.x, w.y - ptr.y);
          ptr.x = w.x; ptr.y = w.y; ptr.moved += d;
          const l = this._toLocal(w.x, w.y);
          if (d > 0.5 && this._hit(l.x, l.y)) this._petStroke(w.x, w.y, d / this.s);
          e.preventDefault();
        },
        up: (e) => {
          const B = this.ball;
          if (B.held && B.pid === e.pointerId) { this._throwBall(); return; }
          if (this.drag && this.drag.id === e.pointerId && !this.drag.returning) { this._releaseDrag(); return; }
          const g = this.game;
          if (g && g.kind === 'laser' && g.pid === e.pointerId) { g.dot.on = false; g.pid = null; return; }
          const ptr = this.pointer; if (!ptr || ptr.id !== e.pointerId) return;
          if (ptr.moved < 10 && performance.now() - ptr.t0 < 350) {
            const w = this._screenToWorld(e), l = this._toLocal(w.x, w.y);
            const part = this._hit(l.x, l.y);
            if (part) this._tap(w.x, w.y, part);
          }
          this.pointer = null;
        }
      };
      svg.addEventListener('pointerdown', this._ph.down);
      svg.addEventListener('pointermove', this._ph.move);
      svg.addEventListener('pointerup', this._ph.up);
      svg.addEventListener('pointercancel', this._ph.up);
    }
    _unbindPointer() {
      if (!this.svg || !this._ph) return;
      this.svg.removeEventListener('pointerdown', this._ph.down);
      this.svg.removeEventListener('pointermove', this._ph.move);
      this.svg.removeEventListener('pointerup', this._ph.up);
      this.svg.removeEventListener('pointercancel', this._ph.up);
    }

    _petStroke(wx, wy, d) {
      if (this.drag || this.ball.held || (this.action && this.action.name === 'shakeDry')) return;
      const pet = this.pet, wasLow = pet.level < 0.05;
      pet.level = Math.min(1, pet.level + d * 0.012);
      pet.moving = 0.35;
      const l = this._toLocal(wx, wy); pet.x = l.x; pet.y = l.y;
      pet.heartDist += d;
      if (pet.heartDist > 38) {
        pet.heartDist = 0;
        this._spawn('heart', wx + rand(-10, 10), wy - 10, { vx: rand(-15, 15), vy: rand(-70, -45), s: rand(0.8, 1.25) });
      }
      this.stats.happiness = Math.min(100, this.stats.happiness + d * 0.012);
      this._petAcc += d;
      if (this._petAcc > 260) { this._petAcc = 0; this._quest('pet'); this._earn('pet'); }
      if (wasLow) this._emit('pet', { phase: 'start' });
    }
    petOnce() {
      let n = 0;
      const iv = setInterval(() => {
        const w = this._toWorld(200 + Math.sin(n * 0.5) * 50, 120 + Math.cos(n * 0.3) * 12 + this._upY());
        this._petStroke(w.x, w.y, 9); if (++n > 40) clearInterval(iv);
      }, 30);
    }
    _tap(wx, wy, part) {
      if (this.action && this.action.busy) return;
      if (this.sleeping) { this._startAction(ACTIONS.stir(this)); return; }
      this._spawn('heart', wx, wy - 8, { vx: 0, vy: -60, s: 1 });
      this._startAction(part === 'head' ? ACTIONS.boop(this) : ACTIONS.giggle(this));
      this.sfx.play(this.species === 'dog' ? 'woof' : 'meow');
      this.stats.happiness = Math.min(100, this.stats.happiness + 1);
    }

    _slotAt(w) {
      if (!this.showTools) return null;
      for (const k of this.scene === 'bath' ? ['home', 'brush', 'tooth', 'sponge', 'shower'] : ['food', 'water', 'game', 'light', 'bath']) {
        const sl = this.slots[k];
        if (Math.abs(w.x - sl.x) < 44 && Math.abs(w.y - sl.y) < 46) return k;
      }
      return null;
    }

    // ---------------------------------------------------------------- tepsi menüleri
    _menuItems(kind) {
      const sp = this.species;
      if (kind === 'food') return Object.keys(FOODS).map((id) => ({ id, kind, label: foodName(id, sp), sub: FOODS[id].desc, fx: FOODS[id].fx, icon: foodIcon(id, sp, PALETTES_PROPS, this.C.line) }));
      return [
        { id: 'ball', kind, label: 'Top', sub: 'Fırlat', icon: '<g transform="scale(0.85)">' + ballMarkup(this.C.line) + '</g>' },
        { id: 'laser', kind, label: 'Lazer', sub: 'Parmağını gezdir', icon: '<circle r="16" fill="#FF3B5C" opacity="0.25"/><circle r="8" fill="#FF3B5C"/><circle cx="-2" cy="-2" r="2.5" fill="#fff"/>' },
        { id: 'bubbles', kind, label: 'Baloncuk', sub: 'Patlat', icon: '<g transform="translate(-8 4) scale(0.8)">' + soapBubbleMarkup() + '</g><g transform="translate(12 -10) scale(0.5)">' + soapBubbleMarkup() + '</g>' },
        { id: 'butterfly', kind, label: 'Kelebek', sub: 'Yakala', icon: '<g transform="scale(0.75)">' + butterflyMarkup(this.C.line) + '</g>' },
        { id: 'hide', kind, label: 'Saklambaç', sub: 'Onu bul', icon: '<g transform="translate(0 2) scale(0.5)">' + peekMarkup(BREEDS[this.breed], this.C) + '</g>' }];
    }
    _openMenu(kind) {
      this._closeMenu();
      const items = this._menuItems(kind), SC = SCENE;
      const cw = 104, ch = kind === 'food' ? 132 : 112, gap = 8, pad = 10;
      const cols = Math.min(items.length, Math.max(2, Math.floor((this.Wv - 20 - pad * 2 + gap) / (cw + gap))), kind === 'food' ? 3 : 4);
      const rows = Math.ceil(items.length / cols);
      const W = cols * cw + (cols - 1) * gap + pad * 2, H = rows * ch + (rows - 1) * gap + pad * 2;
      const sl = this.slots[kind];
      const x0 = clamp(sl.x - W / 2, 8, this.Wv - W - 8), y0 = this.Hv - this.trayH - 10 - H;
      const cells = [];
      let m = '<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(W) + '" height="' + f(H) + '" rx="24" fill="#FFF8FA" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
        '<path d="M' + f(sl.x - 12) + ' ' + f(y0 + H - 1.5) + ' L' + f(sl.x) + ' ' + f(y0 + H + 11) + ' L' + f(sl.x + 12) + ' ' + f(y0 + H - 1.5) + ' Z" fill="#FFF8FA" stroke="' + SC.trayEdge + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<rect x="' + f(sl.x - 14) + '" y="' + f(y0 + H - 5) + '" width="28" height="5" fill="#FFF8FA"/>';
      items.forEach((it, i) => {
        const cx = x0 + pad + (i % cols) * (cw + gap), cy = y0 + pad + Math.floor(i / cols) * (ch + gap);
        cells.push({ x: cx, y: cy, w: cw, h: ch, item: it });
        m += '<g transform="translate(' + f(cx) + ' ' + f(cy) + ')">' +
          '<rect width="' + cw + '" height="' + ch + '" rx="18" fill="#fff" stroke="#F6DCE3" stroke-width="2"/>' +
          '<g transform="translate(' + cw / 2 + ' 36)">' + it.icon + '</g>' +
          '<text x="' + cw / 2 + '" y="78" text-anchor="middle" font-family="-apple-system, Roboto, Segoe UI, sans-serif" font-size="13.5" font-weight="800" fill="' + SC.text + '">' + it.label + '</text>' +
          '<text x="' + cw / 2 + '" y="95" text-anchor="middle" font-family="-apple-system, Roboto, Segoe UI, sans-serif" font-size="10.5" font-weight="600" fill="#B08A82">' + it.sub + '</text>';
        if (it.fx) { // etkiler: tokluk, mutluluk, su, enerji (ikon + sayı)
          const ic = { fullness: 'food', happiness: 'heart', hydration: 'drop', energy: 'bolt' };
          const keys = ['fullness', 'happiness', 'hydration', 'energy'].filter((k) => it.fx[k]);
          const pw = keys.map((k) => 15 + String(it.fx[k]).length * 6.4 + 4), tot = pw.reduce((a, b) => a + b, 0);
          let px = (cw - tot) / 2;
          m += '<rect x="6" y="104" width="' + (cw - 12) + '" height="20" rx="10" fill="#FFF1F4"/>';
          keys.forEach((k, j) => {
            m += icon(ic[k], px + 6, 114, 13) + '<text x="' + f(px + 14) + '" y="118" font-family="' + FONT + '" font-size="11" font-weight="800" fill="' + SC.text + '">' + it.fx[k] + '</text>';
            px += pw[j];
          });
        }
        m += '</g>';
      });
      this.r.menu.innerHTML = m;
      this.menu = { kind, cells };
    }
    _closeMenu() { if (this.r.menu) this.r.menu.innerHTML = ''; this.menu = null; }
    _menuPick(cell, w, pid) {
      const it = cell.item, from = { x: cell.x + cell.w / 2, y: cell.y + 36 };
      this._closeMenu();
      if (it.kind === 'food') this._startDrag('food', w.x, w.y, pid, { food: it.id, from });
      else if (it.id === 'ball') this._grabBall(w, pid);
      else this.startGame(it.id);
    }
    getFoods() {
      return Object.keys(FOODS).map((id) => ({ id, name: foodName(id, this.species), desc: FOODS[id].desc, effects: Object.assign({}, FOODS[id].fx) }));
    }

    // ---------------------------------------------------------------- isim
    setName(name) { this.name = String(name || '').slice(0, 24); this._renderName(); this._emit('name', { name: this.name }); }
    _renderName() {
      const r = this.r; if (!r.nameTag) return;
      if (!this.name) { r.nameTag.setAttribute('display', 'none'); return; }
      r.nameTag.setAttribute('display', 'inline');
      r.nameTxt.textContent = this.name;
      let tw = this.name.length * 12;
      try { tw = r.nameTxt.getComputedTextLength() || tw; } catch (e) { /* yoksay */ }
      const w = tw + 70;
      r.nameIcon.innerHTML = icon('paw', -w / 2 + 28, 0, 22);
      r.nameTxt.setAttribute('x', f(-w / 2 + 46));
      r.nameBg.setAttribute('x', f(-w / 2)); r.nameBg.setAttribute('width', f(w));
    }

    // ---------------------------------------------------------------- ışık / uyku
    setLights(on) {
      if (on) { this.lightsOff = false; if (this.sleeping || (this.action && this.action.name === 'sleep')) this.wake(); else this._clearSleepQueue(); }
      else if (!this.lightsOff) { this.lightsOff = true; this.sleep(); }  // banyodaysa sleep() odaya döner
      this._emit('lights', { on: !this.lightsOff });
    }
    toggleLights() { this.setLights(this.lightsOff); }
    _clearSleepQueue() { if (this.queue.some((a) => a.name === 'sleep')) this._clearActions(); }
    _updateNight(dt) {
      const target = this.lightsOff || this.sleeping ? 1 : 0;
      this.night += (target - this.night) * (1 - Math.exp(-dt * 2.5));
      const n = this.night;
      this._clockT -= dt;
      if (this._clockT <= 0 || !this._clockInfo) { this._clockT = 5; const ci = this._clock(); if (!this._clockInfo || ci.sky !== this._clockInfo.sky || ci.cn !== this._clockInfo.cn || ci.sunX !== this._clockInfo.sunX) this._lastNight = -1; this._clockInfo = ci; }
      if (Math.abs(n - this._lastNight) < 0.002) return;
      this._lastNight = n;
      this.r.night.setAttribute('opacity', f(n * 0.5 * 100) / 100);
      const w = this.win, ck = this._clockInfo, dark = Math.max(n, ck.cn);
      if (w && w.sky) {
        w.sky.setAttribute('fill', mix(ck.sky, '#2B3A6B', dark));
        w.sun.setAttribute('cx', f(ck.sunX)); w.sun.setAttribute('cy', f(ck.sunY)); w.sun.setAttribute('fill', ck.h < 9 || ck.h > 17 ? '#FFB86B' : '#FFE08A');
        w.sun.setAttribute('opacity', f(1 - dark)); w.cloud.setAttribute('opacity', f(0.9 * (1 - dark))); w.moon.setAttribute('opacity', f(dark));
        const curt = (sg) => { // perde: açıkken kenarda toplanır, kapalıyken pencereyi örter
          const top = lerp(-80, 1, n), mid = lerp(-58, 0, n), bot = lerp(-82, 1, n);
          const X = (v) => f(v * sg);
          return 'M' + X(-104) + ' -74 L' + X(top) + ' -74 Q' + X(mid + (1 - n) * 6) + ' 0 ' + X(bot) + ' 72 L' + X(-104) + ' 72 Z' +
            (n > 0.3 ? ' M' + X(lerp(-90, -50, n)) + ' -70 Q' + X(lerp(-86, -48, n)) + ' 0 ' + X(lerp(-92, -52, n)) + ' 70' : '');
        };
        w.curtL.setAttribute('d', curt(1)); w.curtR.setAttribute('d', curt(-1));
      }
      if (this.r.bulbGlass) {
        this.r.bulbGlass.setAttribute('fill', mix('#FFE066', '#C9CED6', n));
        this.r.bulbGlow.setAttribute('opacity', f(0.35 * (1 - n)));
      }
    }

    // ---------------------------------------------------------------- mini oyunlar
    startGame(kind) {
      if (this.scene === 'bath') return false;
      if (kind === 'ball') { this.throwBall(); return; }
      if (['laser', 'bubbles', 'butterfly', 'hide'].indexOf(kind) < 0) return;
      this.stopGame(true);
      if (this.sleeping || this.lightsOff) this.setLights(true);
      const g = this.game = { kind, t: 0, dur: 40, cool: 0.6, spawn: 0, items: [], pid: null };
      const layer = this.r.gameLayer;
      if (kind === 'laser') {
        g.dot = { x: this.petX + 120, y: this.floorY - 30, on: false };
        g.el = document.createElementNS(SVGNS, 'g');
        g.el.innerHTML = '<circle r="22" fill="#FF3B5C" opacity="0.22"/><circle r="11" fill="#FF3B5C" opacity="0.45"/><circle r="6.5" fill="#FF2244"/><circle cx="-2" cy="-2" r="2.2" fill="#fff"/>';
        layer.appendChild(g.el);
      } else if (kind === 'butterfly') {
        g.bf = { x: -40, y: this.groundY - 330 * this.s, vx: 0, vy: 0, tx: this.petX - 120 * this.s, ty: this.groundY - 340 * this.s, retarget: 1.5, land: 0, ph: 0 };
        g.el = document.createElementNS(SVGNS, 'g');
        g.el.innerHTML = butterflyMarkup(this.C.line);
        g.wings = g.el.querySelectorAll('[data-w]');
        layer.appendChild(g.el);
      } else if (kind === 'hide') { this._clearActions(); this._startHide(g); }
      const label = { laser: ['Lazer: parmağını sahnede gezdir', 'laser'], bubbles: ['Baloncukları patlat', 'bubble'], butterfly: ['Kelebeğe dokun', 'butterfly'], hide: ['Saklambaç', 'search'] }[kind];
      this._setBanner(label[0], label[1], true);
      this._emit('game', { name: kind, phase: 'start' });
    }
    stopGame(silent) {
      const g = this.game; if (!g) return;
      if (g.el) g.el.remove();
      g.items.forEach((b) => b.el.remove());
      this.game = null;
      if (g.kind === 'hide') this.hidden = false;
      if (this.r.banner) this.r.banner.setAttribute('display', 'none');
      if (!silent) this._emit('game', { name: g.kind, phase: 'end' });
    }
    _gamePointerDown(w, pid) {
      const g = this.game;
      if (w.y > this.Hv - this.trayH - 6) return false;
      if (g.kind === 'hide') return this._hideTap(w);
      if (g.kind === 'laser') { g.pid = pid; g.dot.on = true; g.dot.x = w.x; g.dot.y = Math.min(w.y, this.floorY); return true; }
      if (g.kind === 'bubbles') {
        const b = g.items.find((it) => Math.hypot(it.x - w.x, it.y - w.y) < it.r + 16);
        if (b) { this._popGameBubble(b, false); return true; }
      }
      if (g.kind === 'butterfly' && Math.hypot(g.bf.x - w.x, g.bf.y - w.y) < 50) { // kelebek burnuna konar
        g.bf.land = 3; this.stats.happiness = Math.min(100, this.stats.happiness + 3); this.sfx.play('sparkle'); this._emit('play', { kind: 'butterfly' }); return true;
      }
      return false;
    }
    _popGameBubble(b, byPet) {
      const g = this.game; if (!g) return;
      const i = g.items.indexOf(b); if (i < 0) return;
      g.items.splice(i, 1); b.el.remove();
      this._spawn('bubble', b.x, b.y, { vy: -20, life: 0.4, s: b.r / 10 });
      for (let k = 0; k < 5; k++) this._spawn('drop', b.x, b.y, { vx: rand(-120, 120), vy: rand(-120, 40), g: 300, life: 0.5, s: 0.5 });
      this.sfx.play('pop');
      this.stats.happiness = Math.min(100, this.stats.happiness + (byPet ? 1.5 : 0.5));
      this._emit('play', { kind: 'bubble' });
    }
    _updateGame(dt, T) {
      const g = this.game; if (!g) return;
      g.t += dt; g.cool -= dt;
      if (g.t > g.dur) { this.stopGame(); return; }
      if (g.kind === 'hide') { this._updateHide(dt, T, g); return; }
      const awake = !this.sleeping && !(this.action && this.action.busy);
      let tgt = null;
      if (g.kind === 'laser') {
        const dot = g.dot;
        g.el.setAttribute('display', dot.on ? 'inline' : 'none');
        g.el.setAttribute('transform', 'translate(' + f(dot.x + Math.sin(this.t * 40) * 1.2) + ' ' + f(dot.y) + ')');
        if (dot.on) tgt = { x: dot.x, y: dot.y, obj: dot };
      } else if (g.kind === 'bubbles') {
        g.spawn -= dt;
        if (g.spawn <= 0 && g.items.length < 9) {
          g.spawn = rand(0.45, 0.8);
          const el = document.createElementNS(SVGNS, 'g'); el.innerHTML = soapBubbleMarkup();
          this.r.gameLayer.appendChild(el);
          const fromLeft = Math.random() < 0.5;
          g.items.push({ el, x: fromLeft ? rand(30, this.Wv * 0.3) : rand(this.Wv * 0.7, this.Wv - 30), y: this.floorY + 10, vy: -rand(55, 95), ph: rand(0, 6), r: rand(13, 22) });
        }
        for (let i = g.items.length - 1; i >= 0; i--) {
          const b = g.items[i];
          b.y += b.vy * dt; b.ph += dt * 2; const x = b.x + Math.sin(b.ph) * 18;
          b.cx = x;
          if (b.y < -30) { b.el.remove(); g.items.splice(i, 1); continue; }
          b.el.setAttribute('transform', 'translate(' + f(x) + ' ' + f(b.y) + ') scale(' + f(b.r / 16) + ')');
        }
        let best = null, bd = 1e9; const hl = this._headLocal(), hw = this._toWorld(hl.x, hl.y);
        g.items.forEach((b) => { const d = Math.hypot(b.cx - hw.x, b.y - hw.y); if (d < bd) { bd = d; best = b; } });
        if (best) tgt = { x: best.cx, y: best.y, obj: best };
      } else if (g.kind === 'butterfly') {
        const bf = g.bf; bf.ph += dt * 22;
        if (bf.land > 0) { // burnuna kondu: şaşı mutlu bakış
          bf.land -= dt;
          const m = this._mouthWorld();
          bf.x += (m.x - bf.x) * (1 - Math.exp(-dt * 8)); bf.y += (m.y - 52 * this.s - bf.y) * (1 - Math.exp(-dt * 8));
          if (!this.sleeping) { T.lookX = 0; T.lookY = 0.2; T.pupil = 1; T.smile = 1; T.blush = 0.8; T.mouthOpen = 0.25; T.wagFreq = 3; T.wagAmp = 22;
            this.P.lookX *= 0.5; }
          if (bf.land <= 0) { bf.tx = this.petX + rand(-220, 220) * this.s; bf.ty = this.groundY - rand(260, 420) * this.s; bf.retarget = 1.6; }
        } else {
          bf.retarget -= dt;
          if (bf.retarget <= 0) {
            bf.retarget = rand(1.2, 2.2);
            bf.tx = clamp(this.petX + rand(-230, 230) * this.s, 40, this.Wv - 40); bf.ty = clamp(this.groundY - rand(140, 430) * this.s, 60, this.floorY - 40);
          }
          const ax = (bf.tx - bf.x) * 2.2, ay = (bf.ty - bf.y) * 2.2 + Math.sin(this.t * 7) * 60;
          bf.vx += (ax - bf.vx) * dt * 2; bf.vy += (ay - bf.vy) * dt * 2;
          bf.x += bf.vx * dt; bf.y += bf.vy * dt;
          tgt = { x: bf.x, y: bf.y, obj: bf };
        }
        const flap = Math.abs(Math.sin(bf.ph)) * 0.75 + 0.25;
        g.el.setAttribute('transform', 'translate(' + f(bf.x) + ' ' + f(bf.y) + ') rotate(' + f(clamp(bf.vx / 20, -20, 20)) + ') scale(0.9)');
        g.wings[0].setAttribute('transform', 'scale(' + f(flap) + ' 1)'); g.wings[1].setAttribute('transform', 'scale(' + f(flap) + ' 1)');
      }
      if (!tgt || this.sleeping) return;
      this._lookAtWorld(T, tgt.x, tgt.y, 0.8);
      T.pupil = 1; T.wagFreq = Math.max(T.wagFreq, 2.6); T.wagAmp = Math.max(T.wagAmp, 18); T.earLift = Math.max(T.earLift, 0.4); T.smile = Math.max(T.smile, 0.8);
      if (!awake || g.cool > 0) return;
      const u = this._toUpper(tgt.x, tgt.y), l = this._toLocal(tgt.x, tgt.y);
      const live = () => (g.kind === 'bubbles' ? [tgt.obj.cx, tgt.obj.y] : [tgt.obj.x, tgt.obj.y]);
      const onHit = () => {
        if (!this.game) return;
        const [x, y] = live();
        if (g.kind === 'bubbles') this._popGameBubble(tgt.obj, true);
        else if (g.kind === 'butterfly') { // kelebek kaçar
          tgt.obj.tx = clamp(tgt.obj.x + (tgt.obj.x < this.petX ? -1 : 1) * 260 * this.s, 40, this.Wv - 40); tgt.obj.ty = this.groundY - rand(320, 440) * this.s; tgt.obj.retarget = 1.8;
          this._spawn('text', x, y - 26, { text: 'hihi!', vy: -40, life: 0.9, size: 17, color: '#F06C8B' }); this.sfx.play('sparkle');
          this.stats.happiness = Math.min(100, this.stats.happiness + 2);
        } else { this._spawn('sparkle', x, y, { vy: -50, vr: 200, life: 0.6 }); this.sfx.play('pew'); this.stats.happiness = Math.min(100, this.stats.happiness + 2); }
        this.stats.energy = Math.max(0, this.stats.energy - 0.4);
        if (g.kind !== 'bubbles') this._emit('play', { kind: g.kind });
      };
      if (g.kind === 'laser' && l.y > 405 && Math.abs(l.x - 200) < 140) { // yerdeki noktaya atlar
        g.cool = 1.4; this._startAction(ACTIONS.hop(this)); setTimeout(onHit, 300); return;
      }
      for (let i = 0; i < 2; i++) {
        const S = SHOULDER[i];
        if (Math.hypot(u.x - S[0], u.y - S[1]) < 125 && (i === 0 ? u.x < 215 : u.x > 185)) {
          g.cool = g.kind === 'bubbles' ? 0.6 : 1.1;
          this._startAction(ACTIONS.swat(this, i, { pos: live, hit: onHit }));
          return;
        }
      }
    }

    // ---------------------------------------------------------------- top
    _grabBall(w, pid) {
      const B = this.ball;
      B.active = true; B.held = true; B.pid = pid; B.fx = w.x; B.fy = w.y; B.x = w.x; B.y = w.y; B.vx = 0; B.vy = 0;
      B.hist = [{ t: performance.now(), x: w.x, y: w.y }];
      this._emit('drag', { tool: 'ball', phase: 'start' });
    }
    _throwBall() {
      const B = this.ball;
      B.held = false;
      const now = performance.now();
      const h = B.hist.filter((p) => now - p.t < 110);
      if (h.length >= 2) {
        const a = h[0], z = h[h.length - 1], dt = Math.max(0.016, (z.t - a.t) / 1000);
        B.vx = clamp((z.x - a.x) / dt, -1600, 1600); B.vy = clamp((z.y - a.y) / dt, -1800, 1600);
      } else { B.vx = 0; B.vy = 0; }
      if (this.showTools && B.y > this.Hv - this.trayH - 10 && Math.hypot(B.vx, B.vy) < 300) B.active = false; // tepsiye geri bırakıldı
      this._emit('drag', { tool: 'ball', phase: 'end', used: B.active });
    }
    throwBall() { // programatik: top köşeden hayvana doğru atılır
      if (this.scene === 'bath') return false;
      const B = this.ball;
      B.active = true; B.held = false; B.x = 40; B.y = this.groundY - 260 * this.s;
      B.vx = (this.petX - 40) * 1.6; B.vy = -380;
    }

    _updateBall(dt, T) {
      const B = this.ball, r = this.r;
      if (!B.active) { r.ball.setAttribute('display', 'none'); r.ballShadow.setAttribute('display', 'none'); if (r.iconBall) r.iconBall.setAttribute('display', 'inline'); return; }
      if (r.iconBall) r.iconBall.setAttribute('display', 'none');
      B.cool -= dt;
      if (B.held) {
        const k = 1 - Math.exp(-dt * 30);
        const px = B.x, py = B.y;
        B.x += (B.fx - B.x) * k; B.y += (B.fy - 20 - B.y) * k;
        B.rot += (B.x - px) * 2;
        B.vx = (B.x - px) / Math.max(dt, 0.001); B.vy = (B.y - py) / Math.max(dt, 0.001);
      } else {
        B.vy += 1500 * dt;
        B.x += B.vx * dt; B.y += B.vy * dt;
        const floor = this.floorY - B.r;
        if (B.y > floor) {
          B.y = floor;
          if (B.vy > 160) { B.vy = -B.vy * 0.62; if (B.vy < -300) this._spawn('dust', B.x, this.floorY, { life: 0.5 }); }
          else B.vy = 0;
          B.vx *= Math.pow(0.35, dt);
        }
        if (B.x < B.r) { B.x = B.r; B.vx = Math.abs(B.vx) * 0.8; }
        if (B.x > this.Wv - B.r) { B.x = this.Wv - B.r; B.vx = -Math.abs(B.vx) * 0.8; }
        if (B.y < B.r) { B.y = B.r; B.vy = Math.abs(B.vy) * 0.5; }
        B.rot += B.vx * dt / B.r * 57.3;
        this._ballVsPet();
      }
      r.ball.setAttribute('display', 'inline');
      r.ball.setAttribute('transform', 'translate(' + f(B.x) + ' ' + f(B.y) + ') rotate(' + f(B.rot % 360) + ')');
      const hgt = clamp((this.floorY - B.r - B.y) / 400, 0, 1);
      r.ballShadow.setAttribute('display', 'inline');
      r.ballShadow.setAttribute('cx', f(B.x)); r.ballShadow.setAttribute('cy', f(this.floorY - 2));
      r.ballShadow.setAttribute('rx', f(B.r * (1 - hgt * 0.5))); r.ballShadow.setAttribute('ry', f(6 * (1 - hgt * 0.5)));
      r.ballShadow.setAttribute('opacity', f(1 - hgt * 0.7));

      // hayvan topu izler
      if (!this.sleeping) {
        const speed = Math.hypot(B.vx, B.vy);
        if (B.held || speed > 40) this._lookAtWorld(T, B.x, B.y, 0.8);
        if (B.held && !(this.action && this.action.busy)) { // yakalamaya hazır: kollar havada
          T.h0x = 140; T.h0y = 262; T.h1x = 260; T.h1y = 262;
          T.smile = 1; T.mouthOpen = Math.max(T.mouthOpen, 0.3); T.wagFreq = 3.5; T.wagAmp = 22; T.earLift = 0.6; T.pupil = 1;
        }
      }
    }
    _lookAtWorld(T, x, y, faceAmt) {
      const hl = this._headLocal(), hw = this._toWorld(hl.x, hl.y);
      T.lookX = clamp((x - hw.x) / 140, -1, 1); T.lookY = clamp((y - hw.y) / 140, -1, 1);
      T.faceX = clamp((x - hw.x) / 18, -9, 9) * (faceAmt == null ? 1 : faceAmt);
    }
    _ballVsPet() {
      const B = this.ball;
      const u = this._toUpper(B.x, B.y);
      const awake = !this.sleeping && !(this.action && this.action.busy) && this.P.sit < 0.2;
      const rr = B.r / this.s;
      if (awake && B.cool <= 0) {
        // kafa vuruşu
        const hy = SPECIES[this.species].headCY + this.P.headY;
        if (u.y < hy - 40 && u.y > hy - 170 && Math.abs(u.x - 200) < 90 && B.vy > 0) { this._startAction(ACTIONS.header(this)); return; }
        // tekme (top yerde, ayakların yanında)
        const l = this._toLocal(B.x, B.y);
        if (l.y > 395 && Math.abs(l.x - 200) < 100 + rr && Math.abs(B.vx) < 600) { this._startAction(ACTIONS.kick(this, l.x < 200 ? 0 : 1)); return; }
        // pati ile vurma
        for (let i = 0; i < 2; i++) {
          const S = SHOULDER[i];
          if (Math.hypot(u.x - S[0], u.y - S[1]) < 118 + rr && (i === 0 ? u.x < 215 : u.x > 185)) { this._startAction(ACTIONS.swat(this, i)); return; }
        }
      }
      // hayvanın içinden geçmesin: gövdeden sek
      const l = this._toLocal(B.x, B.y);
      const by = 300 + this._upY();
      const dx = (l.x - 200) / (110 + rr), dy = (l.y - by) / (170 + rr);
      if (dx * dx + dy * dy < 1 && l.y < G + 10) {
        const side = l.x < 200 ? -1 : 1;
        B.vx = side * Math.max(Math.abs(B.vx) * 0.7, 220);
        B.x = this.petX + side * (110 + rr) * this.s * Math.sqrt(Math.max(0, 1 - dy * dy)) + side * 2;
      }
    }
    _hitBall(vx, vy) {
      const B = this.ball;
      B.vx = vx; B.vy = vy; B.cool = 0.5;
      this.sfx.play('boing');
      this._spawn('sparkle', B.x, B.y, { vy: -60, s: 0.9, vr: 200, life: 0.6 });
      this._spawn('text', B.x, B.y - 30, { text: 'boing!', vy: -50, life: 0.8, size: 18, color: '#F06C8B' });
      this.stats.happiness = Math.min(100, this.stats.happiness + 2.5);
      this.stats.energy = Math.max(0, this.stats.energy - 0.6);
      this._emit('play', { kind: 'ball' });
    }

    // ---------------------------------------------------------------- sürüklenen araçlar
    _startDrag(type, x, y, id, opt) {
      opt = opt || {};
      const sl = opt.from || this.slots[type];
      this.drag = { type, id, fx: x, fy: y, x: sl.x, y: sl.y, returning: null, food: opt.food || 'treat', lastMove: [x, y] };
      if (type === 'food') this.r.heldFood.innerHTML = '<g transform="scale(1.3)">' + (MEDS[this.drag.food] ? careIcon(this.drag.food, this.C.line) : foodIcon(this.drag.food, this.species, PALETTES_PROPS, this.C.line)) + '</g>';
      if (type === 'sponge') this.r.spongeArt.innerHTML = spongeMarkup(this.C.line, false);
      if (this.menu) this._closeMenu();
      this._emit('drag', { tool: type, phase: 'start', food: type === 'food' ? this.drag.food : undefined });
    }
    _itemOffset(type) { return type === 'food' ? [0, -55] : type === 'water' ? [0, -45] : type === 'sponge' ? [0, -34] : type === 'brush' ? [10, -40] : type === 'tooth' ? [14, -30] : [-36, 36]; }
    _releaseDrag() {
      const d = this.drag; if (!d) return;
      let used = false;
      if (d.type === 'food') {
        const m = this._mouthWorld();
        if (Math.hypot(d.x - m.x, d.y - m.y) < 90 * this.s + 24 && this._canInteract()) {
          if (MEDS[d.food]) { used = true; this._medTake(d.food); }
          else if (this.stats.fullness >= 96 && !FOODS[d.food].drink) this._startAction(ACTIONS.refuse(this));
          else { used = true; this._clearActions(); this._startAction(ACTIONS.nom(this, d.food)); }
        }
      } else if (d.type === 'water') {
        const l = this._toLocal(d.x, d.y);
        if (Math.abs(l.x - 200) < 175 && l.y > 40 && l.y < G + 40 && this._canInteract()) {
          used = true; this._clearActions(); this._startAction(ACTIONS.drink(this));
        }
      } else if (d.type === 'shower') {
        if (this.showering) this._emit('action', { name: 'bath', phase: 'end' });
        this.showering = false;
        this.sfx.water(false);
        // köpük tamamen durulandıysa silkelenir; köpük kaldıysa beklemeye devam eder
        if (this.wet > 0.15 && this.foam.length === 0) { this._clearActions(); this._startAction(ACTIONS.shakeDry(this)); }
        else if (this.foam.length) { const hw = this._toWorld(200, this._headLocal().y - 120); this._iconToast(hw.x, hw.y, [['drop', 'Durula!']], { color: '#4FA9D6', size: 18, vy: -30, life: 1.4 }); }
      } else if (d.type === 'sponge') {
        this.showering = false;
      }
      this._emit('drag', { tool: d.type, phase: 'end', used });
      if (used) { this.drag = null; this._hideHeld(); return; }
      const sl = this.slots[d.type];
      d.returning = { t: 0, x0: d.x, y0: d.y, x1: sl.x, y1: sl.y };
    }
    _hideHeld() {
      ['heldFood', 'heldWater', 'heldShower', 'heldSponge', 'heldBrush', 'heldTooth'].forEach((k) => this.r[k] && this.r[k].setAttribute('display', 'none'));
      if (this.r.iconWater) ['iconWater', 'iconShower', 'iconSponge', 'iconBrush', 'iconTooth'].forEach((k) => this.r[k].setAttribute('display', 'inline'));
    }
    _canInteract() { return !(this.action && this.action.busy) && !this.sleeping && !this.hidden; }

    _updateDrag(dt, T) {
      const d = this.drag;
      if (this.auto && d) {
        const a = this.auto; a.t += dt;
        const pos = a.path(a.t);
        d.fx = pos[0]; d.fy = pos[1];
        if (a.t >= a.dur) { this.auto = null; this._releaseDrag(); if (a.onEnd) a.onEnd(); }
      }
      if (!d) { this.showering = false; this.sfx.water(false); this._renderHeld(); return; }
      const off = this._itemOffset(d.type);
      if (d.returning) {
        const rt = d.returning; rt.t += dt * 3.5;
        const k = smooth01(rt.t);
        d.x = lerp(rt.x0, rt.x1, k); d.y = lerp(rt.y0, rt.y1, k) - Math.sin(k * Math.PI) * 40;
        if (rt.t >= 1) { this.drag = null; this._hideHeld(); this._renderHeld(); return; }
      } else {
        const k = 1 - Math.exp(-dt * 25);
        d.x += (d.fx + off[0] - d.x) * k; d.y += (d.fy + off[1] - d.y) * k;
      }
      this._renderHeld();
      if (d.returning) { this.showering = false; this.sfx.water(false); return; }

      const awake = !this.sleeping && !(this.action && this.action.busy);
      if (d.type === 'food' || d.type === 'water') {
        if (!awake) return;
        const m = this._mouthWorld();
        const dist = Math.hypot(d.x - m.x, d.y - m.y);
        this._lookAtWorld(T, d.x, d.y);
        const k = clamp(1 - (dist - 60) / 280, 0, 1);
        if (d.type === 'food' && this.stats.fullness >= 96 && !FOODS[d.food].drink) { // tok: başını çevirir, eliyle "hayır" yapar
          T.faceX = -Math.sign(d.x - m.x || 1) * 9; T.lookX = -T.lookX; T.smile = 0.1; T.mouthOpen = 0; T.tongue = 0; T.brow = 0.3;
          T.h1x = 250 + Math.sin(this.t * 14) * 14; T.h1y = 240;
          return;
        }
        T.pupil = 1; T.wagFreq = lerp(T.wagFreq, 3, k); T.wagAmp = lerp(T.wagAmp, 22, k); T.tailBase = lerp(T.tailBase, -10, k);
        T.earLift = lerp(T.earLift, 0.6, k); T.brow = lerp(T.brow, -0.1, k); T.smile = lerp(T.smile, 0.9, k);
        const near = smooth01((k - 0.35) / 0.5);
        T.mouthOpen = Math.max(T.mouthOpen, near * (d.type === 'food' ? 1 : 0.5));
        T.tongue = Math.max(T.tongue, near * (d.type === 'food' ? 0.25 : 0.8));
        // kollarını uzatıp almaya çalışır
        const u = this._toUpper(d.x, d.y);
        if (k > 0.25) {
          const reach = smooth01((k - 0.25) / 0.4);
          T.h0x = lerp(T.h0x, u.x - 22, reach); T.h0y = lerp(T.h0y, u.y + 10, reach);
          T.h1x = lerp(T.h1x, u.x + 22, reach); T.h1y = lerp(T.h1y, u.y + 10, reach);
        }
        if (d.type === 'food' && near > 0.6 && Math.random() < dt * 2) this._spawn('drop', m.x + rand(-10, 10), m.y + 20 * this.s, { vy: 30, g: 300, life: 0.8, s: 0.7 });
        return;
      }
      if (d.type === 'brush' || d.type === 'tooth') { this._updateGroom(d, dt, T, awake); return; }
      const l = this._toLocal(d.x, d.y);
      if (d.type === 'sponge') { // sünger: dokunduğu yeri köpürtür
        const over = this._hit(l.x, l.y);
        const mv = Math.hypot(d.x - d.lastMove[0], d.y - d.lastMove[1]); d.lastMove = [d.x, d.y];
        this.showering = !!over;
        if (!over) { if (awake) this._lookAtWorld(T, d.x, d.y); return; }
        if (mv > 1.5) {
          this.fx.foam -= dt;
          if (this.fx.foam <= 0) { this.fx.foam = 0.06; this._addFoamAt(l.x, l.y + 24); }
          this.sfx.play('squish');
          if (Math.random() < dt * 10) this._spawn('bubble', d.x + rand(-25, 25), d.y - 10, { vx: rand(-30, 30), vy: rand(-80, -40), life: 0.8, s: rand(0.3, 0.6) });
          this.stats.cleanliness = Math.min(100, this.stats.cleanliness + dt * 6);
          if (!this.soaped && this.foam.length > 6) { this.soaped = true; this.r.spongeArt.innerHTML = spongeMarkup(this.C.line, true); }
        }
        if (awake) this._bathPose(T);
        return;
      }
      // duş başlığı: su akar, köpükleri durular
      this.sfx.water(true);
      this.fx.spray -= dt;
      while (this.fx.spray <= 0) {
        this.fx.spray += 1 / 45;
        this._spawn('drop', d.x + rand(-26, 26), d.y + 8, { vx: rand(-25, 25), vy: rand(260, 340), g: 500, life: 0.55, s: rand(0.5, 0.8) });
      }
      const over = Math.abs(l.x - 200) < 150 && l.y < 330 + this._upY();
      if (over !== this.showering) { this.showering = over; if (over) this._emit('action', { name: 'bath', phase: 'start' }); }
      if (!over) { if (awake) this._lookAtWorld(T, d.x, d.y); return; }
      this.wet = Math.min(1, this.wet + dt * 0.45);
      this.stats.cleanliness = Math.min(100, this.stats.cleanliness + dt * (this.soaped ? 8 : 3));
      this.fx.foam -= dt;
      if (this.fx.foam <= 0 && this.foam.length) { // su değen köpükler patlar
        this.fx.foam = 0.05;
        const near = this.foam.filter((b) => Math.abs(b.x + (b.part === 'head' ? this.P.headX : 0) - l.x) < 70);
        if (near.length) this._popFoamBubble(near[Math.floor(Math.random() * near.length)]);
      }
      if (Math.random() < dt * 8) this._spawnL('drop', clamp(l.x + rand(-40, 40), 120, 280), this._headLocal().y - 70, { vx: rand(-90, 90), vy: rand(-140, -60), g: 500, life: 0.6, s: 0.7 });
      if (awake) this._bathPose(T);
    }
    _bathPose(T) {
      const dog = this.species === 'dog';
      T.eyeOpen = 0; T.closedCurve = dog ? 0.7 : 0.1; T.squint = 1;
      T.smile = dog ? 0.7 : -0.3; T.brow = dog ? 0.1 : -0.4; T.mouthOpen = dog ? 0.3 : 0.12; T.tongue = dog ? 0.3 : 0;
      T.earLift = -1; T.tailBase = dog ? 5 : 30; T.wagAmp = dog ? 14 : 2; T.wagFreq = dog ? 2.5 : 0.5;
      T.headY += 4; T.lookY = -0.6; T.blush = dog ? 0.3 : 0;
      // elleriyle köpükleri ovalar: biri kafada, biri karnında (ara ara yer değiştirir)
      const ph = Math.floor(this.t / 1.3) % 2, c = Math.cos(this.t * 13), s2 = Math.sin(this.t * 13);
      const head = [170 + c * 12, 92 + s2 * 8 + this.P.headY], belly = [215 + c * 14, 318 + s2 * 10];
      const head2 = [230 + c * 12, 92 + s2 * 8 + this.P.headY], belly2 = [185 + c * 14, 318 + s2 * 10];
      if (ph === 0) { T.h0x = head[0]; T.h0y = head[1]; T.h1x = belly[0]; T.h1y = belly[1]; }
      else { T.h0x = belly2[0]; T.h0y = belly2[1]; T.h1x = head2[0]; T.h1y = head2[1]; }
    }

    _renderHeld() {
      const r = this.r; if (!this.showTools) return;
      const d = this.drag;
      const sl = this.slots.shower;
      let hx = sl.x + 29, hy = sl.y - 33;
      if (d && d.type === 'shower') { hx = d.x + 58; hy = d.y - 58; }
      r.hose.setAttribute('display', d && d.type === 'shower' && this.scene === 'bath' ? 'inline' : 'none');
      const ax = this.Wv + 10, ay = this.Hv - 20;
      r.hose.setAttribute('d', 'M' + f(ax) + ' ' + f(ay) + ' C' + f(ax - 30) + ' ' + f(ay - 90) + ' ' + f(hx + 90) + ' ' + f(hy + 20) + ' ' + f(hx) + ' ' + f(hy));
      if (!d) return;
      const k = { food: 'heldFood', water: 'heldWater', shower: 'heldShower', sponge: 'heldSponge', brush: 'heldBrush', tooth: 'heldTooth' }[d.type];
      r[k].setAttribute('display', 'inline');
      const wob = d.type === 'shower' ? Math.sin(this.t * 30) * 1.5 : 0;
      r[k].setAttribute('transform', 'translate(' + f(d.x) + ' ' + f(d.y) + ') rotate(' + f(wob) + ')');
      if (d.type === 'water') r.iconWater.setAttribute('display', 'none');
      if (d.type === 'shower') r.iconShower.setAttribute('display', 'none');
      if (d.type === 'sponge') r.iconSponge.setAttribute('display', 'none');
      if (d.type === 'brush') r.iconBrush.setAttribute('display', 'none');
      if (d.type === 'tooth') r.iconTooth.setAttribute('display', 'none');
    }

    // süngerin değdiği noktaya köpük (yerel koordinat)
    _addFoamAt(lx, ly) {
      if (this.foam.length > 56) return;
      const P = this.P, up = this._upY(), part = this._hit(lx + rand(-14, 14), ly);
      if (!part) return;
      let x = lx + rand(-18, 18), y = ly + rand(-14, 14), layer;
      if (part === 'head') { x -= P.headX; y -= P.headY + up; layer = this.r.foamHead; }
      else { y -= up; layer = this.r.foamBody; }
      const g = document.createElementNS(SVGNS, 'g');
      g.innerHTML = '<circle r="1" fill="#fff" stroke="' + PALETTES_PROPS.foamEdge + '" stroke-width="0.12"/>' +
        '<circle cx="-0.35" cy="-0.35" r="0.22" fill="#fff"/><path d="M0.25 0.55 A0.6 0.6 0 0 0 0.6 0.2" stroke="' + PALETTES_PROPS.foamEdge + '" stroke-width="0.1" fill="none"/>';
      layer.appendChild(g);
      this.foam.push({ el: g, x, y, r: 0, rt: rand(6, 14), part, ph: rand(0, 6) });
    }
    _popFoamBubble(b) {
      const i = this.foam.indexOf(b); if (i < 0) return;
      this.foam.splice(i, 1);
      let lx = b.x, ly = b.y + this._upY();
      if (b.part === 'head') { lx += this.P.headX; ly += this.P.headY; }
      this._spawnL('bubble', lx, ly, { vx: rand(-60, 60), vy: rand(-120, -50), life: 0.9, s: b.r / 10 });
      this.sfx.play('pop');
      b.el.remove();
    }
    _addFoam(lx) {
      if (this.foam.length > 46) return;
      const P = this.P, hd = this._headLocal(), up = this._upY();
      const onHead = Math.random() < 0.55;
      let x, y, layer, part;
      if (onHead) {
        x = clamp(lx + rand(-55, 55), 125, 275);
        const ex = (x - hd.x) / 85;
        const lim = Math.sqrt(Math.max(0, 1 - ex * ex)) * 70;
        y = hd.y - lim * rand(0.55, 1.05);
        x -= P.headX; y -= P.headY + up;
        layer = this.r.foamHead; part = 'head';
      } else {
        x = clamp(lx + rand(-60, 60), 135, 265);
        y = rand(240, 380);
        layer = this.r.foamBody; part = 'body';
      }
      const g = document.createElementNS(SVGNS, 'g');
      g.innerHTML = '<circle r="1" fill="#fff" stroke="' + PALETTES_PROPS.foamEdge + '" stroke-width="0.12"/>' +
        '<circle cx="-0.35" cy="-0.35" r="0.22" fill="#fff"/><path d="M0.25 0.55 A0.6 0.6 0 0 0 0.6 0.2" stroke="' + PALETTES_PROPS.foamEdge + '" stroke-width="0.1" fill="none"/>';
      layer.appendChild(g);
      this.foam.push({ el: g, x, y, r: 0, rt: rand(6, 15), part, ph: rand(0, 6) });
    }
    _updateFoam(dt) {
      for (const b of this.foam) {
        b.r += (b.rt - b.r) * (1 - Math.exp(-dt * 8));
        const j = 1 + Math.sin(this.t * 3 + b.ph) * 0.06;
        b.el.setAttribute('transform', 'translate(' + f(b.x) + ' ' + f(b.y) + ') scale(' + f(b.r * j) + ')');
      }
    }
    _popFoam(n) {
      for (let i = 0; i < n && this.foam.length; i++) {
        const b = this.foam.splice(Math.floor(Math.random() * this.foam.length), 1)[0];
        let lx = b.x, ly = b.y + this._upY();
        if (b.part === 'head') { lx += this.P.headX; ly += this.P.headY; }
        this._spawnL('bubble', lx, ly, { vx: rand(-60, 60), vy: rand(-120, -50), life: 0.9, s: b.r / 10 });
        this.sfx.play('pop');
        b.el.remove();
      }
    }

    // ================================================================ üst bilgi çubuğu (seviye, pati parası, butonlar)
    _hudButtons() {
      return [['quests', 'list', 'Görevler'], ['shop', 'bag', 'Mağaza'], ['wardrobe', 'hanger', 'Dolap'], ['talk', 'chat', 'Konuş'], ['vet', 'vet', 'Veteriner']];
    }
    _layoutHud() {
      const r = this.r; if (!r.hudBtns) return;
      const SC = SCENE, x = this.Wv - 40;
      this.hudHits = [];
      let m = '';
      this._hudButtons().forEach((b, i) => {
        const y = 42 + i * 74;
        this.hudHits.push({ id: b[0], x, y });
        m += '<g transform="translate(' + f(x) + ' ' + y + ')"><circle r="26" fill="rgba(255,255,255,0.94)" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
          icon(b[1], 0, 0, 30) +
          '<text y="42" text-anchor="middle" font-family="' + FONT + '" font-size="11" font-weight="800" fill="' + SC.text + '" stroke="#fff" stroke-width="3" paint-order="stroke">' + b[2] + '</text>' +
          '<circle data-b="' + b[0] + '" cx="19" cy="-19" r="8" fill="#FF5E86" stroke="#fff" stroke-width="2.5" display="none"/></g>';
      });
      r.hudBtns.innerHTML = m;
      this._renderHud();
    }
    _hudAt(w) {
      if (!this.hudHits || this.scene !== 'room') return null;
      const h = this.hudHits.find((b) => Math.hypot(w.x - b.x, w.y - b.y) < 30);
      return h ? h.id : null;
    }
    _renderHud() {
      const r = this.r; if (!r || !r.hudLv) return;
      const pr = this.progress;
      r.hudLv.textContent = pr.level;
      r.hudXp.setAttribute('width', f(110 * clamp(pr.xp / this._xpNeed(pr.level), 0, 1)));
      r.hudCoins.textContent = pr.coins;
      if (this.cycle && CYCLE[this.cycle.phase]) {
        const c = CYCLE[this.cycle.phase];
        r.hudCycleIcon.innerHTML = icon(c.icon, 18, 17, 20);
        r.hudCycleTxt.textContent = c.label + (this.cycle.phase === 'period' && this.cycle.day ? ' · ' + this.cycle.day + '. gün' : '');
        let w = 150; try { w = r.hudCycleTxt.getComputedTextLength() + 46 || w; } catch (e) { /* yoksay */ }
        r.hudCycleBg.setAttribute('width', f(w));
        r.hudCycle.setAttribute('display', 'inline');
      } else r.hudCycle.setAttribute('display', 'none');
      if (r.hudBtns) {
        const badge = (id, on) => { const e = r.hudBtns.querySelector('[data-b="' + id + '"]'); if (e) e.setAttribute('display', on ? 'inline' : 'none'); };
        badge('quests', pr.quests.list.some((q) => QUESTS[q.id] && q.have >= QUESTS[q.id].n && !q.claimed));
        badge('vet', this.stats.health < 40);
        badge('talk', !(pr.daily && pr.daily.done && pr.daily.done.checkin));
      }
    }

    // ================================================================ konuşma balonu
    // opt: { icon: 'heart', button: 'İçtim', onTap: fn }
    say(text, dur, opt) {
      opt = opt || {};
      const r = this.r; if (!r.speech || !text) return;
      this.speech = { text, t: 0, dur: dur || 3, button: opt.button || null, onTap: opt.onTap || null, iw: opt.icon ? 36 : 0 };
      const lines = [], words = String(text).split(' ');
      let cur = '';
      words.forEach((wd) => { if ((cur + ' ' + wd).trim().length > 24 && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); });
      if (cur) lines.push(cur);
      r.speechTxt.innerHTML = lines.map((l, i) => '<tspan x="0" dy="' + (i ? 22 : 0) + '">' + esc(l) + '</tspan>').join('');
      r.speechIcon.innerHTML = opt.icon ? icon(opt.icon, 0, 0, 28) : '';
      let w = Math.max.apply(null, lines.map((l) => l.length)) * 9.5;
      try { w = r.speechTxt.getBBox().width || w; } catch (e) { /* yoksay */ }
      const btnH = this.speech.button ? 44 : 0;
      if (this.speech.button) {
        r.speechBtnTxt.textContent = this.speech.button;
        let bw = 110; try { bw = r.speechBtnTxt.getComputedTextLength() + 40 || bw; } catch (e) { /* yoksay */ }
        w = Math.max(w, bw - this.speech.iw);
        this.speech.bw = bw;
      }
      this.speech.w = w + 32 + this.speech.iw; this.speech.h = lines.length * 22 + 24 + btnH; this.speech.lines = lines.length;
      r.speech.setAttribute('display', 'inline');
      r.speechBtn.setAttribute('display', this.speech.button ? 'inline' : 'none');
      this._emit('say', { text });
    }
    _updateSpeech(dt) {
      const sp = this.speech, r = this.r; if (!sp || !r.speech) return;
      sp.t += dt;
      if (sp.t > sp.dur || this.hidden || this.talk) { this.speech = null; r.speech.setAttribute('display', 'none'); return; }
      const hl = this._headLocal(), a = this._toWorld(hl.x + 64, hl.y - 70);
      const W = sp.w, H = sp.h;
      let x0 = clamp(a.x - 34, 8, this.Wv - W - 64), y1 = Math.max(a.y, H + 62), y0 = y1 - H;
      const tx = clamp(a.x - 18, x0 + 20, x0 + W - 30), x1 = x0 + W, rr = 18;
      r.speechBg.setAttribute('d', 'M' + f(x0 + rr) + ' ' + f(y0) + ' H' + f(x1 - rr) + ' Q' + f(x1) + ' ' + f(y0) + ' ' + f(x1) + ' ' + f(y0 + rr) + ' V' + f(y1 - rr) + ' Q' + f(x1) + ' ' + f(y1) + ' ' + f(x1 - rr) + ' ' + f(y1) +
        ' H' + f(tx + 16) + ' L' + f(tx - 8) + ' ' + f(y1 + 22) + ' L' + f(tx) + ' ' + f(y1) + ' H' + f(x0 + rr) + ' Q' + f(x0) + ' ' + f(y1) + ' ' + f(x0) + ' ' + f(y1 - rr) + ' V' + f(y0 + rr) + ' Q' + f(x0) + ' ' + f(y0) + ' ' + f(x0 + rr) + ' ' + f(y0) + ' Z');
      const btnH = sp.button ? 44 : 0;
      r.speechTxt.setAttribute('transform', 'translate(' + f(x0 + sp.iw + (W - sp.iw) / 2) + ' ' + f(y0 + 28) + ')');
      r.speechTxt.querySelectorAll('tspan').forEach((t) => t.setAttribute('x', '0'));
      r.speechIcon.setAttribute('transform', 'translate(' + f(x0 + 30) + ' ' + f(y0 + (H - btnH) / 2) + ')');
      if (sp.button) {
        const bw = sp.bw, bx = x0 + (W - bw) / 2, by = y1 - 48;
        r.speechBtnBg.setAttribute('x', f(bx)); r.speechBtnBg.setAttribute('y', f(by)); r.speechBtnBg.setAttribute('width', f(bw));
        r.speechBtnTxt.setAttribute('x', f(bx + bw / 2)); r.speechBtnTxt.setAttribute('y', f(by + 24));
        sp.hit = { x: bx, y: by, w: bw, h: 36 };
      }
      const k = sp.t < 0.18 ? 0.6 + 0.4 * smooth01(sp.t / 0.18) : sp.t > sp.dur - 0.25 ? clamp((sp.dur - sp.t) / 0.25, 0, 1) : 1;
      r.speech.setAttribute('transform', 'translate(' + f(tx) + ' ' + f(y1) + ') scale(' + Math.round(k * 100) / 100 + ') translate(' + f(-tx) + ' ' + f(-y1) + ')');
      r.speech.setAttribute('opacity', f(Math.min(1, k * 1.4)));
    }
    _sayLine(line, dur) { if (line) this.say(line[0], dur || 3.2, { icon: line[1] }); }
    _autoSay(mood) {
      if (this._sayCool > 0 || this.speech || this.hidden || this.talk) return;
      const hr = this._clockInfo ? this._clockInfo.h : 12;
      let lines = NEED_LINES[mood] || NEED_LINES.neutral, p = mood === 'happy' || mood === 'neutral' ? 0.3 : 0.75;
      if ((hr >= 23 || hr < 6) && !this.lightsOff && Math.random() < 0.5) { lines = [['Geç oldu, uyuyalım mı?', 'moon'], ['Işığı kapatırsan uyurum', 'moon']]; p = 1; }
      else if (this.cycle && CYCLE[this.cycle.phase] && (mood === 'happy' || mood === 'neutral') && Math.random() < 0.5) { lines = CYCLE[this.cycle.phase].tips; p = 0.8; }
      if (Math.random() > p) return;
      this._sayLine(lines[Math.floor(Math.random() * lines.length)]);
      this._sayCool = rand(16, 26);
    }
    // ikon + yazı parçalarından uçan bir etiket ("+2 [para] +5 [yıldız]" gibi)
    _iconToast(x, y, parts, opt) {
      opt = opt || {};
      const size = opt.size || 17, col = opt.color || '#D68A00';
      let m = '', cx = 0;
      parts.forEach((p) => {
        if (p[0]) { m += icon(p[0], cx + 11, -size * 0.35, size + 5); cx += 25; }
        if (p[1]) { m += '<text x="' + f(cx) + '" y="0" font-family="' + FONT + '" font-size="' + size + '" font-weight="900" fill="' + col + '" stroke="#fff" stroke-width="3.5" paint-order="stroke">' + esc(p[1]) + '</text>'; cx += String(p[1]).length * size * 0.58 + 10; }
      });
      this._spawn('icontext', x, y, { markup: '<g transform="translate(' + f(-cx / 2) + ' 0)">' + m + '</g>', vy: opt.vy || -45, life: opt.life || 1.5 });
    }

    // ================================================================ ilerleme: seviye, pati parası, görevler
    _xpNeed(lv) { return 80 + lv * 40; }
    _rewardAt() { const hl = this._headLocal(); return this._toWorld(hl.x, hl.y - 120); }
    reward(xp, coins, at) {
      const pr = this.progress;
      xp = Math.max(0, xp | 0); coins = Math.max(0, coins | 0);
      pr.xp += xp; pr.coins += coins;
      if (at && (xp || coins)) {
        const parts = [];
        if (coins) parts.push(['coin', '+' + coins]);
        if (xp) parts.push(['star', '+' + xp]);
        this._iconToast(at.x, at.y, parts);
        if (coins) this.sfx.play('coin');
      }
      let up = false;
      while (pr.xp >= this._xpNeed(pr.level)) { pr.xp -= this._xpNeed(pr.level); pr.level++; up = true; }
      if (up) {
        pr.coins += LEVEL_BONUS;
        const unlocked = Object.keys(CLOTHES).filter((id) => CLOTHES[id].level === pr.level).map((id) => CLOTHES[id].name);
        this.say('Seviye ' + pr.level + ' oldum!' + (unlocked.length ? ' Mağazada yeni: ' + unlocked.join(', ') : ''), 4.5, { icon: 'star' });
        if (!this.sleeping && !this.hidden && !(this.action && this.action.busy)) this._startAction(ACTIONS.celebrate(this));
        this.sfx.play('chime');
        this._emit('level', { level: pr.level, unlocked });
      }
      this._renderHud();
      this._emit('progress', this.getProgress());
    }
    // bakım ödülü: her bakımın günlük bir sınırı var (gece 12'de sıfırlanır)
    _earn(key, at) {
      const R = REWARDS[key]; if (!R) return false;
      this._checkQuests();
      const c = this.progress.daily.c, n = c[key] || 0;
      if (n >= R.cap) return false;
      c[key] = n + 1;
      this.reward(R.xp, R.coins, at);
      return true;
    }
    getProgress() {
      const pr = this.progress;
      return { level: pr.level, xp: pr.xp, xpNeed: this._xpNeed(pr.level), coins: pr.coins, owned: pr.owned.slice(), wear: Object.assign({}, pr.wear),
        quests: pr.quests.list.filter((q) => QUESTS[q.id]).map((q) => ({ id: q.id, text: QUESTS[q.id].text, have: q.have, need: QUESTS[q.id].n, claimed: !!q.claimed })) };
    }
    _today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    _todayISO() { const d = new Date(), p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    // gün değişince (gece 12) görevler ve günlük ödül sayaçları yenilenir
    _checkQuests() {
      const pr = this.progress, today = this._today();
      if (!pr.daily || pr.daily.date !== today) pr.daily = { date: today, c: {}, done: {}, asked: {} };
      if (pr.quests.date === today && pr.quests.list.length) return;
      let seed = 0;
      for (let i = 0; i < today.length; i++) seed = (seed * 31 + today.charCodeAt(i)) % 2147483647;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const pick = [SELF_QUESTS[Math.floor(rnd() * SELF_QUESTS.length)]];
      const pool = Object.keys(QUESTS).filter((k) => SELF_QUESTS.indexOf(k) < 0);
      const fam = (k) => k.replace(/\d+$/, ''); // aynı türden iki görev (feed + feed3) aynı gün gelmez
      let guard = 0;
      while (pick.length < QUEST_COUNT && guard++ < 200) { const k = pool[Math.floor(rnd() * pool.length)]; if (!pick.some((p) => fam(p) === fam(k))) pick.push(k); }
      pr.quests = { date: today, list: pick.map((id) => ({ id, have: 0, claimed: false })), bonus: false };
      this._renderHud();
      if (this.panel && this.panel.kind === 'quests') this._openPanel('quests');
      this._emit('quests', this.getProgress().quests);
    }
    _quest(id, n) {
      this._checkQuests();
      const q = this.progress.quests.list.find((x) => x.id === id);
      if (!q || q.claimed) return;
      const need = QUESTS[id].n;
      if (q.have >= need) return;
      q.have = Math.min(need, q.have + (n || 1));
      if (q.have >= need) {
        this._iconToast(this.Wv / 2, 128, [['check', 'Görev tamam: ' + QUESTS[id].text]], { color: '#3FAE8C', size: 17, vy: -18, life: 2.4 });
        this.sfx.play('sparkle');
        this._emit('quest', { id, phase: 'done' });
      }
      this._renderHud();
      if (this.panel && this.panel.kind === 'quests') this._openPanel('quests');
    }
    claimQuest(id) {
      const pr = this.progress, q = pr.quests.list.find((x) => x.id === id);
      if (!q || q.claimed || !QUESTS[id] || q.have < QUESTS[id].n) return false;
      q.claimed = true;
      this.reward(QUEST_REWARD.xp, QUEST_REWARD.coins, { x: this.Wv / 2, y: 150 });
      if (!pr.quests.bonus && pr.quests.list.every((x) => x.claimed)) {
        pr.quests.bonus = true;
        setTimeout(() => { this.reward(0, QUEST_BONUS, { x: this.Wv / 2, y: 190 }); this.say('Bugünün tüm görevleri bitti!', 3, { icon: 'party' }); }, 600);
      }
      this._emit('quest', { id, phase: 'claimed' });
      if (this.panel && this.panel.kind === 'quests') this._openPanel('quests');
      return true;
    }

    // ---------------------------------------------------------------- mağaza / dolap
    getShop() {
      const pr = this.progress;
      return Object.keys(CLOTHES).map((id) => ({ id, name: CLOTHES[id].name, slot: CLOTHES[id].slot, price: CLOTHES[id].price, level: CLOTHES[id].level,
        owned: pr.owned.indexOf(id) >= 0, worn: pr.wear[CLOTHES[id].slot] === id }));
    }
    buy(id) {
      const c = CLOTHES[id], pr = this.progress;
      if (!c) return { ok: false, reason: 'unknown' };
      if (pr.owned.indexOf(id) >= 0) return { ok: false, reason: 'owned' };
      if (pr.level < c.level) return { ok: false, reason: 'level' };
      if (pr.coins < c.price) return { ok: false, reason: 'coins' };
      pr.coins -= c.price; pr.owned.push(id);
      this.wear(id);
      this.sfx.play('chime');
      this._emit('buy', { id, price: c.price });
      this._renderHud();
      return { ok: true };
    }
    wear(id) {
      const c = CLOTHES[id], pr = this.progress;
      if (!c || pr.owned.indexOf(id) < 0) return false;
      pr.wear[c.slot] = id;
      this._renderWear();
      if (!this.sleeping && !this.hidden && !this.action) this._startAction(ACTIONS.hop(this));
      for (let i = 0; i < 4; i++) this._spawnL('sparkle', rand(130, 270), rand(60, 300), { vy: -30, life: 0.8, s: 0.8 });
      this._quest('wear');
      this._emit('wear', Object.assign({}, pr.wear));
      return true;
    }
    unwear(slot) {
      const pr = this.progress;
      if (slot) pr.wear[slot] = null; else CLOTH_SLOTS.forEach((k) => { pr.wear[k] = null; });
      this._renderWear();
      this._emit('wear', Object.assign({}, pr.wear));
    }
    _renderWear() {
      const r = this.r; if (!r || !r.wearHead) return;
      const w = this.progress.wear, sp = this.species, L = this.C.line;
      r.wearHead.innerHTML = w.head ? clothMarkup(w.head, sp, L) : '';
      r.wearEyes.innerHTML = w.eyes ? clothMarkup(w.eyes, sp, L) : '';
      r.wearNeck.innerHTML = (w.body === 'tutu' ? clothMarkup('tutu', sp, L) : '') +
        (w.neck ? clothMarkup(w.neck, sp, L) : w.body === 'cape' ? '<circle cx="200" cy="236" r="9" fill="#FFD166" stroke="' + L + '" stroke-width="3"/>' : '');
      r.wearBody.innerHTML = ['sweater', 'hoodie', 'raincoat', 'overalls'].indexOf(w.body) >= 0 ? clothMarkup(w.body, sp, L) : '';
      r.wearBack.innerHTML = w.body === 'cape' ? clothMarkup('cape', sp, L) : '';
      const sl = SLEEVES[w.body];
      if (sl && r.sleeveF0) for (let i = 0; i < 2; i++) { r['sleeveF' + i].setAttribute('stroke', sl[0]); r['sleeveC' + i].setAttribute('stroke', sl[1]); }
    }

    // ================================================================ paneller (görevler, mağaza, dolap, veteriner)
    _openPanel(kind) {
      if (kind === 'mood' || kind === 'talk') { this.startTalk(kind === 'mood' ? 'mood' : 'checkin'); return; }
      this._closeMenu();
      const r = this.r; if (!r.panel) return;
      const SC = SCENE, pr = this.progress, L = this.C.line;
      this._checkQuests();
      const W = Math.min(this.Wv - 28, 620), hits = [];
      const tx = (x, y, s, size, weight, color, anchor) => '<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + (anchor || 'start') + '" font-family="' + FONT + '" font-size="' + size + '" font-weight="' + (weight || 700) + '" fill="' + (color || SC.text) + '">' + esc(s) + '</text>';
      const ttl = { quests: ['list', 'Günlük görevler'], shop: ['bag', 'Mağaza'], wardrobe: ['hanger', 'Dolap'], vet: ['vet', 'Veteriner'] }[kind];
      if (!ttl) return;
      let m = '', H = 70;
      const grid = (ids, cellFn) => {
        const cw = 108, ch = 128, gap = 10, cols = Math.max(2, Math.floor((W - 32 + gap) / (cw + gap)));
        const gx = (W - (cols * cw + (cols - 1) * gap)) / 2;
        ids.forEach((id, i) => {
          const x = gx + (i % cols) * (cw + gap), y = H + Math.floor(i / cols) * (ch + gap);
          m += '<g transform="translate(' + f(x) + ' ' + f(y) + ')">' + cellFn(id, cw, ch, x, y) + '</g>';
        });
        H += Math.ceil(ids.length / cols) * (ch + gap) + 6;
      };
      if (kind === 'quests') {
        m += tx(24, 64, 'Her gece 12\'de yeni görevler gelir', 13, 600, '#B08A82');
        H = 82;
        pr.quests.list.filter((q) => QUESTS[q.id]).forEach((q) => {
          const Q = QUESTS[q.id], done = q.have >= Q.n, y = H;
          m += '<rect x="16" y="' + y + '" width="' + (W - 32) + '" height="72" rx="18" fill="' + (q.claimed ? '#F0FBF6' : '#FFF8FA') + '" stroke="#F6DCE3" stroke-width="2"/>' +
            icon(Q.icon, 46, y + 36, 30) + tx(76, y + 30, Q.text, 15, 800);
          const bw = W - 32 - 76 - 130;
          m += '<rect x="76" y="' + (y + 42) + '" width="' + f(bw) + '" height="10" rx="5" fill="#F6DCE3"/>' +
            '<rect x="76" y="' + (y + 42) + '" width="' + f(bw * q.have / Q.n) + '" height="10" rx="5" fill="' + (done ? '#5CC9A7' : '#F4A259') + '"/>' +
            tx(76 + bw + 8, y + 52, q.have + '/' + Q.n, 12, 800, '#B08A82');
          const bx = W - 16 - 108;
          if (q.claimed) m += icon('check', bx + 24, y + 36, 22) + tx(bx + 40, y + 42, 'Alındı', 14, 800, '#3FAE8C');
          else if (done) {
            m += '<rect x="' + bx + '" y="' + (y + 16) + '" width="100" height="40" rx="20" fill="#F06C8B"/>' + icon('gift', bx + 22, y + 36, 20) + tx(bx + 36, y + 42, 'Ödülü al', 14, 800, '#fff');
            hits.push({ x: bx, y: y + 16, w: 100, h: 40, fn: () => this.claimQuest(q.id) });
          } else m += icon('coin', bx + 14, y + 36, 18) + tx(bx + 26, y + 42, String(QUEST_REWARD.coins), 13, 800, '#C9A79E') + icon('star', bx + 52, y + 36, 18) + tx(bx + 64, y + 42, String(QUEST_REWARD.xp), 13, 800, '#C9A79E');
          H += 82;
        });
        m += tx(24, H + 12, 'Hepsini bitirirsen ' + QUEST_BONUS + ' pati parası daha!', 12, 700, '#B08A82');
        H += 30;
      } else if (kind === 'shop' || kind === 'wardrobe') {
        m += icon('coin', W - 132, 36, 22) + tx(W - 116, 42, String(pr.coins), 17, 900, '#D68A00');
        const tab = this.panelTab || 'head';
        let tx0 = 16;
        const tw = (W - 32 - 3 * 8) / 4;
        CLOTH_SLOTS.forEach((sl) => {
          const on = sl === tab;
          m += '<rect x="' + f(tx0) + '" y="56" width="' + f(tw) + '" height="36" rx="18" fill="' + (on ? '#F06C8B' : '#fff') + '" stroke="' + (on ? '#F06C8B' : '#F6DCE3') + '" stroke-width="2"/>' +
            tx(tx0 + tw / 2, 79, CLOTH_TABS[sl], 14, 800, on ? '#fff' : SC.text, 'middle');
          const xx = tx0; hits.push({ x: xx, y: 56, w: tw, h: 36, fn: () => { this.panelTab = sl; this._openPanel(kind); } });
          tx0 += tw + 8;
        });
        H = 104;
        const all = Object.keys(CLOTHES).filter((id) => CLOTHES[id].slot === tab);
        const ids = kind === 'shop' ? all : all.filter((id) => pr.owned.indexOf(id) >= 0);
        if (kind === 'wardrobe' && !ids.length) {
          m += tx(W / 2, H + 34, 'Bu bölümde henüz kıyafetin yok.', 16, 800, SC.text, 'middle') + tx(W / 2, H + 58, 'Bakım yapıp pati parası biriktir, mağazadan al!', 13, 600, '#B08A82', 'middle');
          m += '<rect x="' + (W / 2 - 90) + '" y="' + (H + 76) + '" width="180" height="44" rx="22" fill="#F06C8B"/>' + icon('bag', W / 2 - 52, H + 98, 22) + tx(W / 2 - 34, H + 104, 'Mağazaya git', 15, 800, '#fff');
          const yy = H + 76; hits.push({ x: W / 2 - 90, y: yy, w: 180, h: 44, fn: () => this._openPanel('shop') });
          H += 136;
        } else {
          grid(ids, (id, cw, ch, x, y) => {
            const c = CLOTHES[id], owned = pr.owned.indexOf(id) >= 0, worn = pr.wear[c.slot] === id;
            let s = '<rect width="' + cw + '" height="' + ch + '" rx="18" fill="#fff" stroke="' + (worn ? '#F06C8B' : '#F6DCE3') + '" stroke-width="' + (worn ? 4 : 2) + '"/>' +
              '<g transform="translate(' + cw / 2 + ' 48)">' + clothPreview(id, this.species, L) + '</g>' + tx(cw / 2, 96, c.name, 11.5, 800, SC.text, 'middle');
            const lab = (ic, t, col) => icon(ic, cw / 2 - 26, 112, 16) + tx(cw / 2 - 14, 117, t, 12, 800, col);
            if (kind === 'wardrobe') s += worn ? lab('check', 'Giyili', '#F06C8B') : tx(cw / 2, 117, 'Giy', 12, 800, '#B08A82', 'middle');
            else if (owned) s += lab('check', worn ? 'Giyili' : 'Sende', '#3FAE8C');
            else if (pr.level < c.level) s += lab('lock', 'Seviye ' + c.level, '#B9A6A0');
            else s += lab('coin', String(c.price), pr.coins >= c.price ? '#D68A00' : '#E05A5A');
            hits.push({ x, y, w: cw, h: ch, fn: (w) => this._clothTap(kind, id, w) });
            return s;
          });
          if (kind === 'wardrobe' && CLOTH_SLOTS.some((k) => pr.wear[k])) {
            m += '<rect x="' + (W / 2 - 80) + '" y="' + H + '" width="160" height="40" rx="20" fill="#F6DCE3"/>' + tx(W / 2, H + 26, 'Hepsini çıkar', 14, 800, SC.text, 'middle');
            const yy = H; hits.push({ x: W / 2 - 80, y: yy, w: 160, h: 40, fn: () => { this.unwear(); this._openPanel('wardrobe'); } });
            H += 52;
          }
        }
      } else if (kind === 'vet') {
        const hp = Math.round(this.stats.health), sick = hp < 40;
        m += tx(24, 74, 'Sağlık', 14, 800) + '<rect x="84" y="62" width="' + (W - 170) + '" height="14" rx="7" fill="#F6DCE3"/>' +
          '<rect x="84" y="62" width="' + f((W - 170) * hp / 100) + '" height="14" rx="7" fill="' + (sick ? '#E05A5A' : hp < 70 ? '#F4A259' : '#5CC9A7') + '"/>' + tx(W - 24, 75, '%' + hp, 14, 900, SC.text, 'end');
        m += icon(sick ? 'face-sick' : hp < 70 ? 'face-tired' : 'face-happy', 36, 99, 22) +
          tx(54, 104, sick ? 'Hasta! Şurup ver, sonra bol bol dinlensin.' : hp < 70 ? 'Biraz halsiz. Vitamin iyi gelir.' : 'Sağlıklı ve mutlu!', 14, 700, sick ? '#E05A5A' : '#3FAE8C');
        m += tx(24, 128, 'İlacı seç ve ağzına sürükle', 12, 600, '#B08A82');
        H = 142;
        const ids = Object.keys(MEDS), gap = 10, cw = (W - 32 - gap * 2) / 3, ch = 120;
        ids.forEach((id, i) => {
          const x = 16 + i * (cw + gap), y = H;
          m += '<rect x="' + f(x) + '" y="' + y + '" width="' + f(cw) + '" height="' + ch + '" rx="18" fill="#fff" stroke="#F6DCE3" stroke-width="2"/>' +
            '<g transform="translate(' + f(x + cw / 2) + ' ' + (y + 46) + ') scale(0.95)">' + careIcon(id, L) + '</g>' +
            tx(x + cw / 2, y + 92, MEDS[id].name, 14, 800, SC.text, 'middle') + tx(x + cw / 2, y + 110, MEDS[id].desc, 11, 600, '#B08A82', 'middle');
          hits.push({ x, y, w: cw, h: ch, fn: (w, pid) => { const from = this.panel ? { x: this.panel.x0 + x + cw / 2, y: this.panel.y0 + y + 46 } : null; this._closePanel(); this._startDrag('food', w.x, w.y, pid, { food: id, from }); } });
        });
        H += ch + 16;
      }
      const x0 = (this.Wv - W) / 2, y0 = Math.max(14, (this.Hv - this.trayH - H) / 2);
      const card = '<rect x="0" y="0" width="' + this.Wv + '" height="' + this.Hv + '" fill="#2B2140" opacity="0.28"/>' +
        '<g transform="translate(' + f(x0) + ' ' + f(y0) + ')"><rect width="' + W + '" height="' + H + '" rx="26" fill="#FFF8FA" stroke="' + SC.trayEdge + '" stroke-width="3"/>' +
        icon(ttl[0], 38, 35, 28) + tx(58, 42, ttl[1], 20, 900) +
        '<circle cx="' + (W - 30) + '" cy="32" r="18" fill="#F6DCE3"/><path d="M' + (W - 37) + ' 25 l14 14 M' + (W - 23) + ' 25 l-14 14" stroke="' + SC.text + '" stroke-width="3.5" stroke-linecap="round"/>' +
        m + '</g>';
      hits.push({ x: W - 50, y: 12, w: 40, h: 40, fn: () => this._closePanel() });
      r.panel.innerHTML = card;
      this.panel = { kind, x0, y0, W, H, hits: hits.map((h) => ({ x: h.x + x0, y: h.y + y0, w: h.w, h: h.h, fn: h.fn })) };
      this._emit('panel', { name: kind, phase: 'open' });
    }
    _closePanel() {
      if (!this.panel) return;
      const k = this.panel.kind;
      this.panel = null; if (this.r.panel) this.r.panel.innerHTML = '';
      this._emit('panel', { name: k, phase: 'close' });
    }
    openPanel(kind) { if (['quests', 'shop', 'wardrobe', 'vet', 'mood', 'talk'].indexOf(kind) >= 0) this._openPanel(kind); }
    _panelDown(w, pid) {
      const P = this.panel;
      const h = P.hits.find((b) => w.x > b.x && w.x < b.x + b.w && w.y > b.y && w.y < b.y + b.h);
      if (h) { h.fn(w, pid); return; }
      if (w.x < P.x0 || w.x > P.x0 + P.W || w.y < P.y0 || w.y > P.y0 + P.H) this._closePanel();
    }
    _clothTap(kind, id, w) {
      const pr = this.progress, c = CLOTHES[id];
      const toast = (ic, t, col) => this._iconToast(w.x, w.y - 20, [[ic, t]], { color: col || '#E05A5A', size: 15, vy: -30, life: 1.5 });
      if (kind === 'wardrobe' || pr.owned.indexOf(id) >= 0) {
        if (pr.wear[c.slot] === id) this.unwear(c.slot); else this.wear(id);
      } else {
        const res = this.buy(id);
        if (!res.ok) { if (res.reason === 'level') toast('lock', 'Seviye ' + c.level + ' gerekli'); else toast('coin', (c.price - pr.coins) + ' pati parası eksik'); return; }
        toast('heart', 'Aldın! Hemen giydi', '#3FAE8C');
      }
      this._openPanel(kind);
    }

    // ================================================================ tarak ve diş fırçası (banyoda)
    _updateGroom(d, dt, T, awake) {
      const mv = Math.hypot(d.x - d.lastMove[0], d.y - d.lastMove[1]); d.lastMove = [d.x, d.y];
      if (d.type === 'brush') {
        const tx = d.x, ty = d.y + 30, l = this._toLocal(tx, ty);
        const over = this._hit(l.x, l.y);
        if (!awake) return;
        if (!over) { this._lookAtWorld(T, d.x, d.y); return; }
        T.eyeOpen = 0; T.closedCurve = 1; T.smile = 1; T.blush = 0.7; T.tilt = clamp((l.x - 200) / 8, -12, 12);
        T.earLift = -0.3; T.wagFreq = 3; T.wagAmp = 20; T.brow = -0.1;
        if (this.species === 'cat') T.whisker = 1; else { T.mouthOpen = 0.35; T.tongue = 0.6; }
        if (mv > 2) {
          this.groom = Math.min(1, this.groom + mv * 0.0011);
          this.sfx.play('brush');
          if (Math.random() < dt * 9) this._spawn('tuft', tx + rand(-16, 16), ty, { vx: rand(-70, 70), vy: rand(-90, -30), g: 140, life: 1.3, rot: rand(0, 360), vr: rand(-200, 200) });
          if (Math.random() < dt * 5) this._spawn('sparkle', tx + rand(-34, 34), ty + rand(-24, 24), { vy: -30, life: 0.7, s: 0.7 });
          if (this.groom >= 1) { this.groom = 0; this._groomDone(); }
        }
        return;
      }
      // diş fırçası: başı ağzına yaklaşınca ağzını kocaman açar, dişleri görünür
      const m = this._mouthWorld(), hx = d.x - 12, hy = d.y - 17, dist = Math.hypot(hx - m.x, hy - m.y);
      if (!awake) return;
      if (dist > 70 * this.s + 20) { this._lookAtWorld(T, hx, hy); if (dist < 220) T.mouthOpen = Math.max(T.mouthOpen, 0.25); return; }
      T.mouthOpen = 0.8; T.teeth = 1; T.squint = 0.7; T.eyeOpen = 0.55; T.smile = 0.9; T.brow = 0.35; T.tongue = 0; T.lookX = 0; T.lookY = 0.7; T.earLift = 0.1;
      if (mv > 2) {
        this.teethT = Math.min(1, this.teethT + mv * 0.0015);
        this.sfx.play('scrub');
        if (Math.random() < dt * 10) this._spawn('bubble', m.x + rand(-22, 22), m.y + rand(4, 22), { vx: rand(-40, 40), vy: rand(-60, -20), life: 0.7, s: rand(0.3, 0.55) });
        if (this.teethT >= 1) { this.teethT = 0; this._teethDone(); }
      }
    }
    _groomDone() {
      const s = this.stats;
      s.happiness = Math.min(100, s.happiness + 6); s.cleanliness = Math.min(100, s.cleanliness + 4); s.health = Math.min(100, s.health + 2);
      this.shine = 20;
      for (let i = 0; i < 8; i++) this._spawnL('sparkle', rand(120, 280), rand(70, 400), { vy: -40, vr: 120, life: 1, s: rand(0.8, 1.3) });
      this.sfx.play('chime');
      // tarama günde bir kez ödül verir; sürekli tarayarak para kazanılmaz
      if (this._earn('brush', this._rewardAt())) { this._quest('brush'); this.say('Tüylerim pırıl pırıl!', 2.6, { icon: 'sparkle' }); }
      else this.say('Bugün yeterince tarandım, teşekkürler!', 2.8, { icon: 'heart' });
      this._emit('groom', { kind: 'brush' });
    }
    _teethDone() {
      const s = this.stats, d = this.progress.daily, now = Date.now();
      s.health = Math.min(100, s.health + 3); s.happiness = Math.min(100, s.happiness + 4);
      if (this.drag && this.drag.type === 'tooth') this._releaseDrag();
      this._startAction(ACTIONS.grin(this));
      // sabah / akşam: iki fırçalama arasında en az 3 saat olmalı
      const gapOk = !d.lastTeeth || now - d.lastTeeth > 3 * 3600 * 1000;
      if (gapOk && this._earn('teeth', this._rewardAt())) { d.lastTeeth = now; this._quest('teeth'); this._quest('teeth2'); this.say('Dişlerim pırıl pırıl!', 2.6, { icon: 'tooth' }); }
      else this.say(gapOk ? 'Dişlerim pırıl pırıl!' : 'Dişlerimi az önce fırçaladık!', 2.6, { icon: 'tooth' });
      this._emit('groom', { kind: 'teeth' });
    }

    // ================================================================ hastalık / veteriner
    isSick() { return this.stats.health < 40; }
    _medTake(id) {
      this._clearActions();
      this._startAction(ACTIONS.med(this, id));
    }

    // ================================================================ saklambaç
    _hideSpots() {
      const fy = this.groundY - 74, sb = fy + 46, back = sb - 196, W = Math.min(this.Wv * 0.9, 640), x0 = this.Wv / 2 - W / 2;
      const bs = Math.min(1.1, this.s * 0.9);
      return [
        { id: 'sofa', x: x0 + 118, top: back, hx: x0 + 118, hy: back + 10 },
        { id: 'box', x: this.Wv * 0.83, y: this.groundY - 10, bs, top: this.groundY - 10 - 50 * bs, hx: this.Wv * 0.83, hy: this.groundY - 30 },
        { id: 'basket', x: this.Wv * 0.17, y: this.groundY - 10, bs, top: this.groundY - 10 - 48 * bs, hx: this.Wv * 0.17, hy: this.groundY - 30 }
      ];
    }
    _startHide(g) {
      const L = this.C.line, b = BREEDS[this.breed];
      g.dur = 999; g.phase = 'count'; g.ct = 3.2; g.tries = 0;
      g.spots = this._hideSpots();
      g.spot = g.spots[Math.floor(Math.random() * g.spots.length)];
      const u = this.uid, sp = g.spots, box = sp[1], bas = sp[2], sc = 0.85 * this.s;
      g.el = document.createElementNS(SVGNS, 'g');
      g.el.innerHTML =
        '<clipPath id="' + u + '-pk"><rect x="-3000" y="-3000" width="6000" height="' + f(3000 + sp[0].top + 2) + '"/></clipPath>' +
        '<g data-h="props" display="none">' +
          '<g clip-path="url(#' + u + '-pk)"><g data-h="peek-sofa" display="none">' + peekMarkup(b, this.C) + '</g></g>' +
          '<g data-h="prop-box" transform="translate(' + f(box.x) + ' ' + f(box.y) + ') scale(' + f(box.bs) + ')">' + boxMarkup(L, true) +
            '<g data-h="peek-box" display="none">' + peekMarkup(b, this.C) + '</g>' + boxMarkup(L, false) + '</g>' +
          '<g data-h="prop-basket" transform="translate(' + f(bas.x) + ' ' + f(bas.y) + ') scale(' + f(bas.bs) + ')">' +
            '<g data-h="peek-basket" display="none">' + peekMarkup(b, this.C) + '</g>' + basketMarkup(L) + '</g>' +
        '</g>' +
        '<g data-h="cover"><rect x="0" y="0" width="' + f(this.Wv) + '" height="' + f(this.Hv) + '" fill="#2B2140" opacity="0.93"/>' +
          '<g transform="translate(' + f(this.Wv / 2) + ' ' + f(this.Hv * 0.36 - 40) + ') scale(1.6)">' + coverEyesMarkup(b, this.C) + '</g>' +
          '<text data-h="num" x="' + f(this.Wv / 2) + '" y="' + f(this.Hv * 0.36 + 110) + '" text-anchor="middle" font-family="' + FONT + '" font-size="84" font-weight="900" fill="#FFD166">3</text>' +
          '<text x="' + f(this.Wv / 2) + '" y="' + f(this.Hv * 0.36 + 170) + '" text-anchor="middle" font-family="' + FONT + '" font-size="24" font-weight="800" fill="#fff">Gözlerini kapat, saklanıyorum…</text></g>';
      this.r.gameLayer.appendChild(g.el);
      const q = (k) => g.el.querySelector('[data-h="' + k + '"]');
      g.q = { props: q('props'), cover: q('cover'), num: q('num'), peek: q('peek-' + g.spot.id), box: q('prop-box'), basket: q('prop-basket') };
      g.peekSc = sc;
    }
    _updateHide(dt, T, g) {
      const Q = g.q;
      if (g.phase === 'count') {
        g.ct -= dt;
        Q.num.textContent = Math.max(1, Math.ceil(g.ct - 0.2));
        if (g.ct <= 0) {
          g.phase = 'seek'; g.st = 0;
          this.hidden = true; this._clearActions();
          Q.cover.remove(); Q.props.setAttribute('display', 'inline'); Q.peek.setAttribute('display', 'inline');
          this._setBanner('Nerede saklandı? Dokun!', 'search', true);
        }
        return;
      }
      if (g.phase === 'found') { g.ft -= dt; if (g.ft <= 0) this.stopGame(); return; }
      g.st += dt;
      if (g.st > 30) { this._hideReveal(false); return; }
      // ara ara başını uzatıp bakar (kulak uçları hep biraz görünür)
      const cyc = g.st % 3.4, amt = 0.15 + 0.85 * bump(clamp((cyc - 1.8) / 1.4, 0, 1), 0, 1, 0.3);
      const sc = g.peekSc, s = g.spot, wig = Math.sin(this.t * 14) * 3 * (amt > 0.5 ? 1 : 0);
      if (s.id === 'sofa') Q.peek.setAttribute('transform', 'translate(' + f(s.x + wig) + ' ' + f(s.top + lerp(50, -16, amt) * sc) + ') scale(' + f(sc) + ')');
      else Q.peek.setAttribute('transform', 'translate(' + f(wig / s.bs) + ' ' + f(-50 + lerp(50, -16, amt) * sc / s.bs) + ') scale(' + f(sc / s.bs) + ')');
      if (s.id !== 'sofa' && amt > 0.6) Q[s.id].setAttribute('transform', 'translate(' + f(s.x) + ' ' + f(s.y) + ') rotate(' + f(Math.sin(this.t * 18) * 1.5) + ') scale(' + f(s.bs) + ')');
    }
    _hideTap(w) {
      const g = this.game;
      if (g.phase !== 'seek') return true;
      let best = null, bd = 1e9;
      g.spots.forEach((s) => { const d = Math.hypot(w.x - s.hx, w.y - s.hy); if (d < bd) { bd = d; best = s; } });
      if (!best || bd > 110) return true;
      if (best === g.spot) { this._hideReveal(true); return true; }
      g.tries++;
      for (let i = 0; i < 5; i++) this._spawn('dust', best.hx + rand(-30, 30), best.hy + rand(-10, 20), { vx: rand(-40, 40), vy: rand(-40, -10), life: 0.7 });
      this._spawn('text', best.hx, best.hy - 40, { text: 'Burada yok!', vy: -30, life: 1.2, size: 18, color: '#8E5E55' });
      if (best.id !== 'sofa') { const el = g.q[best.id]; let k = 0; const iv = setInterval(() => { el.setAttribute('transform', 'translate(' + f(best.x + (k % 2 ? 4 : -4)) + ' ' + f(best.y) + ') scale(' + f(best.bs) + ')'); if (++k > 5) { clearInterval(iv); el.setAttribute('transform', 'translate(' + f(best.x) + ' ' + f(best.y) + ') scale(' + f(best.bs) + ')'); } }, 50); }
      return true;
    }
    _hideReveal(found) {
      const g = this.game; if (!g) return;
      g.phase = 'found'; g.ft = 2.8;
      g.q.peek.setAttribute('display', 'none');
      this.hidden = false;
      const s = g.spot;
      for (let i = 0; i < 8; i++) this._spawn('sparkle', s.hx + rand(-50, 50), s.hy + rand(-40, 20), { vy: -50, vr: 160, life: 0.9, s: rand(0.8, 1.2) });
      this._startAction(ACTIONS.celebrate(this));
      if (found) {
        this.say(g.tries ? 'Buldun!' : 'Hemen buldun! Çok iyisin', 2.6, { icon: 'party' });
        this.sfx.play('chime');
        this._quest('hide'); this._earn('hide', this._rewardAt());
        this._emit('play', { kind: 'hide', found: true });
      } else { this.say('Buradaydım!', 2.4, { icon: 'paw' }); this._emit('play', { kind: 'hide', found: false }); }
      this._setBanner(found ? 'Buldun!' : 'Bulamadın, olsun!', found ? 'party' : 'paw', false);
    }
    _setBanner(label, iconName, closable) {
      const r = this.r;
      if (closable === undefined) closable = true;
      r.bannerTxt.textContent = label;
      let tw = label.length * 8.6;
      try { tw = r.bannerTxt.getComputedTextLength() || tw; } catch (e) { /* yoksay */ }
      const iw = iconName ? 28 : 0, cw = closable ? 30 : 0, W = tw + 36 + iw + cw;
      r.bannerIcon.innerHTML = iconName ? icon(iconName, -W / 2 + 28, 0, 22) : '';
      r.bannerTxt.setAttribute('x', f(-W / 2 + 18 + iw));
      r.bannerX.innerHTML = closable ? icon('close', W / 2 - 24, 0, 22) : '';
      this._bannerW = W;
      r.bannerBg.setAttribute('x', f(-W / 2)); r.bannerBg.setAttribute('width', f(W));
      r.banner.setAttribute('display', 'inline');
    }

    // ================================================================ saat: pencerede sabah / öğle / akşam / gece
    setHour(h) { this.hourOverride = h == null ? null : clamp(+h, 0, 24); this._clockT = 0; }
    _clock() {
      const d = new Date();
      const h = this.hourOverride != null ? this.hourOverride : this.useClock ? d.getHours() + d.getMinutes() / 60 : 12;
      const cn = h < 5 || h >= 20.5 ? 1 : h < 7 ? 1 - smooth01((h - 5) / 2) : h >= 18.5 ? smooth01((h - 18.5) / 2) : 0;
      let sky = '#CFEAFB';
      if (h >= 4.5 && h < 8.5) sky = mix('#FFC9A8', '#CFEAFB', smooth01((h - 6.5) / 2));
      else if (h >= 16.5 && h < 21) sky = mix('#CFEAFB', '#F6A38E', smooth01((h - 16.5) / 2.2));
      const st = clamp((h - 6) / 13, 0, 1);
      return { h, cn, sky, sunX: lerp(-40, 40, st), sunY: -8 - Math.sin(st * Math.PI) * 26, night: cn > 0.5 };
    }

    // ================================================================ regl döngüsü, su hatırlatma, kullanıcının ruh hali
    // c: { phase: 'period'|'pms'|'follicular'|'ovulation'|'luteal', day: 2, daysUntilNext: 1 }
    setCycle(c) {
      const prev = this.cycle ? this.cycle.phase : null;
      this.cycle = c && (CYCLE[c.phase] || c.daysUntilNext != null) ? { phase: CYCLE[c.phase] ? c.phase : null, day: c.day | 0 || null,
        daysUntilNext: c.daysUntilNext == null || isNaN(+c.daysUntilNext) ? null : +c.daysUntilNext } : null;
      this._renderHud();
      this._emit('cycle', this.cycle);
      if (this.cycle && this.cycle.phase && this.cycle.phase !== prev && !this._silentState) { this._cycleNext = 0; this._cycleFirst = true; }
    }
    _cycleAct() {
      const c = this.cycle; if (!c || !CYCLE[c.phase]) return;
      const ph = c.phase, tips = CYCLE[ph].tips, tip = () => tips[Math.floor(Math.random() * tips.length)];
      const first = this._cycleFirst; this._cycleFirst = false;
      if (this.sleeping || this.hidden || this.scene !== 'room' || this.talk) return;
      this._clearActions();
      const roll = Math.random();
      if (ph === 'period') {
        if (first || roll < 0.35) { this._enqueue(ACTIONS.hug(this)); this._sayLine(first ? ['Kendine iyi bak, ben yanındayım', 'heart'] : tip(), 3.4); if (first) this._enqueue(ACTIONS.offer(this, 'bottle')); }
        else if (roll < 0.7) { this._enqueue(ACTIONS.offer(this, 'bottle')); this.say('Sıcak su torbası getirdim, karnına iyi gelir', 3.4, { icon: 'bottle' }); }
        else { this._enqueue(ACTIONS.headTilt(this)); this._sayLine(tip(), 3.4); }
      } else if (ph === 'pms') {
        if (first || roll < 0.4) { this._enqueue(ACTIONS.offer(this, 'choco')); this.say('Biraz çikolata ister misin?', 3.4, { icon: 'choco' }); }
        else if (roll < 0.7) { this._enqueue(ACTIONS.hug(this)); this._sayLine(tip(), 3.4); }
        else { this._enqueue(ACTIONS.headTilt(this)); this._sayLine(tip(), 3.4); }
      } else if (ph === 'follicular' || ph === 'ovulation') {
        this._enqueue(ACTIONS.dance(this)); this._sayLine(tip(), 3.4);
      } else { this._enqueue(roll < 0.5 ? ACTIONS.hug(this) : ACTIONS.headTilt(this)); this._sayLine(tip(), 3.4); }
      this._sayCool = 12;
    }
    setWaterReminder(min) { this.waterEvery = Math.max(0, +min || 0) * 60; this._waterT = 0; }
    remindWater() {
      if (this.scene !== 'room') this.goRoom();
      if (this.hidden) this.stopGame();
      if (this.sleeping || this.lightsOff) this.setLights(true);
      this._waterT = 0;
      this._enqueue(ACTIONS.offer(this, 'glass'));
      this.say('Sen de bir bardak su iç', 40, { icon: 'glass', button: 'İçtim', onTap: () => this.userDrankWater() });
      this._emit('waterReminder', {});
    }
    userDrankWater() {
      if (this.speech && this.speech.button) this.speech = null, this.r.speech.setAttribute('display', 'none');
      this._quest('userWater'); this._quest('userWater4');
      this._earn('userWater', this._rewardAt());
      if (!this.sleeping && !this.hidden) { this._clearActions(); this._startAction(ACTIONS.celebrate(this)); }
      this.say('Aferin! Sağlığına', 2.6, { icon: 'drop' });
      this._emit('userWater', { time: Date.now() });
    }
    setUserMood(mood, opt) {
      if (!USER_MOODS[mood]) return false;
      const fresh = !this.userMood || this.userMood.date !== this._today();
      this.userMood = { mood, date: this._today() };
      this._emit('userMood', { mood, date: this.userMood.date });
      this._quest('mood');
      if (fresh) this._earn('mood', this._rewardAt());
      this._renderHud();
      if (!(opt && opt.silent)) this._moodReact(mood);
      return true;
    }
    _moodReact(mood) {
      if (this.hidden) this.stopGame();
      if (this.scene !== 'room') this.goRoom();
      if (this.lightsOff) this.setLights(true);
      this._clearActions();
      if (this.sleeping) this._enqueue(ACTIONS.wake(this));
      const A = ACTIONS, q = (a) => this._enqueue(a);
      const say = (t, ic) => setTimeout(() => this.say(t, 3.6, { icon: ic }), this.sleeping ? 2800 : 0);
      switch (mood) {
        case 'happy': q(A.dance(this)); q(A.hop(this)); say('Ne güzel! Mutluluğun bana da geçti', 'note'); break;
        case 'sad': q(A.hug(this)); q(A.hug(this)); say('Yanındayım, sarılalım mı?', 'heart'); break;
        case 'tired': q(A.yawn(this)); q(A.stretch(this)); say('Biraz dinlen, ben buradayım', 'moon'); break;
        case 'pain': q(A.offer(this, 'bottle')); q(A.hug(this)); say('Sıcak su torbası iyi gelir, geçmiş olsun', 'bottle'); break;
        case 'angry': q(A.breathe(this)); say('Birlikte derin nefes alalım', 'wind'); break;
        case 'anxious': q(A.hug(this)); q(A.breathe(this)); say('Her şey yoluna girecek', 'rainbow'); break;
      }
    }

    // ================================================================ konuşma: regl yaklaşıyor, şikayet / ağrı / ilaç sorma
    // Uygulama, takvimdeki hazır listeleri ve bugünün kayıtlarını verir; hayvanın aldığı cevaplar 'log' olayıyla geri gönderilir.
    // o: { symptoms: [...], medications: [...], today: { date: 'YYYY-MM-DD', symptoms: [...], pain: 7|null, medications: [...] } }
    setLogOptions(o) {
      o = o || {};
      const L = this._logOpts();
      if (Array.isArray(o.symptoms)) L.symptoms = o.symptoms.filter(Boolean).map(String);
      if (Array.isArray(o.medications)) L.medications = o.medications.filter(Boolean).map(String);
      if (o.today) L.today = { date: o.today.date || this._todayISO(), symptoms: (o.today.symptoms || []).map(String), pain: o.today.pain == null ? null : +o.today.pain, medications: (o.today.medications || []).map(String) };
      this.connected = true;
      if (this.talk) this._renderTalk();
    }
    _logOpts() {
      if (!this.logOpts) this.logOpts = { symptoms: DEFAULT_SYMPTOMS.slice(), medications: [], today: null };
      const L = this.logOpts, iso = this._todayISO();
      if (!L.today || L.today.date !== iso) L.today = { date: iso, symptoms: [], pain: null, medications: [] };
      return L;
    }
    _log(kind, value, extra) {
      const T = this._logOpts().today;
      if (kind === 'symptom' && T.symptoms.indexOf(value) < 0) T.symptoms.push(value);
      if (kind === 'pain') T.pain = value;
      if (kind === 'medication' && T.medications.indexOf(value) < 0) T.medications.push(value);
      this._emit('log', Object.assign({ kind, date: T.date, value }, extra || {}));
    }
    // kind: 'checkin' (ruh hali → şikayet → ağrı → ilaç), 'meds', 'forecast', 'mood'
    startTalk(kind) {
      if (!this.showTools || this.talk) return false;
      if (this.scene !== 'room') this.goRoom();
      if (this.game) this.stopGame();
      this._closePanel(); this._closeMenu();
      if (this.drag) { this.drag = null; this.auto = null; this._hideHeld(); }
      if (this.sleeping || this.lightsOff) this.setLights(true);
      this._checkQuests();
      const T = this._logOpts().today, ph = this.cycle && this.cycle.phase, d = this.progress.daily;
      let steps;
      if (kind === 'forecast') steps = ['forecast'];
      else if (kind === 'mood') steps = ['mood'];
      else if (kind === 'meds') steps = ['medTaken'];
      else {
        kind = 'checkin';
        steps = [];
        if (!this.userMood || this.userMood.date !== this._today()) steps.push('mood');
        steps.push('symptoms', 'pain?');
        if (ph === 'period' && !T.medications.length) steps.push('medTaken');
      }
      d.asked[kind] = true;
      this.speech = null; if (this.r.speech) this.r.speech.setAttribute('display', 'none');
      this.talk = { kind, steps, i: 0, sel: [], extra: { symptoms: [], meds: [] }, data: { mood: null, symptoms: [], pain: null, medTaken: null, meds: [] } };
      this._clearActions();
      if (kind === 'forecast') this._startAction(ACTIONS.offer(this, 'pouch'));
      this._talkStep();
      this._emit('talk', { kind, phase: 'start' });
      return true;
    }
    _talkStep() {
      const t = this.talk; if (!t) return;
      if (t.i >= t.steps.length) { this._talkFinish(); return; }
      let st = t.steps[t.i];
      if (st === 'pain?') { // ağrı: regl / PMS günlerinde ya da bir şikayet seçildiyse sorulur
        const T = this._logOpts().today, ph = this.cycle && this.cycle.phase;
        if (T.pain != null || (!t.data.symptoms.length && ph !== 'period' && ph !== 'pms')) { t.i++; this._talkStep(); return; }
        st = t.steps[t.i] = 'pain';
      }
      t.sel = st === 'symptoms' ? this._logOpts().today.symptoms.slice() : [];
      if (!this.action) this._startAction(ACTIONS.headTilt(this));
      this._renderTalk();
    }
    _talkQuestion(st) {
      const c = this.cycle, du = c && c.daysUntilNext;
      switch (st) {
        case 'forecast': return du === 0 ? 'Reglin bugün başlayabilir. Yanında ped var mı?' : du === 1 ? 'Reglin yarın başlayabilir. Çantana ped koydun mu?' : 'Reglin ' + du + ' gün sonra başlayabilir. Çantanı hazırlayalım mı?';
        case 'mood': return 'Bugün nasılsın?';
        case 'symptoms': return 'Bugün bir şikayetin var mı? Seçersen takvimine kaydederim.';
        case 'pain': return 'Ağrın 10 üzerinden ne kadar?';
        case 'medTaken': return 'Bugün ağrı kesici ya da başka bir ilaç içtin mi?';
        case 'medWhich': return 'Hangi ilacı içtin? Takvimine ekleyeyim.';
      }
      return '';
    }
    _talkOptions(st) {
      const t = this.talk, L = this._logOpts();
      switch (st) {
        case 'forecast': return { single: true, opts: [{ id: 'yes', label: 'Koydum', icon: 'check' }, { id: 'later', label: 'Şimdi koyacağım', icon: 'pouch' }] };
        case 'mood': return { single: true, opts: Object.keys(USER_MOODS).map((id) => ({ id, label: USER_MOODS[id].name, icon: 'face-' + id })) };
        case 'symptoms': {
          const list = L.symptoms.concat(t.extra.symptoms.filter((x) => L.symptoms.indexOf(x) < 0));
          L.today.symptoms.forEach((x) => { if (list.indexOf(x) < 0) list.push(x); });
          return { opts: list.map((x) => ({ id: x, label: x, locked: L.today.symptoms.indexOf(x) >= 0 })).concat([{ id: '+', label: 'Kendim yazayım', icon: 'plus', input: 'symptom' }]),
            buttons: [{ id: 'none', label: 'Şikayetim yok' }, { id: 'save', label: 'Kaydet', primary: true }] };
        }
        case 'pain': return { pain: true, opts: [{ id: 'none', label: 'Ağrım yok', icon: 'face-happy' }] };
        case 'medTaken': return { single: true, opts: [{ id: 'yes', label: 'Evet, içtim', icon: 'pill' }, { id: 'no', label: 'Hayır, içmedim' }, { id: 'later', label: 'Henüz değil', icon: 'moon' }] };
        case 'medWhich': {
          const list = L.medications.concat(t.extra.meds.filter((x) => L.medications.indexOf(x) < 0));
          return { opts: list.map((x) => ({ id: x, label: x, icon: 'pill' })).concat([{ id: '+', label: 'Başka bir ilaç', icon: 'plus', input: 'med' }]),
            buttons: [{ id: 'skip', label: 'Vazgeç' }, { id: 'save', label: 'Kaydet', primary: true }] };
        }
      }
      return { opts: [] };
    }
    _renderTalk() {
      const t = this.talk, r = this.r; if (!t || !r.talk) return;
      const SC = SCENE, st = t.steps[t.i], O = this._talkOptions(st), q = this._talkQuestion(st);
      const W = Math.min(this.Wv - 24, 640), x0 = (this.Wv - W) / 2, hits = [];
      const tx = (x, y, s, size, weight, color, anchor) => '<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + (anchor || 'start') + '" font-family="' + FONT + '" font-size="' + size + '" font-weight="' + (weight || 700) + '" fill="' + (color || SC.text) + '">' + esc(s) + '</text>';
      // soru (satırlara bölünür)
      const maxCh = Math.floor((W - 96) / 10), lines = [];
      let cur = '';
      q.split(' ').forEach((wd) => { if ((cur + ' ' + wd).trim().length > maxCh && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); });
      if (cur) lines.push(cur);
      let m = '', y = 22;
      lines.forEach((l, i) => { m += tx(24, y + 18 + i * 25, l, 18, 800); });
      y += lines.length * 25 + 16;
      // seçenekler
      if (O.pain) {
        const gap = 6, d = Math.min(44, (W - 40 - gap * 9) / 10);
        for (let n = 1; n <= 10; n++) {
          const cx = 20 + d / 2 + (n - 1) * (d + gap), col = mix('#7FD3A8', '#E05A5A', (n - 1) / 9);
          m += '<circle cx="' + f(cx) + '" cy="' + f(y + d / 2) + '" r="' + f(d / 2) + '" fill="' + col + '" stroke="#fff" stroke-width="2.5"/>' + tx(cx, y + d / 2 + 6, String(n), 16, 900, '#fff', 'middle');
          hits.push({ x: cx - d / 2, y, w: d, h: d, fn: () => this._talkAnswer(n) });
        }
        m += tx(20, y + d + 16, 'hafif', 11, 700, '#9AC9B0') + tx(W - 20, y + d + 16, 'çok şiddetli', 11, 700, '#E05A5A', 'end');
        y += d + 30;
      }
      const chipH = 42, gapX = 8, gapY = 8;
      let cx = 20, rowY = y;
      O.opts.forEach((o) => {
        const isSel = t.sel.indexOf(o.id) >= 0 || o.locked;
        const iw = o.icon ? 28 : (O.single ? 0 : 24);
        const w = Math.min(W - 40, o.label.length * 8.6 + 30 + iw);
        if (cx + w > W - 20) { cx = 20; rowY += chipH + gapY; }
        const fill = isSel ? '#F06C8B' : '#fff', tc = isSel ? '#fff' : SC.text;
        m += '<rect x="' + f(cx) + '" y="' + f(rowY) + '" width="' + f(w) + '" height="' + chipH + '" rx="21" fill="' + fill + '" stroke="' + (isSel ? '#F06C8B' : '#F3CFD9') + '" stroke-width="2"/>';
        let lx = cx + 15;
        if (o.icon) { m += icon(o.icon === 'close2' ? 'face-sad' : o.icon, lx + 10, rowY + chipH / 2, 22); lx += 28; }
        else if (!O.single) { m += isSel ? icon('check', lx + 8, rowY + chipH / 2, 18) : '<circle cx="' + f(lx + 8) + '" cy="' + f(rowY + chipH / 2) + '" r="8" fill="none" stroke="#E7C3CD" stroke-width="2"/>'; lx += 24; }
        m += tx(lx, rowY + chipH / 2 + 5.5, o.label, 15, 700, tc);
        const hx = cx, hy = rowY;
        hits.push({ x: hx, y: hy, w, h: chipH, fn: () => this._talkChip(o, O) });
        cx += w + gapX;
      });
      y = rowY + chipH + 14;
      // butonlar
      if (O.buttons) {
        const bw = (W - 40 - 10) / 2;
        O.buttons.forEach((b, i) => {
          const bx = 20 + i * (bw + 10), en = !b.primary || t.sel.some((s) => !this._isLogged(st, s));
          m += '<rect x="' + f(bx) + '" y="' + f(y) + '" width="' + f(bw) + '" height="46" rx="23" fill="' + (b.primary ? (en ? '#F06C8B' : '#F6C3D0') : '#F6DCE3') + '"/>' +
            tx(bx + bw / 2, y + 29, b.label, 16, 800, b.primary ? '#fff' : SC.text, 'middle');
          if (en) hits.push({ x: bx, y, w: bw, h: 46, fn: () => this._talkAnswer(b.id) });
        });
        y += 58;
      }
      m += tx(24, y + 4, t.steps.length > 1 ? (t.i + 1) + ' / ' + t.steps.length : '', 11, 700, '#C9A79E');
      const H = y + 14, y0 = Math.max(150, this.Hv - this.trayH - 12 - H);
      const tailX = clamp(this.petX - x0, 60, W - 60);
      const card = '<g transform="translate(' + f(x0) + ' ' + f(y0) + ')"><path d="M' + f(tailX - 16) + ' 2 L' + f(tailX) + ' -18 L' + f(tailX + 16) + ' 2 Z" fill="#FFF8FA" stroke="' + SC.trayEdge + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<rect width="' + W + '" height="' + H + '" rx="26" fill="#FFF8FA" stroke="' + SC.trayEdge + '" stroke-width="3"/><rect x="' + f(tailX - 14) + '" y="0" width="28" height="5" fill="#FFF8FA"/>' +
        '<circle cx="' + (W - 28) + '" cy="28" r="16" fill="#F6DCE3"/><path d="M' + (W - 34) + ' 22 l12 12 M' + (W - 22) + ' 22 l-12 12" stroke="' + SC.text + '" stroke-width="3" stroke-linecap="round"/>' + m + '</g>';
      hits.push({ x: W - 46, y: 10, w: 36, h: 36, fn: () => this.endTalk(true) });
      r.talk.innerHTML = card;
      t.ui = { x0, y0, W, H, hits: hits.map((h) => ({ x: h.x + x0, y: h.y + y0, w: h.w, h: h.h, fn: h.fn })) };
    }
    _isLogged(st, id) { const T = this._logOpts().today; return st === 'symptoms' ? T.symptoms.indexOf(id) >= 0 : st === 'medWhich' ? T.medications.indexOf(id) >= 0 : false; }
    _talkDown(w) {
      const t = this.talk; if (!t || !t.ui) return;
      const h = t.ui.hits.find((b) => w.x > b.x && w.x < b.x + b.w && w.y > b.y && w.y < b.y + b.h);
      if (h) h.fn();
    }
    _talkChip(o, O) {
      const t = this.talk; if (!t) return;
      if (O.single) { this._talkAnswer(o.id); return; }
      if (o.input) {
        this._askText(o.input === 'med' ? 'İlacın adını yaz' : 'Şikayetini yaz', (v) => {
          if (!this.talk) return;
          const list = o.input === 'med' ? t.extra.meds : t.extra.symptoms;
          if (list.indexOf(v) < 0) list.push(v);
          if (t.sel.indexOf(v) < 0) t.sel.push(v);
          this._renderTalk();
        });
        return;
      }
      if (o.locked) return; // daha önce kaydedilmiş: burada silinmez
      const i = t.sel.indexOf(o.id);
      if (i >= 0) t.sel.splice(i, 1); else t.sel.push(o.id);
      this.sfx.play('pop');
      this._renderTalk();
    }
    _talkAnswer(a) {
      const t = this.talk; if (!t) return;
      const st = t.steps[t.i], L = this._logOpts();
      this._hideText();
      if (st === 'forecast') {
        t.data.forecast = a;
        this._earn('forecast', this._rewardAt());
      } else if (st === 'mood') {
        t.data.mood = a; this.setUserMood(a, { silent: true });
      } else if (st === 'symptoms') {
        if (a === 'save') t.sel.forEach((x) => { if (L.today.symptoms.indexOf(x) < 0) this._log('symptom', x, { custom: L.symptoms.indexOf(x) < 0 }); });
        t.data.symptoms = L.today.symptoms.slice();
      } else if (st === 'pain') {
        if (a !== 'none') { this._log('pain', a); t.data.pain = a; } else t.data.pain = 0;
      } else if (st === 'medTaken') {
        t.data.medTaken = a === 'yes' ? true : a === 'no' ? false : null;
        if (a === 'yes') t.steps.splice(t.i + 1, 0, 'medWhich');
        if (a === 'later') this.progress.daily.medRetryAt = Date.now() + 2 * 3600 * 1000; // 2 saat sonra tekrar sorar
        this._emit('medAnswer', { date: L.today.date, taken: t.data.medTaken });
      } else if (st === 'medWhich') {
        if (a === 'save') {
          t.sel.forEach((x) => { if (L.today.medications.indexOf(x) < 0) this._log('medication', x, { custom: L.medications.indexOf(x) < 0 }); });
          t.data.meds = t.sel.slice();
          if (t.data.meds.length) this._earn('medLog', this._rewardAt());
        }
      }
      t.i++;
      this._talkStep();
    }
    endTalk(cancelled) {
      const t = this.talk; if (!t) return;
      this.talk = null; this._hideText();
      if (this.r.talk) this.r.talk.innerHTML = '';
      this._emit('talk', { kind: t.kind, phase: 'end', cancelled: !!cancelled });
      if (cancelled) this.say('Peki, sonra konuşuruz', 2.4, { icon: 'heart' });
    }
    _talkFinish() {
      const t = this.talk; if (!t) return;
      const d = t.data;
      this.endTalk(false);
      if (t.kind === 'forecast') {
        if (d.forecast === 'yes') { this._startAction(ACTIONS.celebrate(this)); this.say('Harika, hazırlıklısın!', 3, { icon: 'sparkle' }); }
        else { this._startAction(ACTIONS.offer(this, 'pouch')); this.say('Unutma, çantana koymayı!', 3, { icon: 'pouch' }); }
        return;
      }
      if (t.kind === 'checkin') {
        this.progress.daily.done.checkin = true;
        this._quest('checkin');
        this._earn('checkin', this._rewardAt());
        this._emit('checkin', { date: this._logOpts().today.date, mood: d.mood, symptoms: d.symptoms, pain: d.pain, medTaken: d.medTaken, medications: d.meds });
        this._renderHud();
      }
      this._clearActions();
      const A = ACTIONS;
      if (d.pain >= 9) { this._enqueue(A.hug(this)); this.say('Bu çok şiddetli bir ağrı. Böyle sürerse doktora danışmayı düşünebilirsin.', 5, { icon: 'heart' }); }
      else if (d.pain >= 6) { this._enqueue(A.offer(this, 'bottle')); this._enqueue(A.hug(this)); this.say('Geçmiş olsun. Sıcak su torbası iyi gelebilir.', 4, { icon: 'bottle' }); }
      else if (d.meds.length) { this._enqueue(A.hug(this)); this.say('İlacını takvimine ekledim, geçmiş olsun.', 3.6, { icon: 'pill' }); }
      else if (d.mood) this._moodReact(d.mood);
      else if (d.symptoms.length || d.pain) { this._enqueue(A.hug(this)); this.say('Kaydettim. Kendine iyi bak.', 3.4, { icon: 'heart' }); }
      else if (t.kind === 'checkin') { this._enqueue(A.dance(this)); this.say('Bugün iyi olmana çok sevindim!', 3.2, { icon: 'sun' }); }
    }
    // hayvan kendisi sorar: regl yaklaşıyorsa ped hatırlatması, günde bir kez şikayet sorusu, regl günlerinde ilaç sorusu
    _autoTalk() {
      if (!this.showTools || this.talk || this.panel || this.game || this.drag || this.sleeping || this.hidden || this.scene !== 'room' || this._sceneMoving()) return;
      if (this.action && this.action.busy) return;
      if (!this.connected && !this.askAlways) return;
      this._checkQuests();
      const d = this.progress.daily, c = this.cycle, T = this._logOpts().today;
      if (c && c.daysUntilNext != null && c.daysUntilNext >= 0 && c.daysUntilNext <= 2 && c.phase !== 'period' && !d.asked.forecast) { this.startTalk('forecast'); return; }
      if (!d.asked.checkin && !d.done.checkin) { this.startTalk('checkin'); return; }
      if (c && c.phase === 'period' && !T.medications.length && d.medRetryAt && Date.now() > d.medRetryAt) { d.medRetryAt = null; this.startTalk('meds'); }
    }
    // serbest yazı için küçük bir HTML kutusu (SVG içinde yazı girilemez)
    _askText(placeholder, cb) {
      const c = this.container; if (typeof document === 'undefined' || !c) return;
      try { if (getComputedStyle(c).position === 'static') c.style.position = 'relative'; } catch (e) { /* yoksay */ }
      let box = this._inputBox;
      const btn = 'font:800 15px -apple-system,Roboto,sans-serif;border:0;border-radius:14px;padding:0 14px;';
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:4%;right:4%;display:none;gap:8px;z-index:5;background:#fff;padding:8px;border-radius:18px;box-shadow:0 6px 20px rgba(120,60,70,.25);';
        box.innerHTML = '<input type="text" maxlength="40" style="flex:1;min-width:0;font:600 16px -apple-system,Roboto,sans-serif;padding:11px 12px;border-radius:12px;border:2px solid #F3CFD9;background:#fff;color:#4A2C22;outline:none">' +
          '<button data-a="ok" style="' + btn + 'background:#F06C8B;color:#fff">Ekle</button><button data-a="no" style="' + btn + 'background:#F6DCE3;color:#8E5E55">Vazgeç</button>';
        ['pointerdown', 'touchstart', 'mousedown'].forEach((ev) => box.addEventListener(ev, (e) => e.stopPropagation()));
        c.appendChild(box); this._inputBox = box;
      }
      const inp = box.querySelector('input'), ok = box.querySelector('[data-a="ok"]'), no = box.querySelector('[data-a="no"]');
      let top = 12;
      try {
        const t = this.talk, pt = this.svg.createSVGPoint(); pt.x = 0; pt.y = t && t.ui ? t.ui.y0 - 10 : this.Hv * 0.4;
        const sp = pt.matrixTransform(this.svg.getScreenCTM()), cr = c.getBoundingClientRect();
        top = Math.max(8, sp.y - cr.top - 66);
      } catch (e) { /* yoksay */ }
      box.style.top = top + 'px'; box.style.display = 'flex';
      inp.value = ''; inp.placeholder = placeholder;
      const done = (v) => { this._hideText(); if (v) cb(v); };
      ok.onclick = () => done(inp.value.trim()); no.onclick = () => done('');
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim()); };
      setTimeout(() => { try { inp.focus(); } catch (e) { /* yoksay */ } }, 30);
    }
    _hideText() { if (this._inputBox) { this._inputBox.style.display = 'none'; try { this._inputBox.querySelector('input').blur(); } catch (e) { /* yoksay */ } } }

    // ---------------------------------------------------------------- genel API
    feed() {
      if (this.scene === 'bath' || (this.action && this.action.name === 'eat')) return false;
      this._clearActions();
      if (this.sleeping) this._enqueue(ACTIONS.wake(this));
      this._enqueue(ACTIONS.eatBowl(this));
      return true;
    }
    feedTreat() { return this.feedFood('treat'); }
    // seçilen mamayı otomatik olarak ağzına götürür (uygulama butonları için)
    feedFood(id) {
      if (!FOODS[id]) id = 'treat';
      if (!this.showTools || this.drag || this.scene === 'bath') return false;
      const wasAsleep = this.sleeping, delay = wasAsleep ? 2.9 : 0;
      if (wasAsleep || this.lightsOff) this.setLights(true);
      const sl = this.slots.food;
      this._startDrag('food', sl.x, sl.y, -1, { food: id });
      this.auto = { t: 0, dur: 1.6 + delay, path: (t) => {
        const m = this._mouthWorld(), k = smooth01(Math.max(0, t - delay) / 1.3);
        return [lerp(sl.x, m.x, k), lerp(sl.y, m.y + 55, k) - Math.sin(k * Math.PI) * 80];
      } };
      return true;
    }
    giveWater() {
      if (this.scene === 'bath' || (this.action && this.action.name === 'drink')) return false;
      this._clearActions();
      if (this.sleeping) this._enqueue(ACTIONS.wake(this));
      this._enqueue(ACTIONS.drink(this));
      return true;
    }
    // otomatik banyo: önce süngerle köpürtür, sonra duşla durular
    bathe() {
      if (!this.showTools || this.drag || this.auto) return false;
      if (this.sleeping || this.lightsOff) this.setLights(true);
      if (this.scene !== 'bath' || this._sceneMoving()) { this.goBath(() => this.bathe()); return true; }
      const sl = this.slots.sponge, sh = this.slots.shower;
      const run = () => {
        this._startDrag('sponge', sl.x, sl.y, -1);
        this.auto = { t: 0, dur: 3.4, path: (t) => {
          const k = smooth01(t / 0.6), a = t * 3.2;
          const p = this._toWorld(200 + Math.sin(a) * 70, (Math.floor(t / 1.1) % 2 ? 300 : 120) + Math.cos(a * 1.3) * 30 + this._upY());
          return [lerp(sl.x, p.x, k), lerp(sl.y, p.y + 34, k)];
        }, onEnd: () => {
          this._startDrag('shower', sh.x, sh.y, -1);
          this.auto = { t: 0, dur: 4.2, path: (t) => {
            const hd = this._toWorld(200, this._headLocal().y - 150), k = smooth01(t / 0.6);
            return [lerp(sh.x, hd.x + 36 + Math.sin(t * 2.4) * 80 * this.s, k), lerp(sh.y, hd.y - 36, k)];
          }, onEnd: () => { if (this.foam.length) { this.foam.slice().forEach((b) => this._popFoamBubble(b)); if (this.wet > 0.15) this._startAction(ACTIONS.shakeDry(this)); } } };
        } };
      };
      if (this.drag && this.drag.returning) this.drag = null;
      run();
      return true;
    }
    // otomatik tarama / diş fırçalama (uygulama butonları için; banyoya geçer)
    brushFur() { return this._autoGroom('brush'); }
    brushTeeth() { return this._autoGroom('tooth'); }
    _autoGroom(type) {
      if (!this.showTools || this.drag || this.auto) return false;
      if (this.sleeping || this.lightsOff) this.setLights(true);
      if (this.scene !== 'bath' || this._sceneMoving()) { this.goBath(() => this._autoGroom(type)); return true; }
      const sl = this.slots[type];
      this._startDrag(type, sl.x, sl.y, -1);
      this.auto = { t: 0, dur: type === 'brush' ? 4.6 : 4.2, path: (t) => {
        const k = smooth01(t / 0.6);
        let p;
        if (type === 'brush') { const a = t * 3.4; const w = this._toWorld(200 + Math.sin(a) * 60, (Math.floor(t / 1.2) % 2 ? 300 : 200) + Math.cos(a * 1.3) * 40 + this._upY()); p = [w.x, w.y - 30]; }
        else { const m = this._mouthWorld(); p = [m.x + 12 + Math.sin(t * 16) * 22, m.y + 47]; }
        return [lerp(sl.x, p[0], k), lerp(sl.y, p[1], k)];
      } };
      return true;
    }
    // ilacı otomatik verir: thermo | syrup | vitamin
    giveMedicine(id) {
      if (!MEDS[id] || !this.showTools || this.drag) return false;
      if (this.scene !== 'room') this.goRoom();
      if (this.hidden) this.stopGame();
      const wasAsleep = this.sleeping, delay = wasAsleep ? 2.9 : 0;
      if (wasAsleep || this.lightsOff) this.setLights(true);
      const sl = this.hudHits ? this.hudHits.find((h) => h.id === 'vet') : null, from = sl || this.slots.food;
      this._startDrag('food', from.x, from.y, -1, { food: id, from });
      this.auto = { t: 0, dur: 1.6 + delay, path: (t) => {
        const m = this._mouthWorld(), k = smooth01(Math.max(0, t - delay) / 1.3);
        return [lerp(from.x, m.x, k), lerp(from.y, m.y + 55, k) - Math.sin(k * Math.PI) * 60];
      } };
      return true;
    }

    // ---------------------------------------------------------------- sahne: oda ⇄ banyo
    goBath(done) { return this._goScene('bath', done); }
    goRoom(done) { return this._goScene('room', done); }
    _sceneMoving() { return Math.abs(this.sceneK - (this.scene === 'bath' ? 1 : 0)) > 0.001; }
    _goScene(sc, done) {
      if (this.scene === sc) { if (done) done(); return false; }
      if (this.menu) this._closeMenu();
      if (this.panel) this._closePanel();
      if (this.game) this.stopGame();
      if (this.drag) { this.drag = null; this.auto = null; this._hideHeld(); }
      this.showering = false; this.sfx.water(false);
      const B = this.ball;
      if (B.active) { B.active = false; B.held = false; this.r.ball.setAttribute('display', 'none'); this.r.ballShadow.setAttribute('display', 'none'); }
      if (sc === 'bath' && (this.sleeping || this.lightsOff)) this.setLights(true);
      if (this.action && /^(eat|nom|drink)/.test(this.action.name)) this._clearActions();
      this.scene = sc; this._sceneDone = done || null;
      this._startAction(ACTIONS.hop(this));
      this._emit('scene', { scene: sc });
      return true;
    }
    _updateScene(dt) {
      const target = this.scene === 'bath' ? 1 : 0;
      if (this.sceneK === target) return;
      this.sceneK = target > this.sceneK ? Math.min(1, this.sceneK + dt / 0.9) : Math.max(0, this.sceneK - dt / 0.9);
      this._renderScene();
      if (this.sceneK === target && this._sceneDone) { const d = this._sceneDone; this._sceneDone = null; d(); }
    }
    _renderScene() {
      const r = this.r, e = smooth01(this.sceneK), Wv = this.Wv;
      if (r.world) { r.world.setAttribute('transform', 'translate(' + f(-e * Wv) + ' 0)'); r.bathroom.setAttribute('transform', 'translate(' + f(Wv) + ' 0)'); }
      if (r.tools) {
        r.tools.setAttribute('transform', 'translate(' + f(-e * Wv) + ' 0)');
        r.toolsBath.setAttribute('transform', 'translate(' + f((1 - e) * Wv) + ' 0)');
        r.tools.setAttribute('display', e < 1 ? 'inline' : 'none');
        r.toolsBath.setAttribute('display', e > 0 ? 'inline' : 'none');
      }
      if (r.hudBtns) { r.hudBtns.setAttribute('display', e < 0.5 ? 'inline' : 'none'); r.hudBtns.setAttribute('opacity', f(1 - e * 2)); }
    }

    sleep() {
      if (this.sleeping) return false;
      if (this.scene === 'bath') this.goRoom();
      this.lightsOff = true;
      if (this.game) this.stopGame();
      this._clearActions();
      this._enqueue(ACTIONS.yawn(this));
      this._enqueue(ACTIONS.fallAsleep(this));
      return true;
    }
    wake() {
      this.lightsOff = false;
      if (!this.sleeping) { this._clearSleepQueue(); return false; }
      this._clearActions();
      this._enqueue(ACTIONS.wake(this));
      return true;
    }
    yawn() { if (!this.sleeping && !this.action) this._startAction(ACTIONS.yawn(this)); }
    celebrate() { if (!this.sleeping) { this._clearActions(); this._startAction(ACTIONS.celebrate(this)); this.sfx.play('chime'); } }
    setSound(on) { this.sfx.setOn(on); this._emit('sound', { on: !!on }); }
    play(name) { if (ACTIONS[name] && name !== 'swat' && name !== 'kick') { this._clearActions(); this._startAction(ACTIONS[name](this)); } }

    _clearActions() {
      if (this.action && this.action.cancel) this.action.cancel();
      this.action = null; this.queue = [];
    }
    _enqueue(a) { if (!this.action) this._startAction(a); else this.queue.push(a); }
    _startAction(a) {
      if (this.action && this.action.cancel) this.action.cancel();
      this.action = a; a.t = 0; a.p = 0;
      if (a.start) a.start();
      if (!a.silent) this._emit('action', { name: a.name, phase: 'start' });
    }

    // ---------------------------------------------------------------- durum
    getState() {
      const r1 = (v) => Math.round(v * 10) / 10, s = this.stats;
      return {
        species: this.species, breed: this.breed, eyes: this.eyes, name: this.name, lightsOn: !this.lightsOff, scene: this.scene,
        stats: { fullness: r1(s.fullness), hydration: r1(s.hydration), energy: r1(s.energy), happiness: r1(s.happiness), cleanliness: r1(s.cleanliness), health: r1(s.health) },
        progress: JSON.parse(JSON.stringify(this.progress)), userMood: this.userMood, cycle: this.cycle, sick: s.health < 40,
        sleeping: this.sleeping, mood: this.mood, lastUpdate: Date.now()
      };
    }
    setState(s) {
      if (!s) return;
      if (typeof s.name === 'string') { this.name = s.name.slice(0, 24); if (this.svg) this._renderName(); }
      if (s.progress && typeof s.progress === 'object') {
        const pr = this.progress, sp = s.progress;
        if (sp.level > 0) pr.level = sp.level | 0;
        if (sp.xp >= 0) pr.xp = +sp.xp; if (sp.coins >= 0) pr.coins = +sp.coins;
        if (Array.isArray(sp.owned)) pr.owned = sp.owned.filter((id) => CLOTHES[id]);
        if (sp.wear) CLOTH_SLOTS.forEach((k) => { pr.wear[k] = CLOTHES[sp.wear[k]] && pr.owned.indexOf(sp.wear[k]) >= 0 ? sp.wear[k] : null; });
        if (sp.daily && typeof sp.daily === 'object' && sp.daily.c) pr.daily = { date: sp.daily.date, c: Object.assign({}, sp.daily.c), done: Object.assign({}, sp.daily.done), asked: Object.assign({}, sp.daily.asked), lastTeeth: sp.daily.lastTeeth || null, medRetryAt: sp.daily.medRetryAt || null };
        if (sp.quests && Array.isArray(sp.quests.list)) pr.quests = { date: sp.quests.date || '', list: sp.quests.list.filter((q) => QUESTS[q.id]).map((q) => ({ id: q.id, have: q.have | 0, claimed: !!q.claimed })), bonus: !!sp.quests.bonus };
        this._checkQuests();
        if (this.svg) { this._renderWear(); this._renderHud(); }
      }
      if (s.userMood && USER_MOODS[s.userMood.mood]) this.userMood = { mood: s.userMood.mood, date: s.userMood.date };
      if ('cycle' in s) { this._silentState = true; this.setCycle(s.cycle); this._silentState = false; }
      if (s.stats) Object.keys(this.stats).forEach((k) => { if (typeof s.stats[k] === 'number') this.stats[k] = clamp(s.stats[k], 0, 100); });
      if (typeof s.sleeping === 'boolean') {
        this.sleeping = s.sleeping; this.lightsOff = s.sleeping;
        this.P.sit = s.sleeping ? 1 : 0; this.P.eyeOpen = s.sleeping ? 0 : 1;
      }
      let rebuild = false;
      if (s.breed && BREEDS[s.breed] && s.breed !== this.breed) { this.breed = s.breed; this.species = BREEDS[s.breed].species; rebuild = true; }
      else if (!s.breed && s.species && s.species !== this.species) { this.breed = DEFAULT_BREED[s.species === 'cat' ? 'cat' : 'dog']; this.species = BREEDS[this.breed].species; rebuild = true; }
      if ('eyes' in s && (s.eyes === null || EYES[s.eyes]) && s.eyes !== this.eyes) { this.eyes = s.eyes; rebuild = true; }
      if (rebuild && this.svg) this._rebuild();
      if (s.lastUpdate) this._tickStats(clamp((Date.now() - s.lastUpdate) / 1000, 0, 72 * 3600), true);
      this._emit('stats', this.getState());
    }
    setStats(stats) { this.setState({ stats }); }

    _tickStats(seconds, raw) {
      const h = raw ? seconds / 3600 : seconds * this.timeScale / 3600;
      if (h <= 0) return;
      const s = this.stats, d = this.decay, m = this.sleeping ? 0.5 : 1;
      s.fullness = clamp(s.fullness - d.fullness * h * m, 0, 100);
      s.hydration = clamp(s.hydration - d.hydration * h * m, 0, 100);
      s.cleanliness = clamp(s.cleanliness - d.cleanliness * h * m, 0, 100);
      s.energy = clamp(this.sleeping ? s.energy + d.energyRegen * h : s.energy - d.energy * h, 0, 100);
      const low = (s.fullness < 25) + (s.hydration < 25) + (s.energy < 15) + (s.cleanliness < 20);
      s.happiness = clamp(s.happiness - (d.happiness + low * d.lowStatPenalty) * h, 0, 100);
      // bakımsızlık sağlığı bozar; iyi bakılınca yavaşça iyileşir
      const neglect = (s.fullness < 15) + (s.hydration < 15) + (s.cleanliness < 15);
      s.health = clamp(neglect ? s.health - 9 * neglect * h : s.health + 3 * h, 0, 100);
    }
    _computeMood() {
      const s = this.stats;
      if (this.sleeping) return 'sleeping';
      if (s.health < 40) return 'sick';
      if (s.energy < 25) return 'tired';
      if (s.fullness < 30) return 'hungry';
      if (s.hydration < 30) return 'thirsty';
      if (s.cleanliness < 30) return 'dirty';
      if (s.happiness < 30) return 'sad';
      if (s.fullness > 65 && s.hydration > 65 && s.energy > 55 && s.happiness > 65 && s.cleanliness > 50) return 'happy';
      return 'neutral';
    }

    // ---------------------------------------------------------------- parçacıklar
    _spawnL(type, lx, ly, o) {
      o = Object.assign({}, o || {});
      const w = this._toWorld(lx, ly), s = this.s;
      ['vx', 'vy', 'g', 'wobble'].forEach((k) => { if (o[k]) o[k] *= s; });
      o.s = (o.s || 1) * s;
      this._spawn(type, w.x, w.y, o);
    }
    _spawn(type, x, y, o) {
      o = o || {};
      const PR = PALETTES_PROPS, line = this.C.line;
      let el;
      const mk = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
      switch (type) {
        case 'heart': el = mk('path', { d: 'M0 7 C-14 -3 -9 -16 0 -8 C9 -16 14 -3 0 7 Z', fill: PR.heart, stroke: line, 'stroke-width': 2 }); break;
        case 'z': el = mk('path', { d: 'M-8 -9 L8 -9 L-8 9 L8 9', fill: 'none', stroke: PR.zzz, 'stroke-width': 4.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); break;
        case 'text':
          el = mk('text', { 'font-family': 'Arial Rounded MT Bold, Nunito, Verdana, sans-serif', 'font-weight': 900, 'font-size': o.size || 18, fill: o.color || line, 'text-anchor': 'middle' });
          el.textContent = o.text || ''; break;
        case 'crumb': el = mk('ellipse', { rx: 4, ry: 3, fill: Math.random() < 0.5 ? PR.kibble : PR.kibble2 }); break;
        case 'drop': el = mk('path', { d: 'M0 -7 C4 -1 5 2 5 4 A5 5 0 0 1 -5 4 C-5 2 -4 -1 0 -7 Z', fill: PR.drop, stroke: '#fff', 'stroke-width': 1.2 }); break;
        case 'sparkle': el = mk('path', { d: 'M0 -9 Q1.5 -1.5 9 0 Q1.5 1.5 0 9 Q-1.5 1.5 -9 0 Q-1.5 -1.5 0 -9 Z', fill: '#FFD166', stroke: line, 'stroke-width': 1.5 }); break;
        case 'growl': el = mk('path', { d: 'M-14 0 Q-10 -6 -6 0 T2 0 T10 0 T18 0', fill: 'none', stroke: line, 'stroke-width': 3, 'stroke-linecap': 'round' }); break;
        case 'stink': el = mk('path', { d: 'M0 10 Q-6 4 0 -2 T0 -14', fill: 'none', stroke: PR.stink, 'stroke-width': 3.5, 'stroke-linecap': 'round' }); break;
        case 'dust': el = mk('ellipse', { rx: 18, ry: 4, fill: '#fff', opacity: 0.7 }); break;
        case 'icontext': el = mk('g', {}); el.innerHTML = o.markup || ''; break;
        case 'note': el = mk('g', {}); el.innerHTML = icon('note', 0, 0, 26); break;
        case 'tuft': el = mk('path', { d: 'M-7 4 Q-3 -7 7 -5 Q1 -1 -7 4 Z', fill: this.C.fur, stroke: line, 'stroke-width': 1.5 }); break;
        case 'bubble':
          el = mk('g', {});
          el.innerHTML = '<circle r="10" fill="#fff" fill-opacity="0.85" stroke="' + PR.foamEdge + '" stroke-width="1.5"/><circle cx="-3.5" cy="-3.5" r="2.2" fill="#fff"/>';
          break;
        default: return;
      }
      (type === 'icontext' && this.r.fxTop ? this.r.fxTop : this.r.fx).appendChild(el);
      this.particles.push({ el, type, x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, age: 0, life: o.life || 1.4,
        s: o.s || 1, rot: o.rot || 0, vr: o.vr || 0, wobble: o.wobble || 0 });
      if (this.particles.length > 220) { const p = this.particles.shift(); p.el.remove(); }
    }
    _updateParticles(dt) {
      const list = this.particles;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1 || (p.type === 'drop' && p.y > this.groundY + 40)) { p.el.remove(); list.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const x = p.x + (p.wobble ? Math.sin(p.age * 4) * p.wobble : 0);
        let sc = p.s, op = 1;
        if (p.type === 'heart' || p.type === 'sparkle') { sc = p.s * (k < 0.15 ? smooth01(k / 0.15) : 1); op = 1 - smooth01((k - 0.6) / 0.4); }
        else if (p.type === 'z') { sc = p.s * (0.6 + k * 0.7); op = k < 0.15 ? k / 0.15 : 1 - smooth01((k - 0.55) / 0.45); }
        else if (p.type === 'bubble') { sc = p.s * (1 + k * 0.4); op = 1 - smooth01((k - 0.5) / 0.5); }
        else if (p.type === 'dust') { sc = 1 + k * 1.5; op = 0.7 * (1 - k); }
        else op = 1 - smooth01((k - 0.65) / 0.35);
        p.el.setAttribute('transform', 'translate(' + f(x) + ' ' + f(p.y) + ') rotate(' + f(p.rot) + ') scale(' + Math.round(sc * 100) / 100 + ')');
        p.el.setAttribute('opacity', f(op));
      }
    }

    // ---------------------------------------------------------------- ana döngü
    _loop(now) {
      this._raf = requestAnimationFrame(this._loop);
      if (this._last == null) { this._last = now; return; }
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      if (this.paused) return;
      this.t += dt;

      this._tickStats(dt);
      if (this.sleeping && this.autoWake && this.stats.energy >= 99.5 && !this.action) this.wake();

      const mood = this._computeMood();
      if (mood !== this.mood) { const old = this.mood; this.mood = mood; this._emit('mood', { mood, previous: old }); }

      const T = Object.assign({}, POSE_DEFAULT, MOOD_POSES[mood]);
      T.itemShow = 0;
      this._idle(dt, T, mood);
      if (this.action) {
        const a = this.action;
        a.t += dt; a.p = a.dur ? clamp(a.t / a.dur, 0, 1) : 0;
        a.update(T, dt, a.p, a.t);
        if (a.dur && a.t >= a.dur) {
          if (a.end) a.end();
          if (!a.silent) this._emit('action', { name: a.name, phase: 'end' });
          this.action = null;
          if (this.queue.length) this._startAction(this.queue.shift());
        }
      }
      this._updateDrag(dt, T);
      this._updateBall(dt, T);
      this._updateGame(dt, T);
      this._updateNight(dt);
      this._updateScene(dt);
      this._updateSpeech(dt);
      this._talkT -= dt;
      if (this._talkT <= 0) { this._talkT = 15; this._autoTalk(); }
      if (this.talk && !this.action && !this.sleeping) { // dinliyor: başı hafif yana eğik, elleri önünde
        T.tilt = 7; T.lookX = 0; T.lookY = 0.15; T.earLift = 0.35; T.smile = Math.max(T.smile, 0.6); T.brow = -0.1;
        T.h0x = 178; T.h0y = 300; T.h1x = 222; T.h1y = 300; T.wagFreq = 1.8; T.wagAmp = 12;
      }
      this._sayCool -= dt; this._cycleNext -= dt;
      if (this.waterEvery > 0 && !this.sleeping) this._waterT += dt;
      if (this.waterEvery > 0 && this._waterT >= this.waterEvery && !this.action && !this.drag && !this.game && !this.panel && this.scene === 'room' && !this.sleeping) this.remindWater();
      this._questT -= dt;
      if (this._questT <= 0) { this._questT = 20; this._checkQuests(); }
      this._applyPet(dt, T);
      this._smoothPose(dt, T);
      this._render(dt, T);
      this._updateFoam(dt);
      this._updateParticles(dt);

      this._statsEmit -= dt;
      if (this._statsEmit <= 0) { this._statsEmit = 1; this._emit('stats', this.getState()); }
    }

    _idle(dt, T, mood) {
      const b = this.blink;
      b.next -= dt;
      if (b.next <= 0 && b.t < 0) { b.t = 0; b.dur = mood === 'tired' ? 0.5 : 0.18; }
      if (b.t >= 0) { b.t += dt; if (b.t >= b.dur) { b.t = -1; b.next = Math.random() < 0.2 ? 0.25 : rand(2, 5); } }
      const lk = this.look;
      lk.next -= dt;
      if (lk.next <= 0) {
        lk.next = rand(1.2, 3.8);
        if (Math.random() < 0.4) { lk.x = 0; lk.y = 0; } else { lk.x = rand(-1, 1); lk.y = rand(-0.6, 0.6); }
      }
      if (!this.sleeping) { T.lookX += lk.x * (mood === 'tired' ? 0.4 : 1); T.lookY += lk.y * 0.6; T.faceX += lk.x * 3; }
      // hafif ağırlık aktarma / sallanma
      T.h0y += Math.sin(this.t * 1.3) * 2; T.h1y += Math.sin(this.t * 1.3 + 1) * 2;
      const et = this.earTwitch;
      et.next -= dt;
      if (et.next <= 0 && et.t < 0) { et.t = 0; et.side = Math.random() < 0.5 ? 0 : 1; }
      if (et.t >= 0) { et.t += dt; if (et.t > 0.35) { et.t = -1; et.next = rand(3, 8); } }

      if (this.wet > 0 && !this.showering) {
        this.fx.drip -= dt;
        if (this.fx.drip <= 0) { this.fx.drip = 0.25 / (this.wet + 0.2); this._spawnL('drop', rand(130, 270), rand(260, 420), { vy: 20, g: 300, life: 0.8, s: 0.7 }); }
      }
      if (this.stats.cleanliness < 30 && !this.sleeping && !this.drag) {
        this.fx.stink -= dt;
        if (this.fx.stink <= 0) { this.fx.stink = rand(1.2, 2.2); this._spawnL('stink', rand(130, 270), rand(230, 290), { vy: -40, life: 1.6, wobble: 5 }); }
      }

      if (this.shine > 0) {
        this.shine -= dt;
        if (Math.random() < dt * 2.5) this._spawnL('sparkle', rand(130, 270), rand(80, 400) + this._upY(), { vy: -20, life: 0.7, s: rand(0.5, 0.9) });
      }
      if (this.hidden || this.talk) return;
      if (this.action || this.pet.level > 0.2 || this.drag || this.ball.held) return;
      if (this.sleeping) {
        this.fx.z -= dt;
        if (this.fx.z <= 0) {
          this.fx.z = 1.3;
          if (Math.random() < 0.35) this.sfx.play('snore');
          const hd = this._headLocal();
          this._spawnL('z', this.species === 'cat' ? 300 : 286, hd.y - 66, { vx: 18, vy: -28, life: 2.6, s: rand(0.8, 1.2), wobble: 6 });
        }
        return;
      }
      if (mood === 'thirsty') {
        this.fx.sweat -= dt;
        if (this.fx.sweat <= 0) { this.fx.sweat = rand(2.5, 4.5); this._spawnL('drop', 278, 96 + this.P.headY, { vy: 22, g: 40, life: 1.4, s: 1.3 }); }
      }
      if (this.ball.active && Math.hypot(this.ball.vx, this.ball.vy) > 40) return;
      this.idleNext -= dt;
      if (this.idleNext > 0) return;
      this.idleNext = rand(5, 9);
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      if (this.cycle && this._cycleNext <= 0 && mood !== 'sick' && !this.game && !this.panel) { this._cycleNext = rand(45, 75); this._cycleAct(); return; }
      if (!this.game && !this.panel) this._autoSay(mood);
      switch (mood) {
        case 'sick': this._startAction(pick([ACTIONS.sneeze, ACTIONS.sigh, ACTIONS.sneeze])(this)); this.idleNext = rand(4, 7); break;
        case 'tired': this._startAction(pick([ACTIONS.yawn, ACTIONS.rubEye])(this)); this.idleNext = rand(6, 10); break;
        case 'hungry': this._startAction(pick([ACTIONS.growl, ACTIONS.lickLips, ACTIONS.growl])(this)); this.idleNext = rand(4.5, 8); break;
        case 'thirsty': this._startAction(pick([ACTIONS.fan, ACTIONS.lickLips])(this)); break;
        case 'dirty': this._startAction(ACTIONS.scratch(this)); break;
        case 'sad': this._startAction(ACTIONS.sigh(this)); break;
        case 'happy': this._startAction(pick([ACTIONS.wave, ACTIONS.hop, ACTIONS.headTilt, ACTIONS.dance])(this)); break;
        default: this._startAction(pick([ACTIONS.headTilt, ACTIONS.wave, ACTIONS.lickLips, ACTIONS.stretch])(this));
      }
    }

    _applyPet(dt, T) {
      const pet = this.pet;
      pet.moving -= dt;
      if (pet.moving <= 0) {
        const before = pet.level;
        pet.level = Math.max(0, pet.level - dt * 0.9);
        if (before > 0 && pet.level === 0) this._emit('pet', { phase: 'end' });
      }
      if (pet.level <= 0) return;
      const k = smooth01(pet.level * 1.6), isCat = this.species === 'cat';
      T.blush = Math.max(T.blush, k * 0.85);
      if (this.sleeping) { T.smile = lerp(T.smile, 0.95, k); T.wagAmp = lerp(T.wagAmp, 6, k); T.wagFreq = lerp(T.wagFreq, 1.2, k); return; }
      if (this.action && this.action.busy) return;
      const side = clamp((pet.x - 200) / 110, -1, 1);
      T.eyeOpen = lerp(T.eyeOpen, 0, k); T.closedCurve = lerp(T.closedCurve, 1, k);
      T.smile = lerp(T.smile, 1, k); T.brow = lerp(T.brow, -0.1, k); T.browY = lerp(T.browY, -3, k);
      T.tilt = lerp(T.tilt, side * 13, k); T.headX = lerp(T.headX, side * 6, k); T.faceX = lerp(T.faceX, side * 4, k);
      T.earLift = lerp(T.earLift, isCat ? -0.25 : -0.35, k);
      T.wagFreq = lerp(T.wagFreq, isCat ? 0.8 : 3.4, k); T.wagAmp = lerp(T.wagAmp, isCat ? 10 : 24, k); T.tailBase = lerp(T.tailBase, -12, k);
      // elleri göğsünde birleşir, mutlulukla sallanır
      const sw = Math.sin(this.t * 4) * 6;
      T.h0x = lerp(T.h0x, 186 + sw, k); T.h0y = lerp(T.h0y, 282, k); T.h1x = lerp(T.h1x, 214 + sw, k); T.h1y = lerp(T.h1y, 282, k);
      if (isCat) {
        T.whisker = lerp(T.whisker, 1, k);
        pet.purr -= dt;
        if (pet.purr <= 0 && k > 0.5) {
          pet.purr = 1.1;
          this._spawnL('text', 280 + rand(-8, 8), 110 + this.P.headY, { text: 'purr', vy: -35, vx: 15, life: 1.4, size: 17, color: '#C46A22' });
        }
      } else {
        T.mouthOpen = lerp(T.mouthOpen, 0.45, k); T.tongue = lerp(T.tongue, 0.7, k); T.breathRate = lerp(T.breathRate, 1.8, k);
      }
    }

    _smoothPose(dt, T) {
      const P = this.P;
      for (const key in T) {
        if (key.charAt(0) === '_' || !(key in POSE_DEFAULT)) continue;
        const sp = POSE_SPEED[key] || 7;
        P[key] += (T[key] - P[key]) * (1 - Math.exp(-sp * dt));
      }
      const R = this.raw;
      R.hop = T._hop || 0; R.shake = T._shake || 0; R.squash = T._squash || 0; R.rot = T._rot || 0; R.fluff = T._fluff || 0;
      const it = this.item;
      it.show += ((T.itemShow || 0) - it.show) * (1 - Math.exp(-dt * 10));
      if (T.itemType) it.type = T.itemType;
      if (T.itemScale != null) it.scale = T.itemScale; else it.scale = 1;
    }

    // ---------------------------------------------------------------- çizim
    _limb(name, i, pts, w, color) {
      const r = this.r;
      const d = 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L');
      r[name + 'O' + i].setAttribute('d', d); r[name + 'O' + i].setAttribute('stroke-width', f(w * 2 + 7));
      r[name + 'F' + i].setAttribute('d', d); r[name + 'F' + i].setAttribute('stroke-width', f(w * 2));
      const pp = r[name + 'P' + i];
      if (pp) { const m = pts.length - 1; pp.setAttribute('d', 'M' + f(lerp(pts[m - 1][0], pts[m][0], 0.2)) + ' ' + f(lerp(pts[m - 1][1], pts[m][1], 0.2)) + ' L' + f(pts[m][0]) + ' ' + f(pts[m][1])); pp.setAttribute('stroke-width', f(w * 2)); }
      // ince parlama (tüp hissi)
      const off = -w * 0.35;
      const hp = pts.map((p, k) => {
        const q = pts[Math.min(k + 1, pts.length - 1)], o = pts[Math.max(k - 1, 0)];
        const tx = q[0] - o[0], ty = q[1] - o[1], l = Math.hypot(tx, ty) || 1;
        return [p[0] + (-ty / l) * off * (i === 0 ? 1 : -1), p[1] + (tx / l) * off * (i === 0 ? 1 : -1)];
      });
      r[name + 'H' + i].setAttribute('d', 'M' + hp.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L')); r[name + 'H' + i].setAttribute('stroke-width', f(w * 0.6));
      // desen noktaları
      if (this._decoKind) {
        const kids = r[name + 'D' + i].children;
        const fr = this._decoKind === 'spots' ? [0.35, 0.7] : [0.45, 0.75];
        for (let k = 0; k < kids.length; k++) {
          const t = fr[k] * (pts.length - 1), a = Math.floor(t), u = t - a, b2 = Math.min(a + 1, pts.length - 1);
          const x = lerp(pts[a][0], pts[b2][0], u), y = lerp(pts[a][1], pts[b2][1], u);
          const ang = Math.atan2(pts[b2][1] - pts[a][1], pts[b2][0] - pts[a][0]) * 57.3;
          const side = this._decoKind === 'spots' ? (k ? 5 : -5) : 0;
          kids[k].setAttribute('transform', 'translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(ang + 90) + ') translate(' + side + ' 0)');
        }
      }
    }

    _render(dt, T) {
      const P = this.P, r = this.r, S = SPECIES[this.species], R = this.raw, s = this.s;
      this.breathPhase += dt * Math.PI * 2 * P.breathRate;
      this.wagPhase += dt * Math.PI * 2 * P.wagFreq;
      const breath = Math.sin(this.breathPhase) * P.breathAmp;
      const wag = Math.sin(this.wagPhase);
      const sway = Math.sin(this.t * 0.9) * 1.2 * (1 - P.sit);

      r.pet.setAttribute('transform', 'translate(' + f(this.petX - 200 * s) + ' ' + f(this.groundY - G * s) + ') scale(' + Math.round(s * 1000) / 1000 + ')');
      const fl = 1 + R.fluff * 0.07;
      r.root.setAttribute('transform', 'translate(' + f(R.shake) + ' 0) rotate(' + f(R.rot + sway) + ' 200 ' + (G - 60) + ')' +
        (R.fluff ? ' translate(200 ' + G + ') scale(' + Math.round(fl * 100) / 100 + ') translate(-200 -' + G + ')' : ''));
      r.shadow.setAttribute('rx', f(96 * (1 + P.sit * 0.2) * (1 + R.hop / 160)));
      r.shadow.setAttribute('opacity', f(1 + R.hop / 70));

      // üst gövde (oturunca aşağı iner, zıplayınca yükselir)
      const sq = R.squash, up = P.sit * SIT_DROP + R.hop + sq * 8;
      r.upper.setAttribute('transform', 'translate(0 ' + f(up) + ')');
      r.wearBack.setAttribute('transform', 'translate(0 ' + f(up) + ')');
      if (this._hiddenShown !== this.hidden) { this._hiddenShown = this.hidden; r.pet.setAttribute('display', this.hidden ? 'none' : 'inline'); }
      const sy = (1 + breath * 0.016) * (1 - sq * 0.07), sx = (1 - breath * 0.006) * (1 + sq * 0.05);
      r.body.setAttribute('transform', 'translate(200 414) scale(' + Math.round(sx * 1000) / 1000 + ' ' + Math.round(sy * 1000) / 1000 + ') translate(-200 -414)');
      r.tail.setAttribute('transform', 'translate(0 ' + f(P.sit * 40) + ') rotate(' + f(P.tailBase + wag * P.wagAmp) + ' 234 392)');

      // bacaklar + ayaklar
      const sit = P.sit, sk = smooth01((sit - 0.35) / 0.4);
      for (let i = 0; i < 2; i++) {
        const dir = i === 0 ? -1 : 1, lift = P['foot' + i];
        const hip = [HIP[i][0], HIP[i][1] + up];
        const fx = lerp(FOOT[i][0], 200 + dir * 52, sit) + dir * lift * 14;
        const fyy = lerp(G - 16, G - 22, sit) - lift * 44 - Math.max(0, R.hop) * 0;
        const footY = Math.min(fyy, hip[1] + 70);
        const knee = [lerp(hip[0], fx, 0.5) + dir * (sit * 10 + lift * 8), lerp(hip[1], footY, 0.5)];
        this._limb('leg', i, [hip, knee, [fx, footY]], 21);
        r['foot' + i].setAttribute('transform', 'translate(' + f(fx) + ' ' + f(footY + 16) + ') rotate(' + f(dir * (6 + lift * 20)) + ')');
        r['foot' + i].setAttribute('opacity', f(1 - sk));
        r['sole' + i].setAttribute('transform', 'translate(' + f(fx + dir * 6) + ' ' + f(G - 18) + ') rotate(' + f(dir * 14) + ')');
        r['sole' + i].setAttribute('opacity', f(sk));
      }

      // kafa
      const hx = P.headX, hy = P.headY + breath * 1.2;
      r.head.setAttribute('transform', 'translate(' + f(hx) + ' ' + f(hy) + ') rotate(' + f(P.tilt - R.rot * 0.6) + ' 200 205) translate(200 205) scale(' + Math.round(P.headScale * 1000) / 1000 + ') translate(-200 -205)');
      r.face.setAttribute('transform', 'translate(' + f(P.faceX) + ' 0)');
      r.earsAll.forEach((e) => e.setAttribute('transform', 'translate(' + f(-P.faceX * 0.35) + ' 0)'));
      const tw = this.earTwitch.t >= 0 ? Math.sin(this.earTwitch.t / 0.35 * Math.PI * 3) * 8 : 0;
      const flap = R.rot ? Math.sin(this.t * 40) * 18 : 0;
      const floppy = BREEDS[this.breed].ears.indexOf('floppy') === 0;
      for (let i = 0; i < 2; i++) {
        const twi = this.earTwitch.side === i ? tw : 0;
        if (floppy) r['ear' + i].setAttribute('transform', 'rotate(' + f(P.earLift * 24 + wag * P.wagAmp * 0.12 + twi + breath * 0.6 + flap) + ' 136 80)');
        else r['ear' + i].setAttribute('transform', 'rotate(' + f(-P.earLift * 16 + twi + flap * 0.4) + ' 150 96)');
      }

      // kollar (ters kinematik)
      const shY = breath * 0.8;
      const hands = [];
      for (let i = 0; i < 2; i++) {
        const Sx = SHOULDER[i][0], Sy = SHOULDER[i][1] + shY;
        const res = ik(Sx, Sy, P['h' + i + 'x'], P['h' + i + 'y'], L1, L2, i === 0 ? 1 : -1);
        this._limb('arm', i, [[Sx, Sy], [res.ex, res.ey], [res.hx, res.hy]], ARM_W);
        if (SLEEVES[this.progress.wear.body]) {
          const at = (k) => f(lerp(Sx, res.ex, k)) + ' ' + f(lerp(Sy, res.ey, k));
          r['sleeve' + i].setAttribute('display', 'inline');
          r['sleeveO' + i].setAttribute('d', 'M' + at(0) + ' L' + at(0.9)); r['sleeveO' + i].setAttribute('stroke-width', f(ARM_W * 2 + 11));
          r['sleeveF' + i].setAttribute('d', 'M' + at(0) + ' L' + at(0.9)); r['sleeveF' + i].setAttribute('stroke-width', f(ARM_W * 2 + 4));
          r['sleeveC' + i].setAttribute('d', 'M' + at(0.72) + ' L' + at(0.9)); r['sleeveC' + i].setAttribute('stroke-width', f(ARM_W * 2 + 4));
        } else r['sleeve' + i].setAttribute('display', 'none');
        const ang = Math.atan2(res.hy - res.ey, res.hx - res.ex) * 57.3;
        r['hand' + i].setAttribute('transform', 'translate(' + f(res.hx) + ' ' + f(res.hy) + ') rotate(' + f(ang - 90) + ')');
        hands.push([res.hx, res.hy]);
      }
      // eldeki nesne
      const it = this.item;
      if (it.show > 0.02 && it.type) {
        r.handItem.setAttribute('display', 'inline');
        const mx = (hands[0][0] + hands[1][0]) / 2, my = (hands[0][1] + hands[1][1]) / 2;
        const sc = Math.round((0.5 + it.show * 0.5) * 100) / 100;
        r.handItem.setAttribute('transform', 'translate(' + f(mx) + ' ' + f(my + (it.type === 'treat' ? -6 : 4)) + ') rotate(' + f(P.itemTilt) + ') scale(' + sc + ')');
        r.handItem.setAttribute('opacity', f(clamp(it.show * 2, 0, 1)));
        r.itemFood.setAttribute('display', it.type === 'food' ? 'inline' : 'none');
        r.itemWater.setAttribute('display', it.type === 'water' ? 'inline' : 'none');
        r.itemTreat.setAttribute('display', it.type === 'treat' ? 'inline' : 'none');
        if (it.type === 'treat') r.itemTreatS.setAttribute('transform', 'scale(' + Math.round(Math.max(0.01, it.scale) * 100) / 100 + ')');
        if (it.type === 'food') { const n = Math.ceil(it.amount * 7 - 0.001); for (let k = 0; k < 7; k++) { const e = r['hk' + k]; if (e) e.setAttribute('display', k < n ? 'inline' : 'none'); } }
        if (it.type === 'water' && r.handWater) { r.handWater.setAttribute('ry', f(1 + it.amount * 4)); r.handWater.setAttribute('rx', f(16 + it.amount * 9)); }
      } else r.handItem.setAttribute('display', 'none');

      // gözler, kaşlar, ağız
      const bl = this.blink.t >= 0 ? Math.sin(clamp(this.blink.t / this.blink.dur, 0, 1) * Math.PI) : 0;
      const open = clamp(P.eyeOpen * (1 - bl), 0, 1);
      for (let i = 0; i < 2; i++) this._renderEye(i, S.eyes[i], open);
      for (let i = 0; i < 2; i++) {
        const e = S.eyes[i];
        const y = e.cy - e.ry - 12 + P.browY - (1 - open) * 2;
        const inner = -P.brow * 6, outer = P.brow * 3;
        r['brow' + i].setAttribute('d', i === 0
          ? 'M' + (e.cx - 14) + ' ' + f(y + outer) + ' Q' + e.cx + ' ' + f(y - 4) + ' ' + (e.cx + 13) + ' ' + f(y + inner)
          : 'M' + (e.cx - 13) + ' ' + f(y + inner) + ' Q' + e.cx + ' ' + f(y - 4) + ' ' + (e.cx + 14) + ' ' + f(y + outer));
      }
      this._renderMouth(S, breath);
      r.cheeks.setAttribute('opacity', f(P.blush * 0.75));
      if (r.whisk0) {
        const wsk = P.whisker * Math.sin(this.t * 30) * 2 + Math.sin(this.t * 1.7) * 1.5;
        r.whisk0.setAttribute('transform', 'rotate(' + f(wsk) + ' 172 184)');
        r.whisk1.setAttribute('transform', 'rotate(' + f(wsk) + ' 172 184)');
      }
      const dirt = f(clamp((45 - this.stats.cleanliness) / 30, 0, 1));
      r.mudBody.setAttribute('opacity', dirt); r.mudHead.setAttribute('opacity', dirt);
      r.sickFx.setAttribute('opacity', f(clamp((48 - this.stats.health) / 12, 0, 1)));
    }

    _renderEye(i, e, open) {
      const r = this.r, P = this.P;
      if (open < 0.1) {
        r['eye' + i].setAttribute('display', 'none');
        r['closed' + i].setAttribute('display', 'inline');
        r['closed' + i].setAttribute('d', 'M' + f(e.cx - e.rx * 0.85) + ' ' + f(e.cy + 2) + ' Q' + e.cx + ' ' + f(e.cy + 2 - 15 * P.closedCurve) + ' ' + f(e.cx + e.rx * 0.85) + ' ' + f(e.cy + 2));
        return;
      }
      r['eye' + i].setAttribute('display', 'inline');
      r['closed' + i].setAttribute('display', 'none');
      const px = e.cx + P.lookX * e.rx * 0.32, py = e.cy + P.lookY * e.ry * 0.28;
      const ir = r['iris' + i], pu = r['pupil' + i];
      ir.setAttribute('cx', f(px)); ir.setAttribute('cy', f(py));
      pu.setAttribute('cx', f(px)); pu.setAttribute('cy', f(py));
      if (this.species === 'cat') { pu.setAttribute('rx', f(3.5 + P.pupil * 8)); pu.setAttribute('ry', '14'); }
      else { pu.setAttribute('rx', f(7 + P.pupil * 3)); pu.setAttribute('ry', f(9 + P.pupil * 3)); }
      r['hl' + i + 'a'].setAttribute('cx', f(px + 5)); r['hl' + i + 'a'].setAttribute('cy', f(py - 6));
      r['hl' + i + 'b'].setAttribute('cx', f(px - 4)); r['hl' + i + 'b'].setAttribute('cy', f(py + 5));
      const x0 = e.cx - e.rx - 4, x1 = e.cx + e.rx + 4;
      const lidY = lerp(e.cy + e.ry + 2, e.cy - e.ry - 3, open), curve = e.ry * 0.35;
      r['lid' + i].setAttribute('d', 'M' + x0 + ' ' + (e.cy - e.ry - 8) + ' L' + x1 + ' ' + (e.cy - e.ry - 8) + ' L' + x1 + ' ' + f(lidY) + ' Q' + e.cx + ' ' + f(lidY + curve) + ' ' + x0 + ' ' + f(lidY) + 'Z');
      r['lidEdge' + i].setAttribute('d', open > 0.96 ? '' : 'M' + x0 + ' ' + f(lidY) + ' Q' + e.cx + ' ' + f(lidY + curve) + ' ' + x1 + ' ' + f(lidY));
      const lowY = lerp(e.cy + e.ry + 3, e.cy + e.ry * 0.15, P.squint);
      r['low' + i].setAttribute('d', 'M' + x0 + ' ' + (e.cy + e.ry + 8) + ' L' + x1 + ' ' + (e.cy + e.ry + 8) + ' L' + x1 + ' ' + f(lowY) + ' Q' + e.cx + ' ' + f(lowY - e.ry * 0.3) + ' ' + x0 + ' ' + f(lowY) + 'Z');
      r['lowEdge' + i].setAttribute('d', P.squint < 0.05 ? '' : 'M' + x0 + ' ' + f(lowY) + ' Q' + e.cx + ' ' + f(lowY - e.ry * 0.3) + ' ' + x1 + ' ' + f(lowY));
    }

    _renderMouth(S, breath) {
      const r = this.r, P = this.P, m = S.mouth;
      const open = clamp(P.mouthOpen, 0, 1.2);
      const hw = m.hw * (1 + open * 0.25), cy = m.y - P.smile * 6, ctrlY = m.y + 3 + 5 * P.smile;
      const Lx = m.x - hw, Rx = m.x + hw;
      r.mouthLine.setAttribute('d', 'M' + f(Lx) + ' ' + f(cy) + ' Q' + f(m.x - hw * 0.5) + ' ' + f(ctrlY) + ' ' + m.x + ' ' + m.y + ' Q' + f(m.x + hw * 0.5) + ' ' + f(ctrlY) + ' ' + f(Rx) + ' ' + f(cy));
      if (open > 0.03) {
        const D = m.depth * open;
        const shape = 'M' + f(Lx) + ' ' + f(cy) + ' C' + f(Lx - 2) + ' ' + f(m.y + D * 1.25) + ' ' + f(Rx + 2) + ' ' + f(m.y + D * 1.25) + ' ' + f(Rx) + ' ' + f(cy) +
          ' Q' + f(m.x + hw * 0.5) + ' ' + f(ctrlY) + ' ' + m.x + ' ' + m.y + ' Q' + f(m.x - hw * 0.5) + ' ' + f(ctrlY) + ' ' + f(Lx) + ' ' + f(cy) + 'Z';
        r.mouthOpen.setAttribute('d', shape); r.mouthClip.setAttribute('d', shape); r.mouthOpen.setAttribute('display', 'inline');
        r.mouthTongue.setAttribute('cx', m.x); r.mouthTongue.setAttribute('cy', f(m.y + D * 0.95));
        r.mouthTongue.setAttribute('rx', f(hw * 0.75)); r.mouthTongue.setAttribute('ry', f(D * 0.42));
        if (P.teeth > 0.02) {
          const tY = m.y + D * 0.3, n = 4, tw = (Rx - Lx) / n;
          let td = 'M' + f(Lx - 4) + ' ' + f(m.y - 14) + ' H' + f(Rx + 4) + ' V' + f(tY);
          for (let i = n; i > 0; i--) { const x = Lx + i * tw; td += ' Q' + f(x - tw / 2) + ' ' + f(tY + 7) + ' ' + f(x - tw) + ' ' + f(tY); }
          r.teeth.setAttribute('d', td + ' L' + f(Lx - 4) + ' ' + f(tY) + ' Z'); r.teeth.setAttribute('opacity', f(P.teeth));
        } else r.teeth.setAttribute('opacity', '0');
      } else { r.mouthOpen.setAttribute('display', 'none'); r.mouthTongue.setAttribute('rx', '0'); r.teeth.setAttribute('opacity', '0'); }
      const tg = clamp(P.tongue, 0, 1.3);
      if (tg > 0.05) {
        const w = S.tongueW, x = m.x + P.tongueX * 9, ys = m.y + 1 + open * m.depth * 0.45;
        const yb = ys + tg * (this.species === 'dog' ? 26 : 16) + Math.max(0, breath) * (P.breathRate > 1 ? 2 : 0);
        r.tongue.setAttribute('d', 'M' + f(x - w) + ' ' + f(ys) + ' L' + f(x - w) + ' ' + f(yb) + ' Q' + f(x - w) + ' ' + f(yb + w * 1.25) + ' ' + f(x) + ' ' + f(yb + w * 1.25) +
          ' Q' + f(x + w) + ' ' + f(yb + w * 1.25) + ' ' + f(x + w) + ' ' + f(yb) + ' L' + f(x + w) + ' ' + f(ys) + 'Z');
        r.tongueLine.setAttribute('d', 'M' + f(x) + ' ' + f(ys + 3) + ' L' + f(x) + ' ' + f(yb + w * 0.5));
        r.tongueOut.setAttribute('display', 'inline');
      } else r.tongueOut.setAttribute('display', 'none');
    }
  }

  const PALETTES_PROPS = {
    foodBowl: '#F06C8B', foodBowlShade: '#C94A6A', kibble: '#A8582B', kibble2: '#C7773D',
    waterBowl: '#4FA9D6', waterBowlShade: '#2F7FAE', water: '#9EDCFA',
    heart: '#FF5E86', zzz: '#7C8BE0', drop: '#6CC3F0', shadow: 'rgba(60,30,20,0.16)', mud: '#7E5233',
    treat: '#E8B26A', fish: '#F7A0B4', chrome: '#D4DDE6', chromeDark: '#8E9BA8', hose: '#A9B8C6',
    foamEdge: '#B9DDF2', stink: '#8BA35A'
  };

  // ================================================================ Aksiyonlar (kol hareketleri dahil)
  // { name, dur, busy, silent, start(), update(T, dt, p, t), end(), cancel() }
  // ağzını patisiyle silme
  function wipeMouth(pet, T, t, k) {
    const m = pet._mouthUpper();
    T.h1x = lerp(T.h1x, m.x + Math.sin(t * 11) * 26, k); T.h1y = lerp(T.h1y, m.y + 8, k);
    T.h0x = lerp(T.h0x, 188, k); T.h0y = lerp(T.h0y, 326, k);
    T.mouthOpen = 0; T.tongue = 0; T.squint = 0.6 * k; T.eyeOpen = lerp(T.eyeOpen, 0.5, k); T.smile = 0.9; T.tilt += -6 * k;
  }
  // karnını sıvazlama
  function patBelly(T, t, k) {
    T.h0x = lerp(T.h0x, 182 + Math.cos(t * 6) * 10, k); T.h0y = lerp(T.h0y, 330 + Math.sin(t * 6) * 8, k);
    T.h1x = lerp(T.h1x, 218 + Math.cos(t * 6 + 2) * 10, k); T.h1y = lerp(T.h1y, 334 + Math.sin(t * 6 + 2) * 8, k);
  }

  const ACTIONS = {
    // kaptan mama: kabı iki eliyle tutar, kafasını eğip yer, sonra ağzını siler
    eatBowl(pet) {
      return {
        name: 'eat', dur: 7, busy: true,
        start() { pet.item.amount = 1; pet.item.type = 'food'; this.bites = 0; },
        update(T, dt, p, t) {
          T.wagFreq = 2.8; T.wagAmp = 20; T.tailBase = -10; T.earLift = 0.2; T.brow = 0; T.sit = 0;
          T.itemType = 'food';
          if (t < 4.6) {
            T.itemShow = 1;
            T.h0x = 150; T.h0y = 262; T.h1x = 250; T.h1y = 262; T.itemTilt = 0;
            if (t < 0.7) { T.lookY = 1; T.smile = 1; T.mouthOpen = 0.25; T.tongue = 0.35; T.pupil = 1; return; }
            const c = (t - 0.7) / 1.3, u = c - Math.floor(c);
            const down = u < 0.4 ? smooth01(u / 0.2) : 1 - smooth01((u - 0.4) / 0.2);
            T.headY = lerp(16, 46, down); T.headScale = 0.96; T.tilt = Math.sin(t * 2) * 3;
            T.h0y += down * 6; T.h1y += down * 6;
            T.lookY = 1; T.squint = 0.5; T.eyeOpen = 0.55; T.smile = 0.6;
            if (u > 0.38 && u < 0.45 && !this._bit) {
              this._bit = true;
              pet.item.amount = Math.max(0, pet.item.amount - 1 / 3);
              pet.sfx.play('crunch');
              for (let i = 0; i < 4; i++) pet._spawnL('crumb', 200 + rand(-30, 30), 250 + pet._upY(), { vx: rand(-60, 60), vy: rand(-110, -60), g: 320, life: 0.8 });
            }
            if (u > 0.5) this._bit = false;
            if (u > 0.55) { T.mouthOpen = 0.12 + 0.28 * Math.max(0, Math.sin(t * 15)); T.headY += Math.sin(t * 15) * 1.5; } else T.mouthOpen = 0;
            return;
          }
          T.itemShow = 0;
          if (t < 6) { wipeMouth(pet, T, t, smooth01((t - 4.6) / 0.3)); return; }
          patBelly(T, t, 1); T.smile = 1; T.squint = 0.6; T.eyeOpen = 0.4; T.blush = 0.5;
        },
        end() {
          pet.stats.fullness = Math.min(100, pet.stats.fullness + 35);
          pet.stats.happiness = Math.min(100, pet.stats.happiness + 5);
          pet._spawnL('heart', 240, 80, { vy: -50, s: 1.1 });
          pet._emit('stats', pet.getState());
        }
      };
    },

    // elle verilen mamayı patileriyle tutup yer, ağzını siler
    nom(pet, foodId) {
      const food = FOODS[foodId] || FOODS.treat;
      return {
        name: 'eat', dur: 4.4, busy: true,
        start() {
          this.bite = -1;
          pet.r.itemTreatS.innerHTML = foodIcon(foodId || 'treat', pet.species, PALETTES_PROPS, pet.C.line);
          pet._emit('feed', { food: foodId, phase: 'start' });
        },
        update(T, dt, p, t) {
          T.wagFreq = 3.2; T.wagAmp = 22; T.tailBase = -12; T.earLift = 0.3; T.brow = -0.1; T.blush = 0.5; T.lookY = 0.3; T.lookX = 0;
          const m = pet._mouthUpper();
          T.itemType = 'treat';
          if (t < 2) {
            T.itemShow = 1;
            T.h0x = m.x - 20; T.h0y = m.y + 22; T.h1x = m.x + 20; T.h1y = m.y + 22;
            const bites = Math.floor(t / 0.5);
            T.itemScale = 1 - Math.min(1, bites / 4);
            if (bites !== this.bite) {
              this.bite = bites;
              pet.sfx.play(food.drink ? 'lap' : 'crunch');
              if (!food.drink) for (let i = 0; i < 3; i++) pet._spawnL('crumb', m.x + rand(-14, 14), m.y + 20 + pet._upY(), { vx: rand(-70, 70), vy: rand(-90, -30), g: 420, life: 0.8 });
              else pet._spawnL('drop', m.x + rand(-8, 8), m.y + 18 + pet._upY(), { vy: 30, g: 300, life: 0.8, s: 0.7 });
            }
            const c = Math.max(0, Math.sin(t * 13));
            T.mouthOpen = 0.08 + 0.3 * c; T.eyeOpen = 0; T.closedCurve = 1; T.smile = 1;
            T.headY = Math.sin(t * 13) * 1.5;
            return;
          }
          T.itemShow = 0;
          if (t < 3.3) { wipeMouth(pet, T, t, smooth01((t - 2) / 0.3)); return; }
          patBelly(T, t, 1); T.smile = 1; T.squint = 0.5; T.eyeOpen = 0.6; T.mouthOpen = 0.12; T.tongue = 0.6; T.tongueX = Math.sin(t * 10);
        },
        end() {
          const s = pet.stats;
          Object.keys(food.fx).forEach((k) => { s[k] = clamp(s[k] + food.fx[k], 0, 100); });
          pet._spawnL('heart', 245, 70, { vy: -50, s: food.fx.happiness >= 10 ? 1.4 : 1 });
          if (food.fx.happiness >= 10) pet._spawnL('sparkle', 150, 90, { vy: -40, vr: 120, s: 1.1 });
          pet.sfx.play('gulp');
          pet._emit('feed', { food: foodId, phase: 'end' });
          pet._emit('stats', pet.getState());
        }
      };
    },

    refuse() {
      return {
        name: 'refuse', dur: 1.3, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2);
          T.faceX = Math.sin(t * 16) * 9 * o; T.tilt = Math.sin(t * 16) * 5 * o;
          T.eyeOpen = lerp(1, 0.5, o); T.smile = 0.2; T.brow = 0.2; T.mouthOpen = 0;
          T.h1x = lerp(T.h1x, 258 + Math.sin(t * 16) * 16, o); T.h1y = lerp(T.h1y, 236, o); // eliyle "hayır"
          T.h0x = lerp(T.h0x, 184, o); T.h0y = lerp(T.h0y, 330, o);
        }
      };
    },

    // su kabını iki eliyle tutup içer
    drink(pet) {
      return {
        name: 'drink', dur: 6, busy: true,
        start() { pet.item.amount = 1; pet.item.type = 'water'; this.rip = 0; },
        update(T, dt, p, t) {
          T.wagFreq = 2; T.wagAmp = 14; T.earLift = 0.1; T.brow = 0; T.sit = 0;
          T.itemType = 'water';
          if (t < 4) {
            T.itemShow = 1;
            const m = pet._mouthUpper();
            T.h0x = m.x - 46; T.h0y = m.y + 52; T.h1x = m.x + 46; T.h1y = m.y + 52;
            if (t < 0.7) { T.lookY = 1; T.smile = 0.8; T.mouthOpen = 0.3; T.tongue = 0.5; T.pupil = 0.9; T.itemTilt = 0; return; }
            const lap = Math.sin(t * 20);
            T.itemTilt = -8; T.headY = 14 + lap * 2; T.lookY = 1; T.eyeOpen = 0.5; T.squint = 0.4;
            T.mouthOpen = 0.35; T.tongue = 0.6 + 0.6 * Math.max(0, lap); T.smile = 0.5;
            pet.item.amount = Math.max(0.1, 1 - (t - 0.7) / 3.3 * 0.9);
            this.rip -= dt;
            if (this.rip <= 0) { this.rip = 0.25; pet.sfx.play('lap'); pet._spawnL('drop', m.x + rand(-25, 25), m.y + 40 + pet._upY(), { vx: rand(-50, 50), vy: rand(-120, -80), g: 380, life: 0.7, s: 0.7 }); }
            return;
          }
          T.itemShow = 0;
          if (t < 5.2) { wipeMouth(pet, T, t, smooth01((t - 4) / 0.3)); return; }
          T.smile = 1; T.squint = 0.5; T.eyeOpen = 0.65; T.mouthOpen = 0.1; T.tongue = 0.5; T.tongueX = Math.sin(t * 9);
        },
        end() {
          pet.stats.hydration = Math.min(100, pet.stats.hydration + 40);
          pet.stats.happiness = Math.min(100, pet.stats.happiness + 3);
          pet._spawnL('sparkle', 250, 90, { vy: -40, s: 1.1, vr: 90 });
          pet._emit('stats', pet.getState());
        }
      };
    },

    // duştan sonra silkelenerek kurulanma (kollar çırpınır)
    shakeDry(pet) {
      return {
        name: 'shakeDry', dur: 3, busy: true,
        start() { this.pop = 0; this.burst = 0; pet.sfx.play('shake'); },
        update(T, dt, p, t) {
          T.sit = 0;
          if (t < 1.9) {
            const env = bump(t, 0.1, 1.9, 0.2);
            T._rot = Math.sin(t * Math.PI * 2 * 6.5) * 10 * env;
            T._shake = Math.sin(t * Math.PI * 2 * 6.5 + 1) * 6 * env;
            T.eyeOpen = 0; T.closedCurve = 0.2; T.squint = 1; T.mouthOpen = 0.2 * env; T.smile = 0.3;
            T.earLift = 0.3; T.wagFreq = 6; T.wagAmp = 25 * env; T.tailBase = -10;
            const fl = Math.sin(t * 38);
            T.h0x = 108; T.h0y = 262 + fl * 30; T.h1x = 292; T.h1y = 262 - fl * 30;
            this.burst -= dt;
            if (this.burst <= 0 && env > 0.2) {
              this.burst = 0.02;
              const a = rand(0, Math.PI * 2), rr = rand(80, 120);
              const cy = Math.random() < 0.5 ? pet._headLocal().y : 320;
              pet._spawnL('drop', 200 + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, { vx: Math.cos(a) * rand(200, 320), vy: Math.sin(a) * rand(150, 260) - 80, g: 600, life: 0.7, s: 0.7 });
            }
            this.pop -= dt;
            if (this.pop <= 0 && pet.foam.length) { this.pop = 1.5 / (pet.foam.length + 6); pet._popFoam(1); }
            pet.wet = Math.max(0, pet.wet - dt * 0.6);
            return;
          }
          if (pet.foam.length) pet._popFoam(pet.foam.length);
          pet.wet = 0;
          const o = bump(t, 1.9, 3, 0.3);
          T._fluff = o; T.smile = 1; T.eyeOpen = 0; T.closedCurve = 1; T.blush = 0.6; T.earLift = 0.6; T.wagFreq = 3; T.wagAmp = 20;
          T.h0x = 128; T.h0y = 212; T.h1x = 272; T.h1y = 212; // "tertemiz oldum!" kollar havada
          if (!this.sparkled) {
            this.sparkled = true;
            for (let i = 0; i < 6; i++) pet._spawnL('sparkle', rand(110, 290), rand(60, 380), { vy: -40, s: rand(0.8, 1.3), vr: 120, life: 1.2 });
          }
        },
        end() {
          pet.wet = 0; if (pet.foam.length) pet._popFoam(pet.foam.length);
          pet.stats.cleanliness = pet.soaped ? 100 : Math.min(100, pet.stats.cleanliness + 15);
          pet.soaped = false;
          pet.stats.happiness = Math.min(100, pet.stats.happiness + (pet.species === 'dog' ? 6 : 2));
          pet._emit('stats', pet.getState());
        },
        cancel() { pet.wet = 0; if (pet.foam.length) pet._popFoam(pet.foam.length); }
      };
    },

    // esneme + kollarını gerinme
    yawn() {
      return {
        name: 'yawn', dur: 2.4, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0.12, 0.88, 0.3);
          T.mouthOpen = lerp(T.mouthOpen, 1.1, o); T.tongue = lerp(T.tongue, 0, o);
          T.eyeOpen = lerp(T.eyeOpen, 0, smooth01(o * 1.6)); T.closedCurve = 0.2;
          T.headY = lerp(T.headY, -8, o); T.tilt = lerp(T.tilt, -6, o);
          T.browY = -5 * o; T.brow = lerp(T.brow, 0.4, o); T.earLift = lerp(T.earLift, -0.5, o);
          T.h0x = lerp(T.h0x, 140, o); T.h0y = lerp(T.h0y, 160, o); T.h1x = lerp(T.h1x, 260, o); T.h1y = lerp(T.h1y, 160, o);
          T._squash = -0.3 * o;
          if (p > 0.85) { T.mouthOpen = 0.1 * Math.max(0, Math.sin(p * 60)); T.smile = 0.3; }
        }
      };
    },
    stretch() {
      return {
        name: 'stretch', dur: 2, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0, 1, 0.3);
          T.h0x = lerp(T.h0x, 120, o); T.h0y = lerp(T.h0y, 170, o); T.h1x = lerp(T.h1x, 280, o); T.h1y = lerp(T.h1y, 170, o);
          T._squash = -0.35 * o; T.eyeOpen = lerp(T.eyeOpen, 0, o); T.closedCurve = 1; T.smile = 0.8; T.headY -= 6 * o;
        }
      };
    },
    fallAsleep(pet) {
      return { name: 'sleep', dur: 1.2, start() { pet.sleeping = true; pet._emit('sleep', {}); }, update() {} };
    },
    wake(pet) {
      return {
        name: 'wake', dur: 3, busy: true,
        start() { pet.sleeping = false; pet.lightsOff = false; pet._emit('wake', {}); },
        update(T, dt, p, t) {
          if (t < 0.8) { Object.assign(T, MOOD_POSES.sleeping); T.earLift = lerp(-0.7, 0.4, t / 0.8); return; }
          if (t < 1.4) { // gözünü ovuşturur
            T.sit = 1; T.eyeOpen = 0.2; T.squint = 0.6;
            T.h1x = 234 + Math.cos(t * 16) * 5; T.h1y = 132 + Math.sin(t * 16) * 5; T.h0x = 168; T.h0y = 372;
            return;
          }
          if (t < 2) { T.sit = 1 - smooth01((t - 1.4) / 0.6); T.eyeOpen = 0.5; T.smile = 0.3; return; }
          const o = bump(t, 2, 3, 0.3); // ayağa kalkıp gerinme
          T.sit = 0; T.h0x = lerp(T.h0x, 130, o); T.h0y = lerp(T.h0y, 160, o); T.h1x = lerp(T.h1x, 270, o); T.h1y = lerp(T.h1y, 160, o);
          T.headY = -8 * o; T.mouthOpen = 1.05 * o; T.eyeOpen = lerp(0.6, 0, o); T.closedCurve = 0.2; T._squash = -0.3 * o; T.smile = 0.5;
        }
      };
    },
    stir() {
      return {
        name: 'stir', dur: 1.3, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0, 1, 0.3);
          T.smile = lerp(T.smile, 0.9, o); T.tilt = lerp(T.tilt, 16, o); T.mouthOpen = 0.12 * o * Math.max(0, Math.sin(p * 20));
          T.earLift = lerp(T.earLift, 0, o); T.blush = 0.5 * o;
        }
      };
    },
    // kafasına dokununca: patileri yanaklarında, kıkırdar
    boop(pet) {
      return {
        name: 'boop', dur: 1.1, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0, 1, 0.25);
          T.eyeOpen = lerp(T.eyeOpen, 0, o); T.closedCurve = 1; T.smile = 1; T.mouthOpen = 0.35 * o;
          T.earLift = lerp(T.earLift, 0.6, o); T.blush = 0.9 * o; T._squash = 0.4 * Math.sin(p * Math.PI); T.wagFreq = 3; T.wagAmp = 20;
          const cy = SPECIES[pet.species].cheekY + 6 + T.headY;
          T.h0x = lerp(T.h0x, 152, o); T.h0y = lerp(T.h0y, cy, o); T.h1x = lerp(T.h1x, 248, o); T.h1y = lerp(T.h1y, cy, o);
        }
      };
    },
    // karnına dokununca gıdıklanır
    giggle(pet) {
      return {
        name: 'giggle', dur: 1.2, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2);
          T.eyeOpen = lerp(T.eyeOpen, 0, o); T.closedCurve = 1; T.smile = 1; T.mouthOpen = 0.45 * o * (0.6 + 0.4 * Math.sin(t * 25));
          T._shake = Math.sin(t * 40) * 2 * o; T.blush = 0.6 * o; T.tongue = pet.species === 'dog' ? 0.3 * o : 0;
          T.h0x = lerp(T.h0x, 176, o); T.h0y = lerp(T.h0y, 320, o); T.h1x = lerp(T.h1x, 224, o); T.h1y = lerp(T.h1y, 320, o);
        }
      };
    },
    hop(pet) {
      return {
        name: 'hop', dur: 0.95, silent: true,
        update(T, dt, p) {
          T._hop = p > 0.15 && p < 0.85 ? -Math.sin((p - 0.15) / 0.7 * Math.PI) * 30 : 0;
          T._squash = p < 0.15 ? Math.sin(p / 0.15 * Math.PI) * 0.8 : p > 0.85 ? Math.sin((p - 0.85) / 0.15 * Math.PI) * 0.8 : -0.2;
          T.smile = 1; T.mouthOpen = 0.45; T.tongue = pet.species === 'dog' ? 0.4 : 0;
          T.eyeOpen = 0; T.closedCurve = 1; T.earLift = 0.6; T.wagFreq = 3.5; T.wagAmp = 22;
          T.h0x = 124; T.h0y = 200; T.h1x = 276; T.h1y = 200;
        }
      };
    },
    // el sallama
    wave() {
      return {
        name: 'wave', dur: 1.9, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2);
          T.h1x = lerp(T.h1x, 292 + Math.sin(t * 13) * 16, o); T.h1y = lerp(T.h1y, 190, o);
          T.smile = 1; T.mouthOpen = 0.3 * o; T.tilt = -6 * o; T.earLift += 0.3 * o; T.lookX = 0; T.lookY = 0; T.faceX = 0;
        }
      };
    },
    dance(pet) {
      return {
        name: 'dance', dur: 2.6, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.12), b = Math.sin(t * 8);
          T._rot = b * 5 * o; T.tilt = -b * 8 * o; T.smile = 1; T.mouthOpen = 0.3 * o; T.eyeOpen = 0; T.closedCurve = 1;
          T.h0x = lerp(T.h0x, 130, o); T.h0y = lerp(T.h0y, 230 + b * 30, o); T.h1x = lerp(T.h1x, 270, o); T.h1y = lerp(T.h1y, 230 - b * 30, o);
          T.foot0 = Math.max(0, b) * 0.4 * o; T.foot1 = Math.max(0, -b) * 0.4 * o; T.wagFreq = 3; T.wagAmp = 22;
          if (Math.random() < dt * 2) pet._spawnL('note', rand(120, 280), 60, { vy: -40, life: 1.2 });
        }
      };
    },
    celebrate(pet) {
      return {
        name: 'celebrate', dur: 2.2,
        update(T, dt, p, t) {
          const c = (t % 0.73) / 0.73;
          T._hop = -Math.sin(c * Math.PI) * 34; T._squash = c < 0.1 || c > 0.9 ? 0.6 : -0.2;
          T.smile = 1; T.mouthOpen = 0.55; T.eyeOpen = 0; T.closedCurve = 1; T.blush = 0.7;
          T.earLift = 0.8; T.wagFreq = 4; T.wagAmp = 26; T.tilt = Math.sin(t * 6) * 6;
          T.h0x = 118 + Math.sin(t * 12) * 8; T.h0y = 170; T.h1x = 282 - Math.sin(t * 12) * 8; T.h1y = 170;
          if (Math.random() < dt * 9) pet._spawnL(Math.random() < 0.5 ? 'sparkle' : 'heart', rand(90, 310), rand(40, 200), { vy: -50, vr: 120, s: rand(0.7, 1.2) });
        }
      };
    },
    // karın guruldaması: eliyle karnını tutar
    growl(pet) {
      return {
        name: 'growl', dur: 1.8, silent: true,
        start() { pet._spawnL('growl', 200, 320, { vy: -10, life: 1.2, s: 1.2 }); pet._spawnL('text', 262, 300, { text: 'gurr', vy: -25, life: 1.3, size: 17 }); },
        update(T, dt, p, t) {
          const o = bump(p, 0.05, 0.85, 0.2);
          T._shake = Math.sin(t * 70) * 2 * o; T.lookY = 1; T.lookX = 0; T.brow = 1; T.smile = -0.8; T.headY = 10 * o; T.mouthOpen = 0.1 * o; T.earLift = -0.8;
          patBelly(T, t, o);
        }
      };
    },
    rubEye(pet) {
      return {
        name: 'rubEye', dur: 1.6, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2), e = SPECIES[pet.species].eyes[0];
          T.h0x = lerp(T.h0x, e.cx + Math.cos(t * 15) * 6, o); T.h0y = lerp(T.h0y, e.cy + 10 + T.headY + Math.sin(t * 15) * 5, o);
          T.eyeOpen = lerp(T.eyeOpen, 0, o); T.closedCurve = -0.3; T.mouthOpen = 0.15 * o; T.tilt = 6 * o;
        }
      };
    },
    // sıcaktan eliyle yüzünü yelpazeler
    fan(pet) {
      return {
        name: 'fan', dur: 1.8, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2);
          T.h1x = lerp(T.h1x, 282 + Math.sin(t * 22) * 10, o); T.h1y = lerp(T.h1y, 168 + Math.cos(t * 22) * 8, o);
          T.squint = 0.4 * o;
        }
      };
    },
    // kirliyken kaşınma
    scratch(pet) {
      return {
        name: 'scratch', dur: 1.8, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.2);
          T.tilt += 14 * o; T.headX += 5 * o; T.eyeOpen = lerp(T.eyeOpen, 0.3, o); T.squint = 0.6 * o; T.smile = -0.2; T.brow = 0.5; T.earLift = -0.4;
          T.h0x = lerp(T.h0x, 150 + Math.sin(t * 30) * 7, o); T.h0y = lerp(T.h0y, 92 + T.headY, o);
          T.h1x = lerp(T.h1x, 214 + Math.sin(t * 30 + 1) * 8, o); T.h1y = lerp(T.h1y, 300, o);
        }
      };
    },
    lickLips() {
      return {
        name: 'lickLips', dur: 1.3, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.25);
          T.tongue = 0.55 * o; T.tongueX = Math.sin(t * 10) * o; T.mouthOpen = Math.max(T.mouthOpen * (1 - o), 0.12 * o);
          T.squint = 0.3 * o; T.smile = lerp(T.smile, 0.5, o); T.lookY = lerp(T.lookY, -0.4, o);
        }
      };
    },
    sigh() {
      return {
        name: 'sigh', dur: 2, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0, 1, 0.35);
          T.eyeOpen = lerp(T.eyeOpen, 0.35, o); T.headY += 10 * o; T._squash = -0.2 * o + 0.3 * bump(p, 0.5, 0.9, 0.5);
          T.lookY = 0.8; T.mouthOpen = 0.12 * bump(p, 0.5, 0.9, 0.5);
        }
      };
    },
    headTilt() {
      const dir = Math.random() < 0.5 ? -1 : 1;
      return {
        name: 'headTilt', dur: 1.8, silent: true,
        update(T, dt, p) {
          const o = bump(p, 0, 1, 0.3);
          T.tilt += 14 * dir * o; T.earLift += 0.4 * o; T.pupil = lerp(T.pupil, 1, o);
          T.lookX = -dir * 0.3; T.lookY = -0.2; T.mouthOpen = 0.1 * o; T.browY = -4 * o;
          if (dir > 0) { T.h1x = lerp(T.h1x, 236, o); T.h1y = lerp(T.h1y, 196 + T.headY, o); } // çenesini tutar
          else { T.h0x = lerp(T.h0x, 164, o); T.h0y = lerp(T.h0y, 196 + T.headY, o); }
        }
      };
    },

    // ---- top oyunu
    // tgt: { pos() → [x, y] (dünya), hit() } — top, lazer noktası, baloncuk, kelebek
    // dişleri fırçalandıktan sonra kocaman sırıtır
    grin() {
      return {
        name: 'grin', dur: 2, silent: true,
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.15);
          T.mouthOpen = 0.55 * o; T.teeth = o; T.smile = 1; T.eyeOpen = 0; T.closedCurve = 1; T.blush = 0.6; T.earLift = 0.5;
          T.wagFreq = 3; T.wagAmp = 20; T.h0x = 150; T.h0y = 300 - o * 20; T.h1x = 250; T.h1y = 300 - o * 20;
        }
      };
    },
    // sarılma: kollarını açar, sonra göğsünde kavuşturur
    hug(pet) {
      return {
        name: 'hug', dur: 3.2, silent: true,
        start() { this.h = 0; },
        update(T, dt, p, t) {
          const open = smooth01(p / 0.22), close = smooth01((p - 0.28) / 0.2), out = smooth01((p - 0.88) / 0.12);
          const k = close * (1 - out);
          T.h0x = lerp(lerp(T.h0x, 92, open), 238, k); T.h0y = lerp(lerp(T.h0y, 228, open), 292, k);
          T.h1x = lerp(lerp(T.h1x, 308, open), 162, k); T.h1y = lerp(lerp(T.h1y, 228, open), 292, k);
          T.eyeOpen = 1 - close; T.closedCurve = 1; T.smile = 1; T.blush = 0.9 * close; T.tilt = Math.sin(t * 2.4) * 8 * k; T.headX = Math.sin(t * 2.4) * 4 * k;
          T.earLift = -0.2; T.wagFreq = 2.4; T.wagAmp = 18;
          if (close > 0.5 && t - this.h > 0.5) { this.h = t; pet._spawnL('heart', 200 + rand(-60, 60), 230 + rand(-20, 20) + pet._upY(), { vx: rand(-20, 20), vy: -60, s: rand(0.9, 1.3) }); }
        }
      };
    },
    // eşya uzatır: sıcak su torbası, çikolata, su bardağı
    offer(pet, icon) {
      return {
        name: 'offer', dur: 3.4, silent: true,
        start() { pet.r.itemTreatS.innerHTML = careIcon(icon, pet.C.line); this.h = 0; },
        update(T, dt, p, t) {
          const o = bump(p, 0, 1, 0.12), up = smooth01((p - 0.25) / 0.3);
          T.itemType = 'treat'; T.itemShow = o; T.itemScale = 1.15 + up * 0.35;
          T.h0x = 178; T.h0y = lerp(300, 262, up); T.h1x = 222; T.h1y = lerp(300, 262, up);
          T.smile = 1; T.blush = 0.6 * up; T.eyeOpen = up > 0.5 ? 0 : 1; T.closedCurve = 1; T.headY = -up * 3; T.tilt = up * 6;
          T.wagFreq = 2.6; T.wagAmp = 20; T.earLift = 0.3;
          if (up > 0.5 && t - this.h > 0.7) { this.h = t; pet._spawnL('heart', 200 + rand(-40, 40), 180 + pet._upY(), { vy: -50, s: 0.9 }); }
        }
      };
    },
    // nefes egzersizi: kollar yavaşça kalkar (nefes al) ve iner (nefes ver)
    breathe(pet) {
      return {
        name: 'breathe', dur: 11.5, silent: true,
        start() { this.cue = 0; },
        update(T, dt, p, t) {
          const ph = t < 3.6 ? 0 : clamp((t - 3.6) / 7.9, 0, 1);
          const inh = ph < 0.45 ? smooth01(ph / 0.45) : ph < 0.55 ? 1 : 1 - smooth01((ph - 0.55) / 0.45);
          T.eyeOpen = t < 3.6 ? 1 : 0; T.closedCurve = 1; T.smile = 0.6; T.brow = -0.1;
          T.h0x = lerp(150, 110, inh); T.h0y = lerp(330, 220, inh); T.h1x = lerp(250, 290, inh); T.h1y = lerp(330, 220, inh);
          T.headY = -inh * 6; T.breathAmp = 0.3; T.wagAmp = 3; T.earLift = inh * 0.4; T.mouthOpen = ph > 0.55 && ph < 0.9 ? 0.12 : 0;
          if (this.cue === 0 && t > 3.6) { this.cue = 1; pet.say('Nefes al…', 3.4, { icon: 'wind' }); }
          if (this.cue === 1 && ph > 0.55) { this.cue = 2; pet.say('Nefes ver…', 3.4, { icon: 'wind' }); }
        }
      };
    },
    // hasta: hapşırır
    sneeze(pet) {
      return {
        name: 'sneeze', dur: 1.7, silent: true,
        start() { this.done = false; },
        update(T, dt, p, t) {
          const pre = smooth01(p / 0.55);
          if (p < 0.6) { T.headY = -pre * 8; T.tilt = -pre * 6; T.eyeOpen = 1 - pre * 0.8; T.squint = pre; T.mouthOpen = pre * 0.35; T.brow = -0.4 * pre; T.earLift = pre * 0.4; return; }
          if (!this.done) {
            this.done = true;
            pet.sfx.play('achoo');
            const m = pet._mouthUpper();
            for (let i = 0; i < 7; i++) pet._spawnL('drop', m.x + rand(-14, 14), m.y + pet._upY() - 6, { vx: rand(-110, 110), vy: rand(-60, 60), g: 300, life: 0.6, s: 0.55 });
            pet._spawnL('text', 290, 110 + pet._upY(), { text: 'Hapşu!', vy: -40, life: 1.1, size: 20, color: '#8E5E55' });
          }
          const k = 1 - smooth01((p - 0.6) / 0.4);
          T.headY = 10 * k; T.tilt = 4 * k; T.eyeOpen = 0; T.closedCurve = -0.4; T.squint = 1; T.mouthOpen = 0.5 * k; T.earLift = -0.5;
        }
      };
    },
    // ilaç: termometre ağızda bekler, şurup "öğ" yüzü yaptırır, vitamin çiğnenir
    med(pet, id) {
      const M = MEDS[id] || MEDS.vitamin;
      return {
        name: 'med', dur: id === 'thermo' ? 3.4 : 3.2, busy: true,
        start() { pet.r.itemTreatS.innerHTML = careIcon(id, pet.C.line); this.done = false; pet._emit('med', { id, phase: 'start' }); },
        update(T, dt, p, t) {
          const m = pet._mouthUpper();
          T.itemType = 'treat'; T.lookX = 0;
          const hold = () => { T.h0x = m.x - 22; T.h0y = m.y + 30; T.h1x = m.x + 22; T.h1y = m.y + 30; };
          if (id === 'thermo') {
            if (t < 2.4) { T.itemShow = 1; T.itemScale = 1; hold(); T.mouthOpen = 0.12; T.lookY = 0.9; T.pupil = 0.1; T.brow = 0.4; T.smile = 0.1; T.earLift = -0.2; }
            else { T.itemShow = 0; T.smile = pet.stats.health < 40 ? -0.2 : 0.8; }
            if (!this.done && t > 2.3) {
              this.done = true;
              const hp = pet.stats.health, sick = hp < 40;
              const deg = sick ? (38.4 + (40 - hp) / 40 * 1.4).toFixed(1) : (36.5 + Math.random() * 0.5).toFixed(1);
              pet.say(deg.replace('.', ',') + '°C ' + (sick ? 'Ateşim var, şurup lazım' : 'Ateşim yok!'), 3.2, { icon: sick ? 'thermo' : 'face-happy' });
            }
          } else if (id === 'syrup') {
            if (t < 1.1) { T.itemShow = 1; T.itemScale = 1; hold(); T.mouthOpen = 0.5; T.eyeOpen = 0; T.closedCurve = 1; T.brow = 0.3; }
            else if (t < 2.4) { T.itemShow = 0; T.eyeOpen = 0; T.closedCurve = -0.5; T.squint = 1; T.tongue = 0.9; T.tongueX = Math.sin(t * 14); T.smile = -0.6; T.brow = 0.8; T.faceX = Math.sin(t * 30) * 4; T.earLift = -0.8;
              if (!this.done) { this.done = true; pet._spawnL('text', 290, 110 + pet._upY(), { text: 'Öğ!', vy: -40, life: 1, size: 20, color: '#8E5E55' }); } }
            else { T.smile = 0.8; T.blush = 0.4; }
          } else {
            if (t < 1.6) { T.itemShow = 1; T.itemScale = 1 - smooth01(t / 1.5); hold(); const c = Math.max(0, Math.sin(t * 13)); T.mouthOpen = 0.08 + 0.3 * c; T.eyeOpen = 0; T.closedCurve = 1; T.smile = 1; if (!this.done && t > 0.2) { this.done = true; pet.sfx.play('crunch'); } }
            else { T.itemShow = 0; T.smile = 1; T.earLift = 0.5; T.h0x = 150; T.h0y = 250; T.h1x = 250; T.h1y = 250; }
          }
        },
        end() {
          const s = pet.stats;
          Object.keys(M.fx).forEach((k) => { s[k] = clamp(s[k] + M.fx[k], 0, 100); });
          if (id !== 'thermo') {
            for (let i = 0; i < 4; i++) pet._spawnL('sparkle', rand(140, 260), rand(80, 260), { vy: -40, life: 0.9 });
            pet.say(id === 'syrup' ? (s.health >= 40 ? 'Kendimi daha iyi hissediyorum' : 'Biraz daha iyiyim…') : 'Güç doldu!', 2.6, { icon: id === 'syrup' ? 'heart' : 'bolt' });
          }
          pet._emit('med', { id, phase: 'end', health: Math.round(s.health) });
          pet._emit('stats', pet.getState());
        }
      };
    },
    swat(pet, side, tgt) {
      tgt = tgt || { pos: () => [pet.ball.x, pet.ball.y], hit: () => { const dir = Math.sign(pet.ball.x - pet.petX) || (side ? 1 : -1); pet._hitBall(dir * rand(380, 620), -rand(600, 850)); } };
      return {
        name: 'swat', dur: 0.6, busy: true, silent: true,
        update(T, dt, p, t) {
          const [x, y] = tgt.pos(), u = pet._toUpper(x, y);
          T.smile = 1; T.mouthOpen = 0.4; T.eyeOpen = 0.9; T.pupil = 1; T.wagFreq = 3.5; T.wagAmp = 22; T.earLift = 0.5;
          pet._lookAtWorld(T, x, y);
          if (t < 0.16) {
            T['h' + side + 'x'] = u.x; T['h' + side + 'y'] = u.y;
            pet.P['h' + side + 'x'] = lerp(pet.P['h' + side + 'x'], u.x, 0.5); pet.P['h' + side + 'y'] = lerp(pet.P['h' + side + 'y'], u.y, 0.5);
          } else if (!this.hit) { this.hit = true; tgt.hit(); }
          else { T.eyeOpen = 0; T.closedCurve = 1; }
        }
      };
    },
    header(pet) {
      return {
        name: 'header', dur: 0.7, busy: true, silent: true,
        update(T, dt, p, t) {
          T._hop = -Math.sin(p * Math.PI) * 22; T.headY = -10 * Math.sin(p * Math.PI);
          T.eyeOpen = 0; T.closedCurve = 1; T.smile = 1; T.mouthOpen = 0.3;
          T.h0x = 124; T.h0y = 210; T.h1x = 276; T.h1y = 210;
          if (t > 0.12 && !this.hit) { this.hit = true; pet._hitBall(rand(-260, 260), -rand(800, 980)); }
        }
      };
    },
    kick(pet, side) {
      return {
        name: 'kick', dur: 0.7, busy: true, silent: true,
        update(T, dt, p, t) {
          T['foot' + side] = bump(p, 0, 0.8, 0.3); T._rot = (side ? -1 : 1) * 4 * bump(p, 0, 0.8, 0.3);
          T.smile = 1; T.mouthOpen = 0.3; T.eyeOpen = 0.8;
          T.h0x = 116; T.h0y = 270; T.h1x = 284; T.h1y = 270;
          pet._lookAtWorld(T, pet.ball.x, pet.ball.y);
          if (t > 0.22 && !this.hit) { this.hit = true; const dir = side ? 1 : -1; pet._hitBall(dir * rand(500, 760), -rand(450, 650)); }
        }
      };
    }
  };

  // Cins seçimi için kafa resmi (SVG metni). Sonuçlar önbelleğe alınır.
  const THUMBS = {};
  PetEngine.headThumb = function (breed, eyes) {
    const key = breed + '|' + (eyes || '');
    if (THUMBS[key]) return THUMBS[key];
    if (typeof document === 'undefined' || !BREEDS[breed]) return '';
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;height:420px;';
    document.body.appendChild(div);
    const e = new PetEngine(div, { breed, eyes, tools: false, background: false, sound: false });
    cancelAnimationFrame(e._raf);
    e.blink.t = -1; e.earTwitch.t = -1;
    const rs = e.geo ? e.geo.rest : REST;
    const T = Object.assign({}, POSE_DEFAULT, { h0x: rs[0][0], h0y: rs[0][1], h1x: rs[1][0], h1y: rs[1][1] }, MOOD_POSES.happy, { lookX: 0, lookY: 0, faceX: 0 });
    e._smoothPose(10, T); e._render(0, T);
    const svg = '<svg xmlns="' + SVGNS + '" viewBox="52 20 296 204" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><defs>' +
      e.svg.querySelector('defs').innerHTML + '</defs>' + e.r.head.outerHTML + '</svg>';
    e.destroy(); div.remove();
    THUMBS[key] = svg;
    return svg;
  };
  PetEngine.FOODS = FOODS;
  PetEngine.DEFAULT_SYMPTOMS = DEFAULT_SYMPTOMS;
  PetEngine.REWARDS = REWARDS;
  PetEngine.icon = icon;
  PetEngine.CLOTHES = CLOTHES;
  PetEngine.QUESTS = QUESTS;
  PetEngine.USER_MOODS = USER_MOODS;
  PetEngine.CYCLE = CYCLE;
  PetEngine.MEDS = MEDS;
  PetEngine.ACTIONS = Object.keys(ACTIONS).filter((n) => ['fallAsleep', 'swat', 'kick', 'header', 'med', 'offer'].indexOf(n) < 0);
  PetEngine.BREEDS = BREEDS;
  PetEngine.EYES = EYES;
  PetEngine.MOODS = Object.keys(MOOD_POSES);
  return PetEngine;
});
