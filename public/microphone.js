// Collect 80 ms of microphone samples, then send 16-bit PCM to the page.
class MicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(Math.round(sampleRate * 0.08));
    this.position = 0;
  }

  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) {
      return true;
    }
    for (const sample of channel) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.position] = Math.round(value * 32767);
      this.position = this.position + 1;
      if (this.position === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(Math.round(sampleRate * 0.08));
        this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('microphone', MicrophoneProcessor);
