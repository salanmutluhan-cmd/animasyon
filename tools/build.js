// Motoru tek dosyalık WebView sayfasına gömer: dist/pet.html
// Kullanım: node tools/build.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'src/pet-engine.js'), 'utf8');
const tpl = fs.readFileSync(path.join(root, 'src/pet.template.html'), 'utf8');

const out = tpl.replace('/*__PET_ENGINE__*/', () => engine.replace(/<\/script/gi, '<\\/script'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/pet.html'), out);

// React Native için HTML'i string olarak dışa aktaran modül
fs.writeFileSync(
  path.join(root, 'integration/react-native/petHtml.js'),
  '// Otomatik üretildi: node tools/build.js\nexport default ' + JSON.stringify(out) + ';\n'
);
console.log('dist/pet.html ve integration/react-native/petHtml.js oluşturuldu (' + (out.length / 1024).toFixed(1) + ' KB)');
