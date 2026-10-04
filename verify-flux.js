// Real Flux connection, two synthetic spoken turns, automatic turn endings.
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const textToWav = require('text2wav');

async function makeAudio(text) {
  const wav = Buffer.from(await textToWav(text, { voice: 'en', speed: 150 }));
  let sampleRate = 22050;
  let samples;
  for (let offset = 12; offset + 8 < wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (name === 'fmt ') { sampleRate = wav.readUInt32LE(offset + 12); }
    if (name === 'data') { samples = wav.subarray(offset + 8, offset + 8 + size); break; }
    offset = offset + 8 + size + size % 2;
  }
  assert.ok(samples);
  const count = Math.floor(samples.length / 2 * 16000 / sampleRate);
  const pcm = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index = index + 1) {
    const original = Math.floor(index * sampleRate / 16000);
    pcm.writeInt16LE(samples.readInt16LE(original * 2), index * 2);
  }
  return pcm;
}

async function verify() {
  const audio = [await makeAudio('For lunch I ate two burgers and one bowl of dal.'), await makeAudio('What should I eat for dinner?')];
  await new Promise(function (resolve, reject) {
    const socket = new WebSocket('ws://localhost:3000/api/voice?sample_rate=16000');
    let turn = 0;
    let offset = 0;
    let timer;
    const timeout = setTimeout(function () { finish(new Error('Flux did not finish both turns in time.')); }, 45000);
    function finish(error) {
      clearInterval(timer);
      clearTimeout(timeout);
      socket.close();
      if (error) { reject(error); } else { resolve(); }
    }
    socket.on('error', finish);
    socket.on('message', function (data) {
      const event = JSON.parse(data.toString());
      if (event.type === 'Error') { finish(new Error(event.message)); }
      if (event.type === 'Ready') {
        console.log('Flux multilingual authenticated connection: passed');
        timer = setInterval(function () {
          const chunk = Buffer.alloc(2560);
          if (turn < audio.length && offset < audio[turn].length) {
            audio[turn].copy(chunk, 0, offset, offset + chunk.length);
            offset = offset + chunk.length;
          }
          if (socket.readyState === WebSocket.OPEN) { socket.send(chunk); }
        }, 80);
      }
      if (event.type === 'TurnInfo' && event.event === 'EndOfTurn' && event.transcript.trim()) {
        console.log('Automatic spoken turn ' + (turn + 1) + ': ' + event.transcript);
        assert.ok(event.transcript.length > 10);
        assert.notEqual(event.trigger, 'manual');
        turn = turn + 1;
        offset = 0;
        if (turn === audio.length) { finish(); }
      }
    });
  });
  console.log('Continuous Flux conversation, no Finish button: passed');
}
verify().catch(function (error) { console.error(error.message); process.exitCode = 1; });
