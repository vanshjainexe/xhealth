// Actual voice functions, fake devices. No real microphone is captured.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const buttons = {};
const turns = [];
let stopped = 0;
let played = 0;
let processor;
let socket;
const context = {
  busy: false, speechSession: 1, cancelVoiceAudio: null,
  audioPlayer: null, cancelHindiSpeech: null, speechQueue: Promise.resolve(),
  status: { deepgram: true, groq: true },
  state: { reports: [], meals: [], messages: [] },
  window: { location: { host: 'localhost:3000' } },
  navigator: { mediaDevices: { getUserMedia: async function () {
    return { getTracks: function () { return [{ stop: function () { stopped = stopped + 1; } }]; } };
  } } },
  get: function (id) {
    if (!buttons[id]) { buttons[id] = { disabled: false, textContent: '', checked: true }; }
    return buttons[id];
  },
  openVoice: function () {}, stopAudio: function () {},
  setVoiceState: function () {}, showNotice: function () {},
  handleMessage: async function (text, voice) { turns.push({ text: text, voice: voice }); },
  WebSocket: class {
    static OPEN = 1;
    constructor() { socket = this; this.readyState = 1; this.sent = []; }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
  },
  AudioWorkletNode: class {
    constructor() { processor = this; this.port = {}; }
    connect() {}
  },
  AudioContext: class {
    constructor() { this.sampleRate = 48000; this.audioWorklet = { addModule: async function () {} }; }
    async resume() {}
    close() {}
    createMediaStreamSource() { return { connect: function () {} }; }
    createGain() { return { gain: {}, connect: function () {} }; }
    async decodeAudioData(data) { assert.ok(data.byteLength > 0); return {}; }
    createBufferSource() {
      return { connect: function () {}, disconnect: function () {}, start: function () {
        played = played + 1;
        this.onended();
      } };
    }
  }
};
const app = fs.readFileSync('public/app.js', 'utf8');
const functions = app.slice(app.indexOf('function setBusy('), app.indexOf('function cleanReply('));
const voice = fs.readFileSync('public/voice.js', 'utf8');
vm.runInNewContext(functions + voice + '\nthis.active = function () { return conversationActive; };', context);

async function verify() {
  assert.equal(context.makeContext('Typed English', false).voice, false);
  assert.equal(context.makeContext('Spoken Hindi', true).voice, true);
  await context.toggleMicrophone();
  assert.equal(context.active(), true);
  context.setBusy(true);
  assert.equal(buttons['orb-mic'].disabled, false);
  assert.equal(buttons['mic-button'].disabled, false);
  assert.equal(buttons['send-button'].disabled, true);
  socket.onmessage({ data: JSON.stringify({ type: 'Ready' }) });
  processor.port.onmessage({ data: new Int16Array([100, 200]).buffer });
  assert.ok(new Int16Array(socket.sent[0]).every(function (sample) { return sample === 0; }));
  context.setBusy(false);
  await context.receiveVoiceTurn({ type: 'TurnInfo', event: 'Update', transcript: 'I ate', turn_index: 0 }, 1);
  assert.equal(turns.length, 0);
  const final = { type: 'TurnInfo', event: 'EndOfTurn', transcript: 'I ate two rotis.', turn_index: 0 };
  await context.receiveVoiceTurn(final, 1);
  await context.receiveVoiceTurn(final, 1);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].voice, true);
  await context.receiveVoiceTurn({ ...final, transcript: 'What about dinner?', turn_index: 1 }, 1);
  assert.equal(turns.length, 2);
  await context.playVoiceBuffer(new Blob(['test audio']), 1);
  assert.equal(played, 1);
  await context.toggleMicrophone();
  assert.equal(context.active(), false);
  assert.equal(stopped, 1);
  assert.equal(socket.readyState, 3);
  assert.equal(buttons['orb-mic'].textContent, 'Start talking');
  console.log('Automatic turns, playback, English text mode, End controls and cleanup: passed');
}
verify().catch(function (error) { console.error(error.message); process.exitCode = 1; });
