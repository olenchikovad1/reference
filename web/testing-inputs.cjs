// Отпечаток фактически установленных зависимостей. Ни registry-конфигурация,
// ни пользовательские пути, ни секреты в публичный результат не включаются.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = crypto.createHash('sha256');
const base = path.join(__dirname, 'node_modules');
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (['.vite', '.cache', '.bin'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) { digest.update(path.relative(base, file).split(path.sep).join('/') + '\0'); digest.update(fs.readFileSync(file)); }
    else throw new Error('Unknown dependency input type');
  }
}
walk(base);
const sourceFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile()) sourceFiles.push(path.relative(__dirname, file).split(path.sep).join('/'));
    else throw new Error('Unknown source input type');
  }
}
collect(path.join(__dirname, 'src')); collect(path.join(__dirname, 'public'));
sourceFiles.push('package.json','tsconfig.json','vite.config.ts','index.html','testing-inputs.cjs','.npmrc');
const source = crypto.createHash('sha256').update(JSON.stringify({ source: 'web-code-v1' }));
for (const file of [...new Set(sourceFiles)].sort()) { source.update('web/' + file + '\0'); source.update(fs.readFileSync(path.join(__dirname, file))); }
const result = { node: process.version, platform: process.platform, arch: process.arch, dependencies: digest.digest('hex'),
  toolchain: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
  system: crypto.createHash('sha256').update(fs.readFileSync('/lib/apk/db/installed')).digest('hex'),
  source: source.digest('hex'), configuration: { VITE_WITHOUT_PLATFORM: process.env.VITE_WITHOUT_PLATFORM || 'false', VITE_PLATFORM_URL: process.env.VITE_PLATFORM_URL || 'https://platform.toribrands.ru' } };
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result));
else console.log(JSON.stringify(result));
