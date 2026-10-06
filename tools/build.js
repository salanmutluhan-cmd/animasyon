// Motoru tek dosyalık sayfalara gömer:
//   dist/pet.html  → uygulamadaki WebView için
//   demo.html      → telefonda/tarayıcıda doğrudan açılabilen deneme sayfası
//   integration/react-native/petHtml.js
// Kullanım: node tools/build.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'src/pet-engine.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const inline = (tpl) => fs.readFileSync(path.join(root, tpl), 'utf8').replace('/*__PET_ENGINE__*/', () => engine);

const pet = inline('src/pet.template.html');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/pet.html'), pet);
fs.mkdirSync(path.join(root, 'integration/android/assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'integration/android/assets/pet.html'), pet);
fs.writeFileSync(path.join(root, 'demo.html'), inline('src/demo.template.html'));
fs.mkdirSync(path.join(root, 'integration/expo-elora/pet'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'integration/expo-elora/pet/petHtml.js'),
  '// Otomatik üretildi: node tools/build.js\nexport default ' + JSON.stringify(pet) + ';\n'
);
fs.writeFileSync(
  path.join(root, 'integration/react-native/petHtml.js'),
  '// Otomatik üretildi: node tools/build.js\nexport default ' + JSON.stringify(pet) + ';\n'
);
console.log('dist/pet.html, demo.html, integration/* oluşturuldu (' + (pet.length / 1024).toFixed(1) + ' KB)');
