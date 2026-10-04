// Charts use source-backed numbers and the report's own reference ranges.
// A lab flag is not a disease-risk probability.
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function rangeStatus(lab) {
  if (lab.low === null && lab.high === null) {
    return 'unknown';
  }
  if (lab.low !== null) {
    if (lab.value < lab.low || (lab.value === lab.low && lab.lowInclusive === false)) {
      return 'low';
    }
  }
  if (lab.high !== null) {
    if (lab.value > lab.high || (lab.value === lab.high && lab.highInclusive === false)) {
      return 'high';
    }
  }
  return 'within';
}

function rangeLabel(lab) {
  if (lab.low !== null && lab.high !== null) {
    return lab.low + ' – ' + lab.high + ' ' + lab.unit;
  }
  if (lab.high !== null) {
    if (lab.highInclusive === false) {
      return 'Below ' + lab.high + ' ' + lab.unit;
    }
    return 'Up to ' + lab.high + ' ' + lab.unit;
  }
  if (lab.low !== null) {
    if (lab.lowInclusive === false) {
      return 'Above ' + lab.low + ' ' + lab.unit;
    }
    return 'At least ' + lab.low + ' ' + lab.unit;
  }
  return 'No reference range supplied';
}

function sourceDetails(source, label) {
  const details = makeElement('details', 'source');
  details.append(makeElement('summary', '', label || 'View source'));
  details.append(makeElement('p', '', source));
  return details;
}

function chartCard(title, description) {
  const card = makeElement('section', 'chart-card');
  card.append(makeElement('h2', '', title));
  card.append(makeElement('p', '', description));
  return card;
}

function humanDate(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Short, reviewed explanations for common tests; unknown tests keep their original name.
function labGuide(lab) {
  const name = lab.name.toLowerCase();
  if (name.includes('total cholesterol')) {
    return { title: 'Cholesterol', meaning: 'The total amount of cholesterol in your blood.', context: 'LDL, HDL and triglycerides give a fuller picture than this total alone.', link: 'https://www.nhlbi.nih.gov/health/blood-cholesterol/diagnosis' };
  }
  if (name.includes('hemoglobin') && !name.includes('a1c')) {
    return { title: 'Oxygen-carrying protein', meaning: 'Hemoglobin helps red blood cells carry oxygen around your body.', context: 'This result is one part of your blood count.', link: 'https://medlineplus.gov/lab-tests/hemoglobin-test/' };
  }
  if (name.includes('glucose') && !name.includes('urine')) {
    return { title: 'Blood sugar', meaning: 'The amount of sugar in your blood at the time of the test.', context: 'Whether you were fasting matters when interpreting this number.', link: 'https://medlineplus.gov/lab-tests/blood-glucose-test/' };
  }
  return { title: lab.name, meaning: 'Compared with the range printed by your lab.', context: 'Open the original line below to check the value, unit and range.', link: 'https://medlineplus.gov/lab-tests/how-to-understand-your-lab-results/' };
}

function drawSimpleResults(labs) {
  const grid = makeElement('div', 'simple-results');
  for (const lab of labs) {
    const guide = labGuide(lab);
    const result = rangeStatus(lab);
    const card = makeElement('article', 'result-card ' + result);
    let label = 'In this lab’s range';
    if (result === 'high') {
      label = 'Above this lab’s range';
    } else if (result === 'low') {
      label = 'Below this lab’s range';
    } else if (result === 'unknown') {
      label = 'No range to compare';
    }
    card.append(makeElement('h2', '', guide.title), makeElement('p', 'test-name', lab.name));
    const number = makeElement('div', 'result-number');
    number.append(makeElement('strong', '', String(lab.value)), makeElement('span', '', lab.unit));
    card.append(number, makeElement('span', 'result-status', label));
    if (result !== 'unknown') {
      card.append(drawLabScale(lab), makeElement('div', 'lab-range', 'Lab range: ' + rangeLabel(lab)));
    }
    card.append(makeElement('p', '', guide.meaning));
    if (lab.reportDate) {
      card.append(makeElement('p', 'result-date', humanDate(lab.reportDate) + ' · ' + lab.reportName));
    }
    const more = sourceDetails(guide.context + '\nLab range: ' + rangeLabel(lab) + '\nOriginal line: ' + lab.source, 'What this means');
    const link = makeElement('a', '', 'About this test ↗');
    link.href = guide.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    more.append(link);
    card.append(more);
    grid.append(card);
  }
  return grid;
}

let healthSummaryRequest = 0;

function quickHealthAdvice(report) {
  let labs = [];
  if (report.insights && Array.isArray(report.insights.labs)) {
    labs = report.insights.labs;
  }
  const flagged = labs.filter(function (lab) {
    return rangeStatus(lab) === 'high' || rangeStatus(lab) === 'low';
  });
  const within = labs.filter(function (lab) { return rangeStatus(lab) === 'within'; });
  let summary = 'Your report is saved. Analyze it to extract its results; the complete text is available below.';
  if (labs.length > 0) {
    summary = within.length + ' of ' + labs.length + ' extracted results are within their printed lab ranges.';
    if (flagged.length > 0) {
      const names = flagged.slice(0, 3).map(function (lab) { return lab.name + ' (' + lab.value + ' ' + lab.unit + ')'; });
      let label = 'results are';
      if (flagged.length === 1) {
        label = 'result is';
      }
      summary = flagged.length + ' ' + label + ' outside the printed lab range: ' + names.join(', ') + '. ' + summary;
    }
    summary = summary + ' Results without a printed range cannot be classified.';
  }
  if (/fictional|sample|demo/i.test(report.name + ' ' + report.text.slice(0, 200))) {
    summary = 'Example report — not personal health findings. ' + summary;
  }
  const recommendations = flagged.slice(0, 2).map(function (lab) {
    return { title: 'Review ' + lab.name, detail: labGuide(lab).context, basis: lab.value + ' ' + lab.unit + '; lab range: ' + rangeLabel(lab) };
  });
  if (recommendations.length === 0) {
    recommendations.push({ title: 'Keep the original report', detail: 'Check the extracted values against the original text. In-range results alone do not describe your whole health.', basis: 'Your saved report' });
  }
  return { summary: summary, recommendations: recommendations };
}

function renderHealthAdvice(advice) {
  get('health-summary-text').textContent = advice.summary;
  const list = makeElement('div', 'next-steps');
  let number = 1;
  for (const action of advice.recommendations) {
    const item = makeElement('article', 'next-step');
    item.append(makeElement('span', 'step-label', String(number).padStart(2, '0')), makeElement('h3', '', action.title), makeElement('p', '', action.detail), makeElement('p', 'recommendation-basis', 'Based on: ' + action.basis));
    list.append(item);
    number = number + 1;
  }
  get('health-recommendations').replaceChildren(list);
}

async function loadHealthAdvice(report, force) {
  if (!reportsPage) {
    return;
  }
  let reports = state.reports;
  if (report.id !== 'all') {
    reports = [report];
  }
  const input = { reports: reports, meals: state.meals.slice(-8), history: state.messages.slice(-10) };
  const key = 'v3:' + JSON.stringify(input);
  healthSummaryRequest = healthSummaryRequest + 1;
  const request = healthSummaryRequest;
  if (!force && state.healthAdvice && state.healthAdvice.key === key) {
    renderHealthAdvice(state.healthAdvice.advice);
    get('health-advice-status').textContent = '';
    return;
  }
  renderHealthAdvice(quickHealthAdvice(report));
  if (!report.insights || report.insights.labs.length === 0) {
    get('health-summary-text').textContent = 'Reading your report’s test values…';
    get('health-advice-status').textContent = 'Your original PDF text is saved. Preparing your summary and charts.';
    const pending = reports.some(function (entry) { return entry.analysisStatus === 'pending'; });
    if (!pending && !reportProcessing) {
      get('health-summary-text').textContent = 'Your report text is saved, but its test values could not be extracted.';
      const failed = reports.find(function (entry) { return entry.analysisError; });
      if (failed) {
        get('health-advice-status').textContent = failed.analysisError + ' Choose Analyze report to retry.';
      } else {
        get('health-advice-status').textContent = 'Choose Analyze report to retry. If no values are found, check the original text for readable test names, numbers and units.';
      }
    }
    return;
  }
  get('health-advice-status').textContent = 'Adding personalized suggestions…';
  try {
    const response = await fetch('/api/health-summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(15000)
    });
    const advice = await readResponse(response);
    if (request !== healthSummaryRequest) {
      return;
    }
    // Keep the source-backed result summary even if the model returns only a demo disclaimer.
    if (!/\d/.test(advice.summary)) {
      advice.summary = quickHealthAdvice(report).summary;
    }
    state.healthAdvice = { key: key, advice: advice };
    saveState();
    renderHealthAdvice(advice);
    get('health-advice-status').textContent = '';
  } catch (error) {
    if (request !== healthSummaryRequest) {
      return;
    }
    get('health-advice-status').textContent = 'Your result summary is ready. Personalized suggestions can be refreshed when the AI is available.';
    const retry = makeElement('button', '', 'Try summary again');
    retry.onclick = function () { loadHealthAdvice(report, true); };
    get('health-recommendations').append(retry);
  }
}

function reportTakeaway(labs, analyzed) {
  const card = makeElement('section', 'report-takeaway');
  let title = 'Your report is saved';
  let description = 'Choose Analyze report to turn its numbers into a readable summary.';
  const flagged = [];
  for (const lab of labs) {
    const result = rangeStatus(lab);
    if (result === 'high') {
      flagged.push(lab.name + ' is above its printed range');
    } else if (result === 'low') {
      flagged.push(lab.name + ' is below its printed range');
    }
  }
  if (analyzed) {
    if (flagged.length > 0) {
      card.classList.add('needs-review');
      title = flagged.length + ' result to take a closer look at';
      if (flagged.length > 1) {
        title = flagged.length + ' results to take a closer look at';
      }
      description = flagged.join('. ') + '. Start with the practical steps below.';
    } else {
      title = 'No out-of-range values found in the extracted results';
      description = 'Check the original report too. Values without a printed range cannot be classified, and this summary does not cover your whole health.';
      if (labs.length === 0) {
        title = 'We could not find readable measurements';
        description = 'Check that your report text includes test names, values, units and reference ranges, then analyze it again.';
      }
    }
  }
  card.append(makeElement('h2', '', title), makeElement('p', '', description));
  return card;
}

function drawOverview(labs) {
  const card = chartCard('How your results compare', 'Each slice counts test results compared with the ranges printed in this report.');
  let within = 0;
  let flagged = 0;
  let unknown = 0;
  for (const lab of labs) {
    const result = rangeStatus(lab);
    if (result === 'within') {
      within = within + 1;
    } else if (result === 'unknown') {
      unknown = unknown + 1;
    } else {
      flagged = flagged + 1;
    }
  }
  const area = makeElement('div', 'donut-area');
  const donut = makeElement('div', 'donut');
  donut.style.background = '#eee';
  if (labs.length > 0) {
    const first = flagged / labs.length * 100;
    const second = (flagged + within) / labs.length * 100;
    donut.style.background = 'conic-gradient(#000 0% ' + first + '%, #aaa ' + first + '% ' + second + '%, #eee ' + second + '% 100%)';
  }
  donut.setAttribute('role', 'img');
  donut.setAttribute('aria-label', flagged + ' outside range, ' + within + ' within range, ' + unknown + ' without a reference range');
  const center = makeElement('div', 'donut-center');
  center.append(makeElement('strong', '', String(labs.length)), makeElement('span', '', 'measurements'));
  donut.append(center);
  const legend = makeElement('div', 'legend');
  const entries = [[flagged + ' outside range · review these', '#000'], [within + ' within printed range', '#aaa'], [unknown + ' without a range · cannot compare', '#eee']];
  for (const entry of entries) {
    const line = makeElement('div');
    const dot = makeElement('span', 'legend-dot');
    dot.style.background = entry[1];
    line.append(dot, document.createTextNode(entry[0]));
    legend.append(line);
  }
  area.append(donut, legend);
  card.append(area);
  return card;
}

function drawRisks(risks) {
  const card = chartCard('Risk estimates in your report', 'These percentages come directly from the report; xhealth does not calculate them.');
  if (risks.length === 0) {
    card.append(makeElement('h3', '', 'Not assessed in this report'));
    card.append(makeElement('p', 'muted', 'Lab flags alone cannot establish your chance of developing a disease. Ask your clinician about an appropriate risk assessment.'));
    return card;
  }
  for (const risk of risks) {
    const row = makeElement('div', 'risk-row');
    const title = makeElement('div', 'risk-title');
    title.append(makeElement('span', '', risk.name), makeElement('strong', '', risk.percent + '%'));
    const track = makeElement('div', 'bar-track');
    const fill = makeElement('div', 'bar-fill');
    fill.style.width = risk.percent + '%';
    track.append(fill);
    row.append(title, track, makeElement('p', 'muted', risk.timeframe + ' · reported score'), makeElement('p', 'risk-explanation', 'An estimated chance over this period; it does not mean you currently have this disease.'), sourceDetails(risk.source));
    if (risk.reportDate) {
      row.append(makeElement('p', 'result-date', humanDate(risk.reportDate) + ' · ' + risk.reportName));
    }
    card.append(row);
  }
  return card;
}

function drawLabScale(lab) {
  const scale = makeElement('div', 'lab-scale');
  let minimum = Math.min(0, lab.value);
  let maximum = Math.max(1, lab.value) * 1.2;
  if (lab.low !== null) {
    minimum = Math.min(minimum, lab.low);
    maximum = Math.max(maximum, lab.low * 1.2);
  }
  if (lab.high !== null) {
    maximum = Math.max(maximum, lab.high * 1.2);
  }
  const span = maximum - minimum;
  if (rangeStatus(lab) !== 'unknown') {
    let start = minimum;
    let end = maximum;
    if (lab.low !== null) {
      start = lab.low;
    }
    if (lab.high !== null) {
      end = lab.high;
    }
    const band = makeElement('div', 'range-band');
    band.style.left = (start - minimum) / span * 100 + '%';
    band.style.width = (end - start) / span * 100 + '%';
    scale.append(band);
  }
  const marker = makeElement('div', 'value-marker');
  marker.style.left = (lab.value - minimum) / span * 100 + '%';
  scale.append(marker);
  scale.setAttribute('aria-hidden', 'true');
  return scale;
}

function drawLabs(labs) {
  const card = chartCard('Your results, one by one', 'The line marks your result. The green band is the comparison range printed by your lab.');
  card.classList.add('full');
  if (labs.length === 0) {
    card.append(makeElement('p', 'muted', 'No source-backed numeric measurements extracted yet. Analyze this report or check its original text.'));
  }
  for (const lab of labs) {
    const row = makeElement('div', 'lab-row');
    const heading = makeElement('div', 'lab-heading');
    const value = makeElement('div');
    value.append(makeElement('div', '', lab.name), makeElement('p', 'lab-value', lab.value + ' ' + lab.unit));
    const result = rangeStatus(lab);
    row.classList.add(result);
    let label = 'Within lab range';
    if (result === 'high') {
      label = 'Above lab range';
    } else if (result === 'low') {
      label = 'Below lab range';
    } else if (result === 'unknown') {
      label = 'Range not supplied';
    }
    const tag = makeElement('span', 'lab-tag', label);
    if (result === 'high' || result === 'low') {
      tag.classList.add('flagged');
    }
    heading.append(value, tag);
    const scale = drawLabScale(lab);
    let explanation = 'Your value falls within this report’s printed range.';
    if (result === 'high') {
      explanation = 'Your value is above the printed upper limit of ' + lab.high + ' ' + lab.unit + '.';
    } else if (result === 'low') {
      explanation = 'Your value is below the printed lower limit of ' + lab.low + ' ' + lab.unit + '.';
    } else if (result === 'unknown') {
      explanation = 'There is no comparison range in the source, so we cannot mark this high or low.';
    }
    // A strict limit excludes equality; describe that boundary accurately.
    if (result === 'high' && lab.value === lab.high) {
      explanation = 'Your result is at the limit; the report requires a value below ' + lab.high + ' ' + lab.unit + '.';
    } else if (result === 'low' && lab.value === lab.low) {
      explanation = 'Your result is at the limit; the report requires a value above ' + lab.low + ' ' + lab.unit + '.';
    }
    row.append(heading, scale, makeElement('div', 'lab-range', 'Lab comparison range: ' + rangeLabel(lab)), makeElement('p', 'lab-explanation', explanation), sourceDetails(lab.source, 'Check the original report line'));
    card.append(row);
  }
  return card;
}

function drawTrends(labs) {
  const card = chartCard('What changed over time?', 'Compare the same test and units across saved reports. A higher or lower number is not automatically better.');
  card.classList.add('full');
  let found = false;
  const reports = state.reports.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  for (const lab of labs.slice(0, 6)) {
    const points = [];
    for (const report of reports) {
      if (!report.insights) {
        continue;
      }
      for (const previous of report.insights.labs) {
        if (previous.name.toLowerCase() === lab.name.toLowerCase() && previous.unit.toLowerCase() === lab.unit.toLowerCase()) {
          points.push({ value: previous.value, date: report.date });
          break;
        }
      }
    }
    if (points.length < 2) {
      continue;
    }
    found = true;
    card.append(makeElement('h3', '', lab.name + ' · ' + lab.unit));
    const list = makeElement('div', 'trend-values');
    let maximum = 1;
    for (const point of points) {
      maximum = Math.max(maximum, point.value);
    }
    for (const point of points) {
      const item = makeElement('div', 'trend-point');
      const bar = makeElement('div', 'trend-bar');
      bar.style.height = Math.max(2, point.value / maximum * 45) + 'px';
      item.append(bar, makeElement('strong', '', point.value + ' ' + lab.unit), makeElement('span', '', humanDate(point.date)));
      list.append(item);
    }
    card.append(list);
  }
  if (!found) {
    card.append(makeElement('p', 'muted', 'Add another dated report and analyze it to compare matching measurements. A change in a value does not explain its cause.'));
  }
  return card;
}

// Keep the newest available result for each matching test and unit. Never average lab results.
function buildHealthSnapshot(reports) {
  const ordered = reports.slice().reverse().sort(function (a, b) { return b.date.localeCompare(a.date); });
  const labs = [];
  const risks = [];
  const seenLabs = new Set();
  const seenRisks = new Set();
  let analyzed = 0;
  let text = '';
  for (const report of ordered) {
    text = text + '\n' + report.text;
    if (!report.insights) {
      continue;
    }
    analyzed = analyzed + 1;
    for (const lab of report.insights.labs) {
      const key = lab.name.toLowerCase().trim() + '|' + lab.unit.toLowerCase().trim();
      if (!seenLabs.has(key)) {
        seenLabs.add(key);
        labs.push(Object.assign({}, lab, { reportDate: report.date, reportName: report.name }));
      }
    }
    for (const risk of report.insights.risks) {
      const key = risk.name.toLowerCase().trim() + '|' + risk.timeframe.toLowerCase().trim();
      if (!seenRisks.has(key)) {
        seenRisks.add(key);
        risks.push(Object.assign({}, risk, { reportDate: report.date, reportName: report.name }));
      }
    }
  }
  return { id: 'all', name: 'Your combined health summary', text: text, insights: { labs: labs, risks: risks }, analyzed: analyzed };
}

function renderReportPage() {
  const select = get('report-select');
  select.replaceChildren();
  const reports = state.reports.slice().reverse().sort(function (a, b) { return b.date.localeCompare(a.date); });
  const combined = buildHealthSnapshot(state.reports);
  let selected = combined;
  const all = makeElement('option', '', 'My health · all saved reports');
  all.value = 'all';
  select.append(all);
  for (const report of reports) {
    const option = makeElement('option', '', report.name + ' · ' + humanDate(report.date));
    option.value = report.id;
    select.append(option);
    if (report.id === selectedReportId) {
      selected = report;
    }
  }
  get('reports-empty').hidden = reports.length > 0;
  get('report-charts').hidden = reports.length === 0;
  select.disabled = reports.length === 0;
  get('delete-report').disabled = selected.id === 'all' || reports.length === 0;
  get('undo-report').hidden = !state.deletedReport;
  get('analyze-button').disabled = busy || reportProcessing || reports.length === 0;
  if (reports.length === 0) {
    get('report-charts').replaceChildren();
    return;
  }
  selectedReportId = selected.id;
  select.value = selected.id;
  const insights = selected.insights || { labs: [], risks: [] };
  const coverage = makeElement('p', 'summary-coverage');
  get('analyze-button').textContent = 'Analyze report';
  if (selected.id === 'all') {
    coverage.textContent = 'Based on ' + combined.analyzed + ' of ' + reports.length + ' saved reports · Latest available result per test, dated below.';
    get('analyze-button').textContent = 'Analyze all reports';
  } else {
    coverage.textContent = selected.name + ' · ' + humanDate(selected.date);
  }
  const grid = makeElement('div', 'charts-grid');
  grid.append(drawOverview(insights.labs), drawRisks(insights.risks));
  const details = makeElement('details', 'report-details');
  details.append(makeElement('summary', '', 'Explore exact ranges, history and original text'));
  const detailGrid = makeElement('div', 'charts-grid');
  detailGrid.append(drawLabs(insights.labs), drawTrends(insights.labs));
  const source = chartCard('Original reports', 'Your saved source text.');
  source.classList.add('full');
  for (const report of reports) {
    if (selected.id === 'all' || report.id === selected.id) {
      source.append(sourceDetails(report.text, report.name + ' · ' + humanDate(report.date)));
    }
  }
  detailGrid.append(source);
  details.append(detailGrid);
  const charts = get('report-charts');
  let analyzed = Boolean(selected.insights);
  if (selected.id === 'all') {
    analyzed = combined.analyzed > 0;
  }
  const legend = makeElement('p', 'summary-coverage', 'Green bars show the lab’s range. The black line marks your result.');
  const summary = chartCard('Your summary', '');
  const summaryText = makeElement('p', 'health-summary-text', '');
  summaryText.id = 'health-summary-text';
  summaryText.setAttribute('role', 'status');
  summary.append(summaryText);
  const adviceStatus = makeElement('p', 'muted', '');
  adviceStatus.id = 'health-advice-status';
  summary.append(adviceStatus);
  const recommendations = chartCard('Try next', 'Using your reports and recent logged meals.');
  const adviceBody = makeElement('div', '', '');
  adviceBody.id = 'health-recommendations';
  recommendations.append(adviceBody);
  const ask = makeElement('a', 'report-chat-link', 'Talk through my next steps →');
  ask.href = '/?report=' + encodeURIComponent(selected.id);
  recommendations.append(ask);
  charts.replaceChildren(coverage, summary, legend, drawSimpleResults(insights.labs), recommendations, grid, details);
  loadHealthAdvice(selected, false);
}
