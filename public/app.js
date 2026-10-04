// Chat, logging and playback. Voice listening is in voice.js.
const STORAGE_KEY = 'sehat-saathi-v1';
function get(id) {
  return document.getElementById(id);
}
let state = { reports: [], messages: [], meals: [], lastChat: [], readAloud: false, replyLanguage: 'en' };
let inputMode = 'chat';
let pendingMeal = '';
let selectedReportId = '';
const reportsPage = window.location.pathname.startsWith('/reports');
let busy = false;
let reportProcessing = false;
let status = { groq: false, deepgram: false };
let audioPlayer = null;
let speechQueue = Promise.resolve();
let speechSession = 0;
let speechFailed = false;
let cancelHindiSpeech = null;
let cancelVoiceAudio = null;

function setVoiceState(mode, label) {
  get('voice-orb').className = 'voice-orb ' + mode;
  get('orb-status').textContent = label;
}

function findHindiVoice() {
  if (!window.speechSynthesis) {
    return null;
  }
  for (const voice of window.speechSynthesis.getVoices()) {
    if (voice.lang.toLowerCase().startsWith('hi')) {
      return voice;
    }
  }
  return null;
}

function updateHindiVoice() {
  get('reply-language').textContent = 'English';
  get('hindi-voice-status').textContent = 'Replies in English';
  if (state.replyLanguage === 'hi') {
    get('reply-language').textContent = 'हिन्दी';
    get('hindi-voice-status').textContent = 'हिन्दी में जवाब मिलेगा';
  }
}

function openVoice() {
  get('voice-panel').hidden = false;
  get('voice-output').checked = state.readAloud;
  saveState();
  setVoiceState('ready', 'Ready to talk');
  updateHindiVoice();
}

function closeVoice() {
  endConversation();
  stopAudio();
  get('voice-panel').hidden = true;
}

function speakHindi(text, session) {
  return new Promise(function (resolve, reject) {
    const voice = findHindiVoice();
    if (!voice) {
      reject(new Error('No Hindi voice is available on this device. Your Hindi text reply is shown.'));
      return;
    }
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = 'hi-IN';
    speech.voice = voice;
    speech.rate = 0.95;
    cancelHindiSpeech = resolve;
    speech.onstart = function () {
      if (session === speechSession) {
        setVoiceState('speaking', 'xhealth बोल रहा है');
      }
    };
    speech.onend = function () { cancelHindiSpeech = null; resolve(); };
    speech.onerror = function (event) {
      cancelHindiSpeech = null;
      if (session !== speechSession || event.error === 'canceled' || event.error === 'interrupted') {
        resolve();
      } else {
        reject(new Error('Hindi audio could not play. Try again.'));
      }
    };
    window.speechSynthesis.speak(speech);
  });
}

async function playReplyAudio(text, session, language) {
  if (language === 'hi' && findHindiVoice()) {
    await speakHindi(text, session);
    return;
  }
  const response = await fetch('/api/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, language: language })
  });
  if (!response.ok) {
    await readResponse(response);
  }
  const blob = await response.blob();
  if (session !== speechSession) {
    return;
  }
  if (conversationActive && voiceContext) {
    await playVoiceBuffer(blob, session);
    return;
  }
  const url = URL.createObjectURL(blob);
  const player = new Audio(url);
  audioPlayer = player;
  setVoiceState('speaking', 'xhealth is speaking');
  try {
    await new Promise(function (resolve, reject) {
      player.onended = resolve;
      player.onerror = function () { reject(new Error('Reply audio could not play.')); };
      player.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
    if (audioPlayer === player) {
      audioPlayer = null;
    }
  }
}

function showNotice(text) {
  get('notice-text').textContent = text;
  get('notice').hidden = false;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showNotice('Browser storage is full or unavailable. Your changes will only last for this session.');
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.reports) && Array.isArray(saved.messages)) {
      state.reports = saved.reports;
      state.messages = saved.messages;
      if (Array.isArray(saved.meals)) {
        state.meals = saved.meals;
      }
      if (Array.isArray(saved.lastChat)) {
        state.lastChat = saved.lastChat;
      }
      state.readAloud = saved.readAloud === true;
      if (saved.replyLanguage === 'hi') {
        state.replyLanguage = 'hi';
      }
      if (saved.healthAdvice) {
        state.healthAdvice = saved.healthAdvice;
      }
      if (saved.deletedReport && saved.deletedReport.report) {
        state.deletedReport = saved.deletedReport;
      }
      if (saved.inputMode === 'meal') {
        inputMode = 'meal';
      }
      if (typeof saved.pendingMeal === 'string') {
        pendingMeal = saved.pendingMeal;
      }
    }
  } catch (error) {
    showNotice('Saved data could not be read. Starting with a blank conversation.');
  }
}

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || 'Request failed. Please try again.');
  }
  return data;
}

async function postJson(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return readResponse(response);
}

async function updateStatus() {
  try {
    status = await readResponse(await fetch('/api/status'));
    if (status.groq && status.deepgram) {
      get('connection').textContent = 'Voice connected. Tap Speak to start.';
    } else if (status.groq) {
      get('connection').textContent = 'Text chat is ready. Connect voice below.';
    } else {
      get('connection').textContent = 'Connect the local demo below to get started.';
    }
  } catch (error) {
    get('connection').textContent = 'Server unavailable';
  }
}

function setBusy(value) {
  busy = value;
  for (const id of ['send-button', 'mic-button', 'new-chat', 'attach-button', 'meal-mode', 'save-report-button', 'welcome-voice', 'welcome-meal', 'welcome-report']) {
    get(id).disabled = value;
  }
  get('orb-mic').disabled = value && !conversationActive;
  if (conversationActive) {
    get('mic-button').disabled = false;
  }
  get('analyze-button').disabled = value || state.reports.length === 0;
}

function makeContext(message, voiceInput, useReports = true) {
  const reports = [];
  for (const report of state.reports) {
    if (useReports) {
      reports.push({ name: report.name, date: report.date, text: report.text, insights: report.insights });
    }
  }
  return { message: message, reports: reports, meals: state.meals.slice(-8), history: state.messages.slice(-10), voice: Boolean(voiceInput), replyLanguage: state.replyLanguage };
}

function cleanReply(text) {
  return text.replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '');
}

function addMessage(role, text, mealId, mealUpdated) {
  const element = document.createElement('div');
  element.className = 'message ' + role;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  if (role === 'user') {
    speaker.textContent = 'YOU';
  } else {
    speaker.textContent = '+';
    speaker.setAttribute('aria-label', 'xhealth');
  }
  const content = document.createElement('div');
  content.className = 'message-text';
  content.textContent = cleanReply(text);
  if (mealId) {
    const meal = state.meals.find(function (entry) { return entry.id === mealId; });
    if (meal) {
      content.replaceChildren(makeMealCard(meal, true, mealUpdated));
    }
  }
  element.append(speaker, content);
  get('welcome').hidden = true;
  get('messages').append(element);
  get('chat-scroll').scrollTop = get('chat-scroll').scrollHeight;
  return content;
}

function renderMessages() {
  get('messages').replaceChildren();
  get('welcome').hidden = state.messages.length > 0;
  for (const message of state.messages) {
    addMessage(message.role, message.content, message.mealId, message.mealUpdated);
  }
  get('restore-chat').hidden = state.lastChat.length === 0;
}

function stopAudio() {
  speechSession = speechSession + 1;
  speechQueue = Promise.resolve();
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (cancelHindiSpeech) {
    cancelHindiSpeech();
    cancelHindiSpeech = null;
  }
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.dispatchEvent(new Event('ended'));
    audioPlayer = null;
  }
  if (cancelVoiceAudio) {
    cancelVoiceAudio();
    cancelVoiceAudio = null;
  }
  get('stop-audio').hidden = true;
  setVoiceState('ready', 'Ready to talk');
}

// The text stream uses about 40 characters. Speech uses longer phrases to sound natural.
function queueSpeech(text) {
  if (!get('voice-output').checked || !text.trim()) {
    return;
  }
  const session = speechSession;
  const language = state.replyLanguage;
  get('stop-audio').hidden = false;
  speechQueue = speechQueue.then(async function () {
    if (session !== speechSession || speechFailed) {
      return;
    }
    try {
      let spokenText = text.replace(/[*#`]/g, '');
      if (language === 'hi' && !/[\u0900-\u097F]/.test(spokenText)) {
        const translation = await postJson('/api/hindi', { text: spokenText });
        spokenText = translation.text;
      }
      if (session !== speechSession) {
        return;
      }
      await playReplyAudio(spokenText, session, language);
      if (session === speechSession) {
        setVoiceState('ready', 'Ready to talk');
      }
    } catch (error) {
      if (session !== speechSession) {
        return;
      }
      speechFailed = true;
      setVoiceState('ready', 'Reply is on screen');
      get('stop-audio').hidden = true;
      showNotice('Speech unavailable: ' + error.message + ' Your text reply still works.');
    }
  });
}

async function askQuestion(question, loadingOutput, voiceInput, useReports) {
  if (busy || !question.trim()) {
    return;
  }

  if (!status.groq) {
    openSettings(true);
    showNotice('Add a Groq key to start the conversation.');
    return;
  }
  stopAudio();
  speechFailed = false;
  const input = makeContext(question, voiceInput, useReports);
  state.messages.push({ role: 'user', content: question });
  if (!loadingOutput) {
    addMessage('user', question);
  }
  get('question').value = '';
  let output = loadingOutput;
  if (!output) {
    output = addMessage('assistant', 'Thinking…');
  }
  if (!get('voice-panel').hidden) {
    setVoiceState('thinking', 'सोच रहा है…');
  }
  setBusy(true);
  let reply = '';
  let speechBuffer = '';
  let completed = false;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      await readResponse(response);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      pending = pending + decoder.decode(result.value, { stream: true });
      let position = pending.indexOf('\n');
      while (position >= 0) {
        const line = pending.slice(0, position);
        pending = pending.slice(position + 1);
        if (line.trim()) {
          const part = JSON.parse(line);
          if (part.error) {
            throw new Error(part.error);
          }
          if (part.done) {
            completed = true;
          }
          if (part.text) {
            reply = reply + part.text;
            speechBuffer = speechBuffer + part.text;
            output.textContent = cleanReply(reply);
            get('chat-scroll').scrollTop = get('chat-scroll').scrollHeight;
            if (speechBuffer.length >= 120 && /[.!?।]\s*$/.test(speechBuffer)) {
              queueSpeech(speechBuffer);
              speechBuffer = '';
            } else if (speechBuffer.length >= 300) {
              const boundary = speechBuffer.lastIndexOf(' ');
              if (boundary > 0) {
                queueSpeech(speechBuffer.slice(0, boundary));
                speechBuffer = speechBuffer.slice(boundary + 1);
              }
            }
          }
        }
        position = pending.indexOf('\n');
      }
    }
    if (!completed || !reply.trim()) {
      throw new Error('The reply was interrupted. Please try again.');
    }
    queueSpeech(speechBuffer);
    const session = speechSession;
    speechQueue.then(function () {
      if (session === speechSession) {
        get('stop-audio').hidden = true;
        setVoiceState('ready', 'Ready to talk');
      }
    });
    state.messages.push({ role: 'assistant', content: reply });
  } catch (error) {
    stopAudio();
    output.textContent = reply + '\n\n' + error.message;
    showNotice(error.message);
  } finally {
    saveState();
    setBusy(false);
  }
}

function deleteReport(id) {
  const index = state.reports.findIndex(function (report) { return report.id === id; });
  if (index < 0) {
    return;
  }
  state.deletedReport = { report: state.reports[index], index: index };
  state.reports.splice(index, 1);
  state.healthAdvice = null;
  healthSummaryRequest = healthSummaryRequest + 1;
  selectedReportId = 'all';
  saveState();
  renderReports();
  renderReportPage();
  showNotice('Report deleted. Undo delete is available in My health.');
}

function undoReportDelete() {
  if (!state.deletedReport) {
    return;
  }
  if (state.reports.length >= 3) {
    showNotice('Remove another report first to make space for the restored report.');
    return;
  }
  state.reports.splice(state.deletedReport.index, 0, state.deletedReport.report);
  state.deletedReport = null;
  state.healthAdvice = null;
  healthSummaryRequest = healthSummaryRequest + 1;
  saveState();
  renderReports();
  renderReportPage();
  showNotice('Report restored.');
}

function renderReports() {
  get('report-list').replaceChildren();
  get('report-chips').replaceChildren();
  for (const report of state.reports) {
    const chip = makeElement('button', '', report.name);
    chip.title = report.name + ' · ' + report.date;
    chip.onclick = openReports;
    get('report-chips').append(chip);
    const item = makeElement('div', 'report-item');
    item.append(sourceDetails(report.text, report.name));
    const meta = makeElement('div', 'report-meta');
    const remove = makeElement('button', '', 'Remove');
    remove.setAttribute('aria-label', 'Remove ' + report.name);
    remove.onclick = function () {
      deleteReport(report.id);
    };
    meta.append(makeElement('span', '', report.date), remove);
    item.append(meta);
    get('report-list').append(item);
  }
}

async function saveReport(event) {
  event.preventDefault();
  if (busy || reportProcessing) {
    return;
  }
  if (state.reports.length >= 3) {
    get('report-status').textContent = 'Keep up to three reports. Remove an older one to add another.';
    return;
  }
  const report = {
    id: crypto.randomUUID(), name: get('report-name').value.trim(),
    date: get('report-date').value, text: get('report-text').value.trim(), analysisStatus: 'pending'
  };
  if (!report.name || !report.text) {
    get('report-status').textContent = 'Add a report name and readable text.';
    return;
  }
  state.reports.push(report);
  selectedReportId = 'all';
  saveState();
  reportProcessing = true;
  get('save-report-button').disabled = true;
  get('report-dialog').close();
  renderReports();
  showNotice('Report saved. Charts are being prepared; you can keep chatting.');
  try {
    if (status.groq) {
      const data = await postJson('/api/report', { text: report.text });
      report.insights = data.insights;
      report.analysisStatus = 'ready';
      report.analysisError = '';
      saveState();
    }
    get('report-form').reset();
    setToday();
    get('report-dialog').close();
    const reply = 'Report saved: ' + report.name + ' (' + report.date + '). Ask me about it here, or open Reports to see your charts and source text.';
    state.messages.push({ role: 'assistant', content: reply });
    addMessage('assistant', reply);
    saveState();
    showNotice('Report saved. Your charts are on the Reports page.');
  } catch (error) {
    report.analysisStatus = 'error';
    report.analysisError = error.message;
    saveState();
    get('report-status').textContent = 'Your report is saved. Charts could not be created: ' + error.message;
    showNotice('Report saved. You can retry analysis on the Reports page.');
  } finally {
    reportProcessing = false;
    get('save-report-button').disabled = busy;
    renderReports();
    renderReportPage();
  }
}

async function uploadReport(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showNotice('Please use a file under 8 MB.');
    get('report-status').textContent = 'Please use a file under 8 MB.';
    return;
  }
  get('save-report-button').disabled = true;
  get('report-file').disabled = true;
  try {
    let text = '';
    let scanned = false;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      showNotice('Reading PDF…');
      get('report-status').textContent = 'Reading PDF… Scanned pages may take a moment.';
      const response = await fetch('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const data = await readResponse(response);
      text = data.text;
      scanned = data.ocr === true;
    } else if (file.name.toLowerCase().endsWith('.txt')) {
      text = await file.text();
    } else {
      throw new Error('Use a PDF or .txt file.');
    }
    get('report-name').value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
    get('report-text').value = text;
    let message = 'PDF text loaded. Check the values and report date, then click Save & analyze.';
    if (scanned) {
      message = 'Scanned PDF read. Check the extracted numbers, units and ranges before Save & analyze.';
    } else if (file.name.toLowerCase().endsWith('.txt')) {
      message = 'Text loaded. Check the values and report date, then click Save & analyze.';
    }
    get('report-status').textContent = message;
    showNotice(message);
  } catch (error) {
    get('report-status').textContent = error.message;
    showNotice(error.message);
  } finally {
    event.target.value = '';
    get('report-file').disabled = false;
    get('save-report-button').disabled = busy;
  }
}

function setToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  get('report-date').value = year + '-' + month + '-' + day;
}

function loadSample() {
  get('report-name').value = 'Sample blood report — fictional';
  setToday();
  get('report-text').value = [
    'FICTIONAL TEST REPORT — not a real patient.',
    'Routine blood tests. All reference ranges below are part of this fictional sample.',
    'Fasting glucose: 92 mg/dL. Reference: 70-99 mg/dL.',
    'HbA1c: 5.4 %. Reference: 4.0-5.6 %.',
    'Total cholesterol: 210 mg/dL. Reference: below 200 mg/dL.',
    'LDL cholesterol: 138 mg/dL. Reference: below 100 mg/dL.',
    'Triglycerides: 170 mg/dL. Reference: below 150 mg/dL.',
    'Hemoglobin: 14.2 g/dL. Reference: 13.0-17.0 g/dL.',
    'Creatinine: 0.9 mg/dL. Reference: 0.7-1.3 mg/dL.',
    'TSH: 2.4 mIU/L. Reference: 0.4-4.0 mIU/L.'
  ].join('\n');
  get('report-status').textContent = 'Sample loaded: eight results, with a mix of within-range and high values. Click Save & analyze.';
}

function todayKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function openSettings(connectionSetup) {
  get('setup-dialog').showModal();
  if (connectionSetup === true) {
    document.querySelector('.connection-settings').open = true;
  }
}

function openReports() {
  get('report-status').textContent = '';
  get('report-dialog').showModal();
}

function setMode(mode) {
  inputMode = mode;
  get('meal-mode').classList.remove('mode-active');
  get('meal-mode').textContent = 'Log meal';
  get('question').placeholder = 'Message xhealth…';
  get('meal-help').hidden = mode !== 'meal';
  if (mode === 'meal') {
    get('meal-mode').classList.add('mode-active');
    get('meal-mode').textContent = 'Logging a meal ×';
    get('question').placeholder = 'What did you eat? Include portions, or tap Speak…';
  } else {
    pendingMeal = '';
  }
  state.inputMode = inputMode;
  state.pendingMeal = pendingMeal;
  saveState();
  get('question').focus();
}

async function handleMessage(text, voiceInput) {
  if (busy || !text.trim()) {
    return;
  }
  if (!status.groq) {
    openSettings(true);
    return;
  }

  stopAudio();
  setBusy(true);
  addMessage('user', text);
  const loadingOutput = addMessage('assistant', 'Thinking…');
  if (!get('voice-panel').hidden) {
    setVoiceState('thinking', 'सोच रहा है…');
  }
  let intent;
  try {
    intent = await postJson('/api/intent', {
      message: text, mode: inputMode, pendingMeal: pendingMeal,
      history: state.messages.slice(-8), meals: state.meals.slice(-8)
    });
  } catch (error) {
    loadingOutput.textContent = 'Could not complete that request: ' + error.message;
    state.messages.push({ role: 'user', content: text }, { role: 'assistant', content: loadingOutput.textContent });
    saveState();
    setVoiceState('ready', 'Ready to talk');
    return;
  } finally {
    setBusy(false);
  }
  if (intent.action === 'meal') {
    await logMeal(intent.description, text, '', loadingOutput);
  } else if (intent.action === 'update_meal') {
    await logMeal(intent.description, text, intent.mealId, loadingOutput);
  } else {
    await askQuestion(text, loadingOutput, voiceInput, intent.useReports);
  }
}

async function logMeal(description, originalMessage, replaceMealId, loadingOutput) {
  if (busy || !description.trim()) {
    return;
  }
  if (!status.groq) {
    openSettings(true);
    return;
  }
  stopAudio();
  speechFailed = false;
  const userMessage = { role: 'user', content: originalMessage };
  state.messages.push(userMessage);
  if (!loadingOutput) {
    addMessage('user', originalMessage);
  }
  get('question').value = '';
  let output = loadingOutput;
  if (!output) {
    output = addMessage('assistant', 'Thinking…');
  }
  setBusy(true);
  try {
    const details = description;
    const data = await postJson('/api/meal', { description: details });
    let reply = '';
    let mealId = '';
    if (data.needsDetails) {
      pendingMeal = details;
      setMode('meal');
      reply = data.question;
    } else {
      const meal = data.meal;
      const date = new Date();
      if (/\byesterday\b/i.test(details)) {
        date.setDate(date.getDate() - 1);
      }
      meal.id = crypto.randomUUID();
      meal.day = todayKey(date);
      meal.loggedAt = new Date().toISOString();
      let saved = false;
      if (replaceMealId) {
        for (let index = 0; index < state.meals.length; index = index + 1) {
          const previous = state.meals[index];
          if (previous.id === replaceMealId) {
            meal.id = previous.id;
            meal.day = previous.day;
            meal.loggedAt = previous.loggedAt;
            state.meals[index] = meal;
            saved = true;
            break;
          }
        }
      }
      if (!saved) {
        state.meals.push(meal);
      }
      mealId = meal.id;
      pendingMeal = '';
      setMode('chat');
      reply = 'Logged ' + meal.label.toLowerCase() + ': ' + meal.description + '\n\nAbout ' + meal.calories + ' kcal (estimated).\n' + meal.notes;
      if (replaceMealId) {
        reply = 'Updated your meal: ' + meal.description + '\n\nAbout ' + meal.calories + ' kcal (estimated).\n' + meal.notes;
      }
      renderMeals();
    }
    output.textContent = reply;
    if (mealId) {
      output.replaceChildren(makeMealCard(data.meal, true, Boolean(replaceMealId)));
    }
    state.messages.push({ role: 'assistant', content: reply, mealId: mealId, mealUpdated: Boolean(replaceMealId) });
    queueSpeech(reply);
  } catch (error) {
    output.textContent = error.message;
    showNotice(error.message);
  } finally {
    state.pendingMeal = pendingMeal;
    saveState();
    setBusy(false);
    get('chat-scroll').scrollTop = get('chat-scroll').scrollHeight;
    const session = speechSession;
    speechQueue.then(function () {
      if (session === speechSession) {
        get('stop-audio').hidden = true;
      }
    });
  }
}

// Use the same nutrient labels in saved meal cards and daily totals.
function nutrientCards(values) {
  const grid = makeElement('div', 'macro-summary');
  const fields = [['protein', 'Protein'], ['carbs', 'Carbohydrates'], ['fat', 'Fat']];
  for (const field of fields) {
    let amount = 'Not estimated';
    if (typeof values[field[0]] === 'number') {
      amount = '≈ ' + Math.round(values[field[0]]) + ' g';
    }
    const card = makeElement('div', 'nutrient ' + field[0]);
    card.append(makeElement('span', '', field[1]), makeElement('strong', '', amount));
    grid.append(card);
  }
  return grid;
}

function makeMealCard(meal, receipt, updated) {
  const card = makeElement('article', 'meal-card');
  let heading = meal.label;
  if (receipt) {
    heading = '✓ Meal saved · ' + meal.label;
    if (updated) {
      heading = '✓ Meal updated · ' + meal.label;
    }
  }
  card.append(makeElement('h3', '', heading), makeElement('p', '', meal.description));
  const energy = makeElement('div', 'meal-energy');
  energy.append(makeElement('strong', '', '≈ ' + meal.calories + ' kcal'), makeElement('span', '', 'Estimated food energy'));
  card.append(energy, nutrientCards(meal));
  if (meal.notes) {
    card.append(makeElement('p', 'muted', meal.notes));
    const details = sourceDetails(meal.notes, 'Portions behind this estimate');
    details.classList.add('meal-note');
    card.append(details);
  }
  if (receipt) {
    const diary = makeElement('button', 'diary-link', 'View today’s food diary →');
    diary.onclick = function () { renderMeals(); get('meal-dialog').showModal(); };
    card.append(diary);
  }
  return card;
}

function drawMealEnergy(values) {
  const area = makeElement('section', 'food-energy-chart');
  // Approximate food energy: protein and carbs 4 kcal/g, fat 9 kcal/g.
  if (typeof values.protein !== 'number' || typeof values.carbs !== 'number' || typeof values.fat !== 'number') {
    return area;
  }
  const protein = values.protein * 4;
  const carbs = values.carbs * 4;
  const fat = values.fat * 9;
  const total = protein + carbs + fat;
  if (total === 0) {
    return area;
  }
  const proteinShare = protein / total * 100;
  const carbShare = carbs / total * 100;
  const secondStop = proteinShare + carbShare;
  const ring = makeElement('div', 'donut food-donut');
  ring.style.background = 'conic-gradient(#000 0% ' + proteinShare + '%, #888 ' + proteinShare + '% ' + secondStop + '%, #ddd ' + secondStop + '% 100%)';
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', 'Estimated energy mix: protein ' + Math.round(proteinShare) + '%, carbohydrates ' + Math.round(carbShare) + '%, fat ' + Math.round(fat / total * 100) + '%');
  const center = makeElement('div', 'donut-center');
  center.append(makeElement('strong', '', 'Energy'), makeElement('span', '', 'mix'));
  ring.append(center);
  const detail = makeElement('div', 'energy-legend');
  detail.append(makeElement('h3', '', 'Where the energy comes from'));
  const entries = [['protein', 'Protein', proteinShare], ['carbs', 'Carbohydrates', carbShare], ['fat', 'Fat', fat / total * 100]];
  for (const entry of entries) {
    const row = makeElement('div', entry[0]);
    row.append(makeElement('span', 'legend-dot'), makeElement('span', '', entry[1]), makeElement('strong', '', Math.round(entry[2]) + '%'));
    detail.append(row);
  }
  detail.append(makeElement('p', '', 'Approximate split from macros; rounding varies.'));
  const guide = makeElement('a', '', 'How food energy is estimated ↗');
  guide.href = 'https://www.nal.usda.gov/programs/fnic';
  guide.target = '_blank';
  guide.rel = 'noopener noreferrer';
  detail.append(guide);
  area.append(ring, detail);
  return area;
}

function renderMeals() {
  const meals = state.meals.filter(function (meal) { return meal.day === todayKey(new Date()); });
  let calories = 0;
  const macros = { protein: 0, carbs: 0, fat: 0 };
  const known = { protein: true, carbs: true, fat: true };
  for (const meal of meals) {
    calories = calories + meal.calories;
    for (const field of ['protein', 'carbs', 'fat']) {
      if (meal[field] === null || meal[field] === undefined) {
        known[field] = false;
      } else {
        macros[field] = macros[field] + meal[field];
      }
    }
  }
  get('meal-totals').textContent = 'No meals logged yet';
  get('meal-day-total').textContent = 'Your diary is ready for its first meal';
  if (meals.length > 0) {
    let mealLabel = 'meals';
    if (meals.length === 1) {
      mealLabel = 'meal';
    }
    get('meal-totals').textContent = meals.length + ' ' + mealLabel + ' · ≈ ' + calories + ' kcal estimated';
    get('meal-day-total').textContent = '≈ ' + calories + ' kcal from ' + meals.length + ' logged ' + mealLabel;
  }
  for (const field of ['protein', 'carbs', 'fat']) {
    if (meals.length === 0 || !known[field]) {
      macros[field] = null;
    }
  }
  const nutrientGrid = nutrientCards(macros);
  get('macro-summary').replaceChildren(nutrientGrid);
  get('meal-energy-chart').replaceChildren(drawMealEnergy(macros));
  get('meal-list').replaceChildren();
  if (meals.length === 0) {
    get('meal-list').append(makeElement('p', 'muted', 'Try “For lunch, I had 2 rotis and 1 bowl of dal.” Add portions to get a more useful estimate.'));
  }
  for (const meal of meals) {
    const item = makeElement('div', 'meal-item');
    const meta = makeElement('div', 'meal-meta');
    const remove = makeElement('button', 'quiet', 'Remove');
    remove.onclick = function () {
      state.meals = state.meals.filter(function (entry) { return entry.id !== meal.id; });
      saveState();
      renderMeals();
    };
    let time = 'Saved meal';
    if (meal.loggedAt) {
      time = new Date(meal.loggedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    }
    meta.append(makeElement('span', '', 'Logged at ' + time), remove);
    item.append(meta, makeMealCard(meal, false));
    get('meal-list').append(item);
  }
}

async function analyzeSelectedReport(onlyMissing) {
  if (busy || reportProcessing) {
    return;
  }
  let reports = state.reports;
  if (selectedReportId !== 'all') {
    reports = state.reports.filter(function (entry) { return entry.id === selectedReportId; });
  }
  if (onlyMissing === true) {
    reports = reports.filter(function (report) {
      return !report.insights || report.insights.labs.length === 0;
    });
  }
  if (reports.length === 0) {
    return;
  }
  reportProcessing = true;
  for (const report of reports) {
    report.analysisStatus = 'pending';
    report.analysisError = '';
  }
  renderReportPage();
  get('analyze-button').disabled = true;
  get('analyze-button').textContent = 'Analyzing…';
  try {
    for (const report of reports) {
      try {
        const data = await postJson('/api/report', { text: report.text });
        report.insights = data.insights;
        report.analysisStatus = 'ready';
      } catch (error) {
        report.analysisStatus = 'error';
        report.analysisError = error.message;
        throw error;
      } finally {
        saveState();
      }
    }
    showNotice('Charts updated. Check the extracted values against the source.');
  } catch (error) {
    showNotice(error.message);
  } finally {
    get('analyze-button').textContent = 'Analyze report';
    reportProcessing = false;
    renderReportPage();
  }
}

function newChat() {
  if (busy || conversationActive) {
    return;
  }
  stopAudio();
  if (state.messages.length > 0) {
    state.lastChat = state.messages.slice();
  }
  state.messages = [];
  setMode('chat');
  renderMessages();
  get('notice').hidden = true;
}

function bindEvents() {
  get('report-form').onsubmit = saveReport;
  get('report-file').onchange = uploadReport;
  get('sample-button').onclick = loadSample;
  get('attach-button').onclick = openReports;
  get('welcome-report').onclick = openReports;
  get('add-report-page').onclick = openReports;
  get('sample-report-page').onclick = function () { openReports(); loadSample(); };
  get('short-sample').onclick = function () { openReports(); loadSample(); };
  get('delete-report').onclick = function () { deleteReport(selectedReportId); };
  get('undo-report').onclick = undoReportDelete;
  get('close-report').onclick = function () { get('report-dialog').close(); };
  get('chat-form').onsubmit = function (event) {
    event.preventDefault();
    handleMessage(get('question').value.trim());
  };
  get('question').onkeydown = function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleMessage(get('question').value.trim());
    }
  };
  get('question').oninput = function () {
    get('question').style.height = 'auto';
    get('question').style.height = Math.min(140, get('question').scrollHeight) + 'px';
  };
  get('mic-button').onclick = function () {
    if (conversationActive) {
      toggleMicrophone();
    } else {
      openVoice();
    }
  };
  get('welcome-voice').onclick = openVoice;
  get('orb-mic').onclick = toggleMicrophone;
  get('close-voice').onclick = closeVoice;
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', updateHindiVoice);
  }
  get('stop-audio').onclick = stopAudio;
  function changeVoiceReplies(event) {
    get('voice-output').checked = event.target.checked;
    state.readAloud = get('voice-output').checked;
    saveState();
    if (!state.readAloud) {
      stopAudio();
    }
  }
  get('voice-output').onchange = changeVoiceReplies;
  get('reply-language').onclick = function () {
    stopAudio();
    if (state.replyLanguage === 'en') {
      state.replyLanguage = 'hi';
    } else {
      state.replyLanguage = 'en';
    }
    updateHindiVoice();
    saveState();
  };
  get('new-chat').onclick = newChat;
  get('restore-chat').onclick = function () {
    if (!busy) {
      state.messages = state.lastChat.slice();
      saveState();
      renderMessages();
      get('setup-dialog').close();
    }
  };
  get('meal-mode').onclick = function () {
    if (inputMode === 'meal') {
      setMode('chat');
    } else {
      setMode('meal');
    }
  };
  get('welcome-meal').onclick = function () { setMode('meal'); };
  get('cancel-meal').onclick = function () { setMode('chat'); };
  get('meal-example').onclick = function () {
    get('question').value = 'For lunch, I had 2 rotis and 1 bowl of dal.';
    get('question').focus();
  };
  get('meal-summary').onclick = function () { renderMeals(); get('meal-dialog').showModal(); };
  get('close-meals').onclick = function () { get('meal-dialog').close(); };
  get('add-meal-dialog').onclick = function () { get('meal-dialog').close(); setMode('meal'); };
  get('setup-button').onclick = function () { openSettings(false); };
  get('close-setup').onclick = function () { get('setup-dialog').close(); };
  get('dismiss-notice').onclick = function () { get('notice').hidden = true; };
  get('report-select').onchange = function () {
    selectedReportId = get('report-select').value;
    renderReportPage();
  };
  get('analyze-button').onclick = analyzeSelectedReport;
  get('setup-form').onsubmit = async function (event) {
    event.preventDefault();
    get('setup-status').textContent = 'Saving…';
    try {
      await postJson('/api/settings', { GROQ_API_KEY: get('groq-key').value, DEEPGRAM_API_KEY: get('deepgram-key').value });
      get('setup-form').reset();
      await updateStatus();
      get('setup-dialog').close();
      showNotice('Connection saved.');
    } catch (error) {
      get('setup-status').textContent = error.message;
    }
  };
  get('clear-button').onclick = function () {
    if (busy || conversationActive) {
      showNotice('Finish the current request or recording first.');
      return;
    }
    if (confirm('Delete chats, reports and meals saved in this browser? The connection will stay configured.')) {
      stopAudio();
      state = { reports: [], messages: [], meals: [], lastChat: [], readAloud: false };
      saveState();
      renderReports();
      renderMessages();
      renderMeals();
      renderReportPage();
      get('setup-dialog').close();
      showNotice('Saved data cleared.');
    }
  };
}

loadState();
bindEvents();
setToday();
setMode(inputMode);
get('voice-output').checked = state.readAloud;
updateHindiVoice();
get('talk-view').hidden = reportsPage;
get('reports-view').hidden = !reportsPage;
get('new-chat').hidden = reportsPage;
if (reportsPage) {
  get('reports-link').classList.add('active');
  get('reports-link').setAttribute('aria-current', 'page');
} else {
  get('talk-link').classList.add('active');
  get('talk-link').setAttribute('aria-current', 'page');
}
renderReports();
renderMessages();
renderMeals();
renderReportPage();
updateStatus().then(function () {
  if (reportsPage && status.groq) {
    const missing = state.reports.some(function (report) {
      return !report.insights || (report.insights.labs.length === 0 && report.analysisStatus !== 'ready');
    });
    if (missing) {
      analyzeSelectedReport(true);
    }
  }
});

// A report-page action opens a useful conversation with that report selected.
const requestedReport = new URLSearchParams(window.location.search).get('report');
if (requestedReport) {
  if (requestedReport === 'all') {
    get('question').value = 'Using all my saved reports and the information I already gave you, give me 3 practical things I can do next and one useful follow-up.';
  } else {
    const report = state.reports.find(function (entry) { return entry.id === requestedReport; });
    if (report) {
      get('question').value = 'Using my report "' + report.name + '" (' + report.date + '), give me 3 practical things I can do next and one follow-up. Use the information I already gave you.';
    }
  }
}

