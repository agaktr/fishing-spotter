import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run from the Symfony directory with the installed agent-browser CLI, after the DDEV build.
// Each run has a separate Chrome session and all application APIs are synthetic.
const name = spawnSync("agent-browser", ["session", "id", "--scope", "worktree", "--prefix", `visual-qa-web-regression-${process.pid}`], { encoding: "utf8" }).stdout.trim();
assert.match(name, /^visual-qa-web-regression-/);
function browser(...args) {
  const command = spawnSync("agent-browser", ["--session", name, "--json", ...args], { encoding: "utf8", timeout: 60000 });
  const response = JSON.parse(command.stdout);
  assert.equal(response.success, true, `${args.join(" ")}: ${command.stderr} ${JSON.stringify(response)}`);
  return response.data;
}
const evaluate = (script) => browser("eval", script).result;
const check = (script, message) => assert.equal(evaluate(`Boolean(${script})`), true, message);
const click = (text) => {
  evaluate(`document.querySelector('[data-web-click]')?.removeAttribute('data-web-click'); [...document.querySelectorAll('button')].find(e => (e.getAttribute('aria-label') ?? e.textContent.trim()) === ${JSON.stringify(text)})?.setAttribute('data-web-click', '')`);
  browser("scrollintoview", "[data-web-click]");
  browser("click", "[data-web-click]");
};
function target(selector, text) {
  evaluate(`document.querySelector('[data-web-target]')?.removeAttribute('data-web-target'); [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}))?.setAttribute('data-web-target', '')`);
  return '[data-web-target]';
}
const summary = (text) => browser("click", target("summary", text));
const fill = (label, value) => browser("find", "label", label, "fill", value);
const wait = (script) => browser("wait", "--fn", script);
const active = `webQA.db.find(t => t.status === 'active')`;
const draft = `JSON.parse(localStorage.getItem('fishing-draft:qa-web-workflow-owner:' + (${active}).id))`;
function open(scenario, extra = "") {
  browser("open", `https://fishing.ddev.site/?web-qa=${scenario}&run=${process.pid}${extra}`);
  wait(`document.querySelector('nav')?.textContent.includes('@web-fishing-qa')`);
}
function diagnostics() {
  check("document.documentElement.scrollWidth === document.documentElement.clientWidth", "No horizontal page overflow");
  check("[...document.querySelectorAll('.workflow-panel')].every(p => p.scrollWidth <= p.clientWidth + 1)", "No panel overflow");
  assert.deepEqual(browser("errors").errors ?? [], []);
  assert.equal((browser("console").messages ?? []).some((message) => message.type === "error"), false, "No browser console errors");
}
try {
  browser("--engine", "chrome", "--ignore-https-errors", "--init-script", fileURLToPath(new URL("./web-workflow.fixture.js", import.meta.url)), "open", "about:blank");
  browser("set", "viewport", "1440", "1200");
  browser("network", "route", "**/api/**", "--body", '{"error":"Blocked outside synthetic web fixture"}');
  open("quick");
  click("Ψάρεμα εδώ");
  browser("wait", '[aria-label="Γρήγορη έναρξη"]');
  check("!document.querySelector('.trip-workspace input')", "Quick start has no dates or catch form");
  browser("select", '.trip-workspace select', "eging");
  evaluate("webQA.startedClick = Date.now()");
  click("Έναρξη ψαρέματος");
  browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  check(`${active}.outcome === 'zero' && ${active}.fishRecords.length === 0 && ${active}.technique === 'eging'`, "Starts with explicit zero and selected technique");
  check(`Math.abs(Date.parse(${active}.tripDate) - webQA.startedClick) < 2000`, "Actual start is the action time");
  check("!webQA.requests.some(r => r.path === '/api/spots')", "Start never waits for reanalysis");
  click("Κλείσιμο ημερολογίου");
  check("document.querySelector('.active-trip-strip')?.textContent.includes('0 ψάρια')", "Map strip shows the saved catch count");
  click("Συνέχεια ενεργής");
  browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  check("!document.querySelector('[aria-label=\"Λεπτομέρειες εξόρμησης\"]')", "Continue goes straight to the editor");
  summary("Σημειώσεις"); fill("Σημειώσεις", "Unrelated web note must remain unsaved");
  summary("Χρόνος ψαρέματος"); fill("Ψάρεμα σε λεπτά", "30"); fill("Πόσοι ψαρεύαμε", "2");
  click("+ Ψάρι"); fill("Είδος", "Λαβράκι"); fill("Πόσα;", "2");
  evaluate("webQA.delayPatch = true");
  click("Προσθήκη ψαριού");
  wait("webQA.requests.some(r => r.method === 'PATCH')");
  check("document.querySelector('.trip-workspace fieldset').disabled", "Mutations disable concurrent form submissions");
  evaluate("webQA.delayPatch = false; webQA.release()");
  wait(`${active}.fishRecords.length === 1 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check("Object.keys(webQA.requests.find(r => r.method === 'PATCH').body).sort().join() === 'expectedFishRevision,fishRecords,outcome'", "Add fish sends a revision-protected catch-only PATCH");
  check(`${active}.notes === '' && ${active}.fishingMinutes === null`, "Does not silently save other fields");
  check(`${draft}.notes.includes('Unrelated web note') && ${draft}.fishingMinutes === '30'`, "Unrelated local edits survive the parent update");
  click("Κλείσιμο ημερολογίου");
  check("document.querySelector('.active-trip-strip').textContent.includes('2 ψάρια')", "Parent and strip update after catch save");
  click("Συνέχεια ενεργής");
  click("+ Ψάρι"); fill("Είδος", "Τσιπούρα");
  evaluate("webQA.failNextPatch = 'after'"); click("Προσθήκη ψαριού");
  wait("document.querySelector('[role=alert]')?.textContent.includes('lost response')");
  check(`${draft}.fish.species === 'Τσιπούρα' && Boolean(${draft}.fish.id)`, "Failed response retains input and stable ID");
  browser("reload"); browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  click("Προσθήκη ψαριού");
  wait("document.querySelector('[role=status]')?.textContent.includes('Το ψάρι αποθηκεύτηκε')");
  check(`${active}.fishRecords.length === 2`, "Retry after reload does not duplicate the catch");
  check(`${draft}.notes.includes('Unrelated web note')`, "Reload and retry preserve unrelated drafts");
  click("Φωτογραφία");
  check("[...document.querySelectorAll('details')].some(d => d.open && d.textContent.includes('Πρόσθεσε εικόνες εξόρμησης'))", "Photo action opens upload workspace");
  evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(e => e.textContent.startsWith('Πρόσθεσε εικόνες εξόρμησης')).querySelector('input'); const files = new DataTransfer(); files.items.add(new File(['synthetic fixture image'], 'qa-web-photo.png', { type: 'image/png' })); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  wait(`${active}.images.length === 1`);
  check(`${draft}.notes.includes('Unrelated web note') && ${draft}.fishingMinutes === '30'`, "Immediate photo upload also preserves unrelated draft fields");
  click("+ Ψάρι"); fill("Είδος", "Pending finish fish");
  click("Τέλος ψαρέματος");
  check(`${active}.status === 'active' && ${draft}.pendingAction === 'complete'`, "Finish waits for explicit pending-input decision");
  browser("reload"); browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  check("document.body.textContent.includes('Προσθήκη / ενημέρωση και συνέχεια')", "Pending completion decision survives reload");
  click("Συνέχεια επεξεργασίας");
  check(`${draft}.fish.species === 'Pending finish fish' && ${active}.status === 'active'`, "Cancel finish keeps form and active status");
  click("Τέλος ψαρέματος"); click("Προσθήκη / ενημέρωση και συνέχεια");
  wait("!webQA.db.some(t => t.status === 'active')");
  check("webQA.db[0].endedAt === null && webQA.db[0].fishRecords.length === 3", "One save completes with pending fish and unknown end");
  check("webQA.db[0].notes.includes('Unrelated web note')", "Explicit finish saves the intended full draft");
  check("webQA.db[0].anglerCount === 2", "Finish saves anglers even without an end");
  check("JSON.parse(localStorage.getItem('fishing-draft:qa-web-workflow-owner:' + webQA.db[0].id)).fishingMinutes === '30'", "Deferred effort survives completion without an invented end");
  diagnostics();
  console.log("PASS quick start, active route, catch PATCH, recovery, pending completion and deferred effort");

  open("active", "&integration=scalars"); click("Συνέχεια ενεργής");
  summary("Χρόνος ψαρέματος"); fill("Πόσοι ψαρεύαμε", "3"); click("Αποθήκευση εξόρμησης");
  wait(`${active}.anglerCount === 3 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check(`${active}.endedAt === null`, "Ordinary save accepts anglers without an end");
  click("+ Ψάρι"); fill("Είδος", "Rebase bass");
  evaluate("webQA.beforePatch = trip => { trip.notes = 'External original note'; trip.anglerCount = 4; }");
  click("Προσθήκη ψαριού");
  wait(`${active}.fishRecords.length === 1 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check(`${draft}.notes === 'External original note' && ${draft}.anglerCount === '4'`, "Catch response rebases untouched scalars");
  summary("Σημειώσεις");
  browser("wait", "--load", "networkidle");
  browser("screenshot", "/tmp/opencode/fishing-web-integration-desktop-rebase.png"); diagnostics();
  evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(e => e.textContent.startsWith('Λήξη (προαιρετικά)')).querySelector('input'); const end = new Date(Date.now() - 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,19); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, end); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  fill("Ψάρεμα σε λεπτά", "45");
  evaluate("webQA.beforePatch = trip => { trip.notes = 'External later note'; }");
  click("Αποθήκευση εξόρμησης");
  wait(`${active}.endedAt && ${active}.fishingMinutes === 45 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check(`${active}.status === 'active' && ${active}.notes === 'External later note'`, "Ordinary save keeps the supplied end and does not overwrite external notes");
  check("!('fishRecords' in webQA.requests.filter(r => r.method === 'PATCH').at(-1).body) && !('notes' in webQA.requests.filter(r => r.method === 'PATCH').at(-1).body)", "Ordinary saves omit unchanged scalars and fish arrays");
  click("Τέλος ψαρέματος"); wait("!webQA.db.some(t => t.status === 'active')");
  check("webQA.db[0].notes === 'External later note' && webQA.db[0].endedAt && webQA.db[0].anglerCount === 4", "Finish preserves remote notes, anglers and the already-saved end");
  check("!('fishRecords' in webQA.requests.filter(r => r.method === 'PATCH').at(-1).body)", "Finish does not resubmit unchanged catches or media");

  open("active", "&integration=stale&catch=1"); click("Συνέχεια ενεργής");
  click("Αφαίρεση");
  evaluate(`sessionStorage.setItem('qa-web-original-revision', ${draft}.fishRevisionBase)`);
  summary("Αποτέλεσμα"); browser("select", `${target('label', 'Πιάσαμε τίποτα;')} select`, "zero");
  evaluate("webQA.beforePatch = trip => { trip.fishRecords.push({ id: 'external-catch', species: 'External bream', count: 1, released: false, images: [] }); }");
  click("Τέλος ψαρέματος");
  wait("document.querySelector('[role=alert]')?.textContent.includes('Οι αλλαγές σου διατηρήθηκαν')");
  check(`${active}.fishRecords.length === 2 && ${active}.fishRecords[0].images.length === 1`, "A stale full-array finish is rejected before catches or photos are removed");
  check(`${draft}.fishRecords.length === 0 && ${draft}.fishRevisionBase === sessionStorage.getItem('qa-web-original-revision')`, "Rejected finish retains the pending deletion and original revision");
  browser("reload"); browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  click("Τέλος ψαρέματος");
  wait("document.querySelector('[role=alert]')?.textContent.includes('Οι αλλαγές σου διατηρήθηκαν')");
  check("webQA.requests.filter(r => r.method === 'PATCH').at(-1).body.expectedFishRevision === sessionStorage.getItem('qa-web-original-revision')", "Reload cannot attach the fetched latest revision to stale draft records");
  browser("set", "viewport", "390", "844");
  browser("eval", "document.querySelector('.trip-journal').scrollTop = 0");
  browser("screenshot", "/tmp/opencode/fishing-web-integration-mobile-conflict.png"); diagnostics();
  browser("set", "viewport", "1440", "1200");

  open("active", "&integration=catch-race"); click("Συνέχεια ενεργής");
  click("+ Ψάρι"); fill("Είδος", "Pending race catch");
  evaluate("webQA.beforePatch = trip => { trip.outcome = 'recorded'; trip.fishRecords.push({ id: 'race-catch', species: 'Remote catch', count: 1, released: false, images: [] }); }");
  click("Προσθήκη ψαριού");
  wait("document.querySelector('[role=alert]')?.textContent.includes('Οι αλλαγές σου διατηρήθηκαν')");
  check(`${draft}.fish.species === 'Pending race catch' && ${active}.fishRecords.length === 1`, "A GET/PATCH race preserves the pending fish");
  click("Προσθήκη ψαριού");
  wait(`${active}.fishRecords.length === 2 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check(`${draft}.fishRecords.length === 2`, "Catch retry merges the fresh array and its matching revision");
  open("active", "&integration=old-production&legacy=1"); click("Συνέχεια ενεργής");
  click("+ Ψάρι"); fill("Είδος", "Legacy server catch"); click("Προσθήκη ψαριού");
  wait(`${active}.fishRecords.length === 1 && !document.querySelector('.trip-workspace fieldset').disabled`);
  check("!('expectedFishRevision' in webQA.requests.filter(r => r.method === 'PATCH').at(-1).body)", "Production DTOs without revisions keep the legacy PATCH contract");
  console.log("PASS scalar rebase, active end save, anglers without end, protected full finish, catch race retry and legacy DTO compatibility");

  open("history");
  check("document.querySelectorAll('.trip-history-card').length === 4", "History cards render independently");
  check("!document.querySelector('.trip-journal details').open", "History filters start collapsed");
  check("![...document.querySelectorAll('.trip-history-card')].some(c => /Διαγραφή|Κοινοποίηση|Επεξεργασία/.test(c.textContent))", "Cards show primary actions, not destructive/share controls");
  summary("Φίλτρα ιστορικού"); browser("select", `${target('label', 'Τεχνική')} select`, "eging");
  check("document.querySelectorAll('.trip-history-card').length === 1 && document.querySelector('.trip-history-card').textContent.includes('Σκουτάρι')", "History filters work");
  click("Καθαρισμός"); summary("Φίλτρα ιστορικού");
  browser("wait", "--load", "networkidle");
  browser("screenshot", "/tmp/opencode/fishing-web-redesign-desktop-history.png");
  diagnostics();
  browser("click", target('.trip-history-card:first-of-type button', "Τοποθεσία στον χάρτη"));
  check("!document.querySelector('.trip-journal')", "Location action returns to the map");
  browser("wait", '.trip-photo-pin[data-ready="true"]');
  check("document.querySelector('.trip-photo-pin').dataset.cards === '3'", "Individual three-photo fan is preserved");
  click("Εργαλεία");
  check("document.querySelector('#map-tools-popover').textContent.includes('Μέτρηση απόστασης')", "Layers and measure share one popover");
  click("Μέτρηση απόστασης");
  check("document.querySelector('.measure-tools') && !document.querySelector('#map-tools-popover')", "Measure starts and closes tools");
  check("document.querySelector('.maplibregl-ctrl-scale').getBoundingClientRect().top > 0", "Scale remains visible");
  click("Έξοδος μέτρησης");
  console.log("PASS compact history, filters, map location, photo fans and unified tools");

  browser("set", "viewport", "390", "844");
  open("active"); click("Συνέχεια ενεργής");
  browser("wait", '[aria-label="Ενεργή εξόρμηση"]');
  browser("wait", "--load", "networkidle");
  browser("screenshot", "/tmp/opencode/fishing-web-redesign-mobile-active.png");
  diagnostics();
  click("+ Ψάρι"); fill("Είδος", "Keep this fish");
  evaluate("webQA.failNextPatch = 'before'"); click("Προσθήκη ψαριού");
  wait("document.querySelector('[role=alert]')?.textContent.includes('network failure')");
  check(`${draft}.fish.species === 'Keep this fish' && ${active}.fishRecords.length === 0`, "Network failure keeps pending catch");
  click("Τέλος ψαρέματος"); click("Απόρριψη και συνέχεια");
  wait("!webQA.db.some(t => t.status === 'active')");
  check("webQA.db[0].outcome === 'zero' && webQA.db[0].endedAt === null", "Explicit pending discard finishes zero without requiring an end");
  open("history"); browser("wait", "--load", "networkidle"); browser("screenshot", "/tmp/opencode/fishing-web-redesign-mobile-history.png"); diagnostics();
  browser("click", target('.trip-history-card:last-of-type button', "Άνοιγμα"));
  check("!document.querySelector('.trip-workspace') && !document.body.textContent.includes('Διαγραφή εξόρμησης')", "Other owners stay read-only");
  open("quick", "&historical=1"); click("Ψάρεμα εδώ"); click("Προσθήκη παλιότερης εξόρμησης");
  // Chrome's segmented datetime input is not supported by the CLI's text fill.
  evaluate(`(() => { const input = document.querySelector('input[type="datetime-local"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-08-30T08:00:00'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  click("Αποθήκευση ολοκληρωμένης εξόρμησης");
  wait("webQA.db.length === 5");
  check("webQA.db[0].recordingMode === 'historical' && webQA.db[0].endedAt === null && Object.keys(webQA.db[0].weather).length === 0", "Historical entry does not invent end or current conditions");
  console.log("PASS mobile recovery, explicit discard, read-only permissions and historical entry");

  for (const mode of ["current", "historical", "forecast"]) {
    open("search", `&snapshot=${mode}`);
    click("Αναζήτηση");
    if (mode === "forecast") evaluate(`(() => { const input = document.querySelector('.search-panel input[type="datetime-local"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, new Date(Date.now() + 7200000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16)); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    click("Αναζήτηση"); browser("wait", ".results-panel");
    if (mode === "current") {
      click("Πλήρης ανάλυση");
      check("document.querySelectorAll('.conditions-highlights dt').length === 6", "Analysis reuses six conditions highlights");
      check("[...document.querySelectorAll('.map-analysis details')].filter(d => d.querySelector('summary').textContent.includes('Πηγές δεδομένων')).length === 1", "Analysis has one complete sources disclosure");
      browser("wait", "--load", "networkidle");
      browser("screenshot", "/tmp/opencode/fishing-web-redesign-mobile-analysis.png");
      click("Νέα εξόρμηση εδώ");
    } else click("Ψάρεμα εδώ");
    if (mode === "historical") {
      click("Προσθήκη παλιότερης εξόρμησης");
      check("!document.querySelector('.trip-conditions').textContent.includes('12,4')", "Historical form does not show today's weather as trip conditions");
      evaluate(`(() => { const input = document.querySelector('.trip-workspace input[type="datetime-local"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-08-30T08:00:00'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      click("Αποθήκευση ολοκληρωμένης εξόρμησης");
    } else click("Έναρξη ψαρέματος");
    wait("webQA.requests.some(r => r.method === 'POST' && r.path === '/api/trips')");
    check(`Boolean(webQA.requests.find(r => r.method === 'POST' && r.path === '/api/trips').body.weather) === ${mode === "current"}`, "Only aligned current result snapshots enter live creation");
    check("webQA.requests.filter(r => r.path === '/api/spots').length === 1", "Trip creation never adds a blocking reanalysis");
  }
  console.log("PASS result quick start, shared analysis and current/historical/forecast snapshot guards");
  console.log(`Browser flows passed in ${name}; all application API writes were intercepted.`);
} finally {
  browser("close");
}
