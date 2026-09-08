import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../../components/TripConditions.tsx', import.meta.url), 'utf8');
const context = { exports: {}, require: id => {
  if (id === 'react/jsx-runtime') return jsx;
  if (id === '@/lib/client/drafts') return { displayDate: value => value ?? 'unknown' };
  throw new Error(id);
} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
const render = props => renderToStaticMarkup(jsx.jsx(context.exports.TripConditions, props));

test('numeric cards preserve zero, negatives, units and collapsed metadata', () => {
  const html = render({ weather: { airTemperatureC: 24.6, windDirectionDeg: 0, precipitationMm: 0 }, marine: { seaLevelMslM: -0.12 } });
  assert.match(html, /24,6/);
  assert.match(html, /-0,12/);
  assert.match(html, />0 <span[^>]*>°/);
  assert.match(html, />0 <span[^>]*>mm/);
  assert.equal((html.match(/<dt[ >]/g) ?? []).length, 20);
  assert.equal((html.match(/<svg /g) ?? []).length, 20);
  assert.match(html, /Πηγές δεδομένων/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test('missing, non-finite and unaligned source values never become measurements', () => {
  const html = render({ weather: { airTemperatureC: 999, sourceSnapshot: { airTemperatureC: 777 } }, marine: { waveHeightM: NaN, currentSpeedKmh: Infinity } });
  assert.equal((html.match(/Μη διαθέσιμο<\/dd>/g) ?? []).length, 20);
  assert.doesNotMatch(html, /999|777|NaN|Infinity/);
});

test('pending snapshot is explicitly distinguished from stored trip conditions', () => {
  assert.match(render({ pending: true, weather: { airTemperatureC: 18 } }), /Στιγμιότυπο επιλεγμένου σημείου/);
  assert.match(render({}), /Αποθηκευμένο στιγμιότυπο εξόρμησης/);
});

test('optional pressure trend is shown only when meaningful and aligned', () => {
  for (const pressureTrend of [undefined, 'unknown']) assert.doesNotMatch(render({ weather: { pressureTrend } }), /Τάση:/);
  assert.match(render({ weather: { pressureTrend: 'rising' } }), /Τάση: ανοδική/);
  assert.doesNotMatch(render({ weather: { pressureTrend: 'rising', sourceSnapshot: {} } }), /Τάση:/);
  assert.match(render({}), /MSL: μέση στάθμη θάλασσας/);
});

test('six fishing highlights precede the collapsed complete conditions and sources', () => {
  const html = render({ weather: { windDirectionDeg: 315, gustKmh: 20 }, marine: { wavePeriodS: 5, seaSurfaceTemperatureC: 23 } });
  const aboveFold = html.split('<details')[0];
  assert.equal((aboveFold.match(/<dt[ >]/g) ?? []).length, 6);
  for (const title of ['Άνεμος', 'Ριπές', 'Ύψος κύματος', 'Κύμα · περίοδος', 'Θερμ. νερού', 'ΒΔ']) assert.ok(aboveFold.includes(title));
  assert.ok(!aboveFold.includes('Υγρασία') && !aboveFold.includes('Στάθμη'));
  assert.ok(html.includes('Όλες οι συνθήκες') && html.includes('Πηγές δεδομένων'));
});
