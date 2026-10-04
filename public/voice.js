// Flux listens continuously. Each finished turn uses the same chat and meal functions.
let conversationActive = false;
let voicePaused = false;
let voiceSocket = null;
let voiceContext = null;
let microphone = null;
let lastVoiceTurn = -1;
let voiceGeneration = 0;

async function playVoiceBuffer(blob, session) {
  const context = voiceContext;
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (session !== speechSession || context !== voiceContext) {
    return;
  }
  await context.resume();
  const speaker = context.createBufferSource();
  speaker.buffer = buffer;
  speaker.connect(context.destination);
  setVoiceState('speaking', 'xhealth is speaking');
  await new Promise(function (resolve) {
    function finish() {
      cancelVoiceAudio = null;
      speaker.disconnect();
      resolve();
    }
    speaker.onended = finish;
    cancelVoiceAudio = function () {
      speaker.stop();
      finish();
    };
    speaker.start();
  });
}

function endConversation() {
  voiceGeneration = voiceGeneration + 1;
  conversationActive = false;
  voicePaused = false;
  if (voiceSocket) {
    voiceSocket.close();
    voiceSocket = null;
  }
  if (microphone) {
    for (const track of microphone.getTracks()) {
      track.stop();
    }
    microphone = null;
  }
  if (voiceContext) {
    voiceContext.close();
    voiceContext = null;
  }
  get('orb-mic').textContent = 'Start talking';
  get('orb-mic').disabled = busy;
  get('mic-button').textContent = '◉ Speak';
  get('mic-button').disabled = busy;
  get('voice-status').textContent = '';
  get('voice-transcript').textContent = '';
  stopAudio();
}

async function receiveVoiceTurn(event, generation) {
  if (!conversationActive || generation !== voiceGeneration || busy || voicePaused) {
    return;
  }
  if (event.type !== 'TurnInfo') {
    return;
  }
  if (event.event === 'StartOfTurn' || event.event === 'Update') {
    setVoiceState('listening', 'सुन रहा है…');
    get('voice-transcript').textContent = event.transcript || '';
  }
  if (event.event !== 'EndOfTurn' || !String(event.transcript || '').trim() || event.turn_index === lastVoiceTurn) {
    return;
  }
  lastVoiceTurn = event.turn_index;
  voicePaused = true;
  get('voice-transcript').textContent = '';
  try {
    await handleMessage(event.transcript, true);
    await speechQueue;
  } finally {
    if (conversationActive && generation === voiceGeneration) {
      voicePaused = false;
      setVoiceState('listening', 'सुन रहा है…');
    }
  }
}

async function toggleMicrophone() {
  if (conversationActive) {
    endConversation();
    return;
  }
  if (busy) {
    return;
  }
  if (!status.deepgram || !status.groq) {
    openSettings(true);
    showNotice('Connect Groq and Deepgram to start a voice conversation.');
    return;
  }
  const generation = voiceGeneration + 1;
  voiceGeneration = generation;
  conversationActive = true;
  openVoice();
  get('orb-mic').textContent = 'End conversation';
  get('mic-button').textContent = '■ End voice';
  setVoiceState('thinking', 'Opening microphone…');
  try {
    voiceContext = new AudioContext();
    await voiceContext.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (generation !== voiceGeneration) {
      for (const track of stream.getTracks()) { track.stop(); }
      return;
    }
    microphone = stream;
    await voiceContext.audioWorklet.addModule('/microphone.js');
    if (generation !== voiceGeneration) {
      return;
    }
    const source = voiceContext.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(voiceContext, 'microphone');
    const mute = voiceContext.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(voiceContext.destination);
    await voiceContext.resume();
    const socket = new WebSocket('ws://' + window.location.host + '/api/voice?sample_rate=' + voiceContext.sampleRate);
    voiceSocket = socket;
    let ready = false;
    processor.port.onmessage = function (event) {
      if (!ready || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      // Send silence while the agent replies so its speaker audio is not logged as a meal.
      if (busy || voicePaused || audioPlayer || cancelHindiSpeech || cancelVoiceAudio) {
        socket.send(new ArrayBuffer(event.data.byteLength));
      } else {
        socket.send(event.data);
      }
    };
    socket.onmessage = function (message) {
      if (generation !== voiceGeneration) {
        return;
      }
      const event = JSON.parse(message.data);
      if (event.type === 'Ready') {
        ready = true;
        lastVoiceTurn = -1;
        setVoiceState('listening', 'सुन रहा है…');
      } else if (event.type === 'Error') {
        showNotice(event.message);
        endConversation();
      } else {
        receiveVoiceTurn(event, generation);
      }
    };
    socket.onerror = function () {
      if (generation === voiceGeneration) {
        showNotice('Voice connection failed. Start talking again or type your message.');
        endConversation();
      }
    };
    socket.onclose = function () {
      if (generation === voiceGeneration && conversationActive) {
        showNotice('Voice connection closed. Tap Start talking to reconnect.');
        endConversation();
      }
    };
  } catch (error) {
    if (generation === voiceGeneration) {
      showNotice('Microphone unavailable. Allow microphone access and try Start talking again.');
      endConversation();
    }
  }
}
