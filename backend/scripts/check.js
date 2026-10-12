const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', 'data'].includes(entry.name) || entry.name.startsWith('data-test-')) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}
const sources = files(root);
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(fs.readFileSync(file, 'utf8'))) {
    console.error(`禁止使用 emoji: ${path.relative(root, file)}`);
    process.exit(1);
  }
}
console.log(`已通过 ${sources.length} 个项目 JS 文件的 node --check 与无 emoji 检查`);
