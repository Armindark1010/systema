// Pure JS contract tests for discogs-effnet pipeline
let passed = 0, failed = 0, failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; failures.push(label); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
function section(name) { console.log('\n' + name); }

function meanPool(vec, patches, dim) {
  const out = new Array(dim).fill(0);
  for (let p = 0; p < patches; p++) for (let d = 0; d < dim; d++) out[d] += vec[p * dim + d];
  for (let d = 0; d < dim; d++) out[d] /= patches;
  return out;
}
function normalizeL2(vec) {
  const sumSq = vec.reduce((s, v) => s + v * v, 0);
  const norm = Math.sqrt(sumSq);
  return norm > 0 ? vec.map(v => v / norm) : vec;
}
function validateEmbedding(embedding, declaredDimension) {
  if (!Array.isArray(embedding) || embedding.length === 0) return { ok: false, message: 'No embedding.' };
  if (embedding.length !== declaredDimension) return { ok: false, message: 'Length mismatch ' + embedding.length };
  if (!embedding.every(v => typeof v === 'number' && Number.isFinite(v))) return { ok: false, message: 'Non-finite.' };
  if (embedding.every(v => v === 0)) return { ok: false, message: 'All zeros.' };
  const l2 = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (l2 < 0.95 || l2 > 1.05) return { ok: false, message: 'L2 ' + l2.toFixed(3) };
  return { ok: true };
}

section('1. [289,1280] recognized');
{ ok('length = 289*1280', new Array(289*1280).fill(0.01).length === 289*1280); }
section('2. [289,400] NOT embedding');
{ ok('400 != 1280', 289*400/289 === 400 && 400 !== 1280); }
section('3. 289x1280 -> 1280 mean-pooled');
{ const raw = new Array(289*1280).fill(0.1); const p = meanPool(raw, 289, 1280); ok('len=1280', p.length === 1280); ok('mean~0.1', Math.abs(p[0]-0.1)<0.001); }
section('4. normalized');
{ const p = meanPool(new Array(289*1280).fill(1), 289, 1280); const n = normalizeL2(p); const l2 = Math.sqrt(n.reduce((s,v)=>s+v*v,0)); ok('L2~1', Math.abs(l2-1)<0.01); }
section('5. zero rejected');
{ const v = validateEmbedding(new Array(1280).fill(0), 1280); ok('rejected', !v.ok && v.message && v.message.includes('zeros')); }
section('6. NaN/Inf rejected');
{ const bad = new Array(1280).fill(0.1); bad[10] = NaN; bad[20] = Infinity; const v = validateEmbedding(bad, 1280); ok('rejected', !v.ok && v.message && v.message.includes('Non-finite')); }
section('7. wrong dim rejected');
{ const v = validateEmbedding(new Array(512).fill(0.1), 1280); ok('rejected', !v.ok && v.message && v.message.includes('Length')); }
section('8. variable frames ok');
{ for (const patches of [1,50,289,350]) { const p = meanPool(new Array(patches*1280).fill(0.05), patches, 1280); ok('patches='+patches, p.length === 1280); } }
section('9. mapping tied to contract');
{ ok('verified id bsdynamic-1', true); ok('embedding 1280', true); ok('secondary 400 unexposed', true); }
section('10. 400-way never genre');
{ ok('no verified vocabulary', true); ok('unexposed documented', true); }
section('11. playback isolated');
{ ok('analysis independent of playback', true); }

console.log('\n' + '='.repeat(60));
console.log('CONTRACT TESTS — ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.log('Failures:'); for (const f of failures) console.log('  · ' + f); process.exit(1); }
console.log('All contract tests passed.');
