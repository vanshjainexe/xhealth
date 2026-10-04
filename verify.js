// Manual integration check. Uses a short synthetic voice sample, not patient data.
const assert = require('node:assert/strict');
const base = 'http://localhost:3000';

async function checkResponse(response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response;
}

async function verify() {
  const speech = await checkResponse(await fetch(base + '/api/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'For lunch I ate two chapatis and one bowl of dal.' })
  }));
  const audio = await speech.arrayBuffer();
  assert.ok(audio.byteLength > 1000);
  console.log('Deepgram speech synthesis: passed');

  const transcription = await checkResponse(await fetch(base + '/api/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: audio
  }));
  const data = await transcription.json();
  assert.ok(data.text.length > 10);
  console.log('Deepgram transcription: passed');

  const reply = await checkResponse(await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Acknowledge this meal description in one sentence, without claiming it is saved: ' + data.text })
  }));
  const events = (await reply.text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some(function (event) { return Boolean(event.text); }));
  assert.equal(events[events.length - 1].done, true);
  console.log('Groq voice-to-chat streamed response: passed');

  const hindiSpeech = await checkResponse(await fetch(base + '/api/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'नमस्ते। आज दाल और सब्ज़ी खाइए। आराम से टहलना भी अच्छी आदत है।', language: 'hi' })
  }));
  const hindiAudio = Buffer.from(await hindiSpeech.arrayBuffer());
  assert.equal(hindiSpeech.headers.get('content-type'), 'audio/wav');
  assert.equal(hindiAudio.toString('ascii', 0, 4), 'RIFF');
  assert.ok(hindiAudio.length > 1000);
  let peak = 0;
  for (let position = 44; position < hindiAudio.length - 1; position = position + 2) {
    peak = Math.max(peak, Math.abs(hindiAudio.readInt16LE(position)));
  }
  assert.ok(peak > 100);
  console.log('Hindi speech produces a valid non-silent WAV: passed');

  const reportContext = { name: 'Fictional demo', date: '2026-09-15', text: 'FICTIONAL. Total cholesterol: 210 mg/dL. Reference: below 200 mg/dL. Hemoglobin: 13.8 g/dL. Range: 12–16 g/dL.' };
  const nextSteps = await checkResponse(await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What should I do next? Give me useful concrete actions.', reports: [reportContext], history: [{ role: 'user', content: 'I have no allergies or known conditions. I want ordinary lifestyle ideas, not medication.' }] })
  }));
  const stepEvents = (await nextSteps.text()).trim().split('\n').map(JSON.parse);
  const steps = stepEvents.map(function (event) { return event.text || ''; }).join('');
  assert.ok(/ghee|butter|oats|dal|walk|beans|vegetables/i.test(steps));
  assert.ok(!/can't give|cannot give|need a bit more context|could you let me know/i.test(steps));
  console.log('Report guidance gives practical actions without repeated intake: passed');

  const hindiReply = await checkResponse(await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What should I do next?', reports: [reportContext], voice: true })
  }));
  const hindiEvents = (await hindiReply.text()).trim().split('\n').map(JSON.parse);
  const spokenReply = hindiEvents.map(function (event) { return event.text || ''; }).join('');
  assert.ok(/[\u0900-\u097F]/.test(spokenReply));
  assert.equal(hindiEvents[hindiEvents.length - 1].done, true);
  console.log('Voice conversation replies in Hindi: passed');

  const customMeal = await checkResponse(await fetch(base + '/api/meal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'I eat 2 huge macdonanlds burgers and a roti full of oil and ghee' })
  }));
  const customData = await customMeal.json();
  assert.equal(customData.needsDetails, false);
  assert.ok(customData.meal.calories > 0);
  assert.ok(/roti/i.test(customData.meal.description));
  assert.ok(customData.meal.notes.length > 10);
  console.log('Custom meal logs without another portion question: passed');

  const naturalCases = [
    ['9 rotis 5 burgers and 9 pizzas', 'meal'],
    ['Just polished off a couple of cheese quesadillas and a mango lassi.', 'meal'],
    ['आज दो रोटी और थोड़ी दाल खाई', 'meal'],
    ['Would two burgers fit a healthy dinner plan?', 'chat'],
    ['Explain my cholesterol report and tell me what to do next.', 'chat']
  ];
  for (const entry of naturalCases) {
    const response = await checkResponse(await fetch(base + '/api/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: entry[0], meals: [], history: [] })
    }));
    const intent = await response.json();
    assert.equal(intent.action, entry[1]);
  }
  const correction = await checkResponse(await fetch(base + '/api/intent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Actually it was three burgers, not two.', meals: [{ id: 'test-meal', description: '1 bowl of dal and 2 burgers' }], history: [] })
  }));
  const correctionIntent = await correction.json();
  assert.equal(correctionIntent.action, 'update_meal');
  assert.equal(correctionIntent.mealId, 'test-meal');
  console.log('Natural food descriptions, Hindi, questions and corrections route by context: passed');

  // Exercise clinical chart boundaries independently of the model.
  const fs = require('node:fs');
  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(fs.readFileSync('public/reports.js', 'utf8'), context);
  assert.equal(context.rangeStatus({ value: 200, low: null, high: 200, highInclusive: false }), 'high');
  assert.equal(context.rangeStatus({ value: 200, low: null, high: 200, highInclusive: true }), 'within');
  assert.equal(context.rangeStatus({ value: 12, low: 12, high: 16, lowInclusive: true }), 'within');
  assert.equal(context.rangeStatus({ value: 11, low: 12, high: 16 }), 'low');
  assert.equal(context.rangeStatus({ value: 13.8, low: null, high: null }), 'unknown');
  console.log('Lab chart reference-range boundaries: passed');

  const snapshots = context.buildHealthSnapshot([
    { id: 'old', name: 'Older', date: '2026-08-01', text: '', insights: { labs: [{ name: 'Total cholesterol', unit: 'mg/dL', value: 240 }], risks: [] } },
    { id: 'new', name: 'Latest', date: '2026-09-15', text: '', insights: { labs: [{ name: 'Total cholesterol', unit: 'mg/dL', value: 210 }, { name: 'Hemoglobin', unit: 'g/dL', value: 13.8 }], risks: [] } }
  ]);
  assert.equal(snapshots.insights.labs.length, 2);
  assert.equal(snapshots.insights.labs[0].value, 210);
  assert.equal(snapshots.insights.labs[0].reportDate, '2026-09-15');
  console.log('Combined reports use latest dated values, without averaging: passed');
}

verify().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
