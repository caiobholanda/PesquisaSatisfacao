const fs = require('fs');
let str = fs.readFileSync('public/js/admin.js', 'utf8');
const needle = 'const words = m.nome.trim().split(/s+/);';
const idx = str.indexOf(needle);
if (idx === -1) { console.log('NOT FOUND'); process.exit(1); }
// Build replacement with actual backslash
const backslash = String.fromCharCode(92);
const replacement = 'const words = m.nome.trim().split(/' + backslash + 's+/);';
console.log('Replacement:', JSON.stringify(replacement));
const result = str.slice(0, idx) + replacement + str.slice(idx + needle.length);
fs.writeFileSync('public/js/admin.js', result, 'utf8');
console.log('Done:', JSON.stringify(result.slice(idx, idx + 55)));
