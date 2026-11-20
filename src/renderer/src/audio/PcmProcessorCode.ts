/**
 * DUALAI - AudioWorklet Processor Source Code
 * Runs off the main thread in the dedicated audio rendering pipeline.
 * Performs real-time Float32 to Int16 linear PCM conversion and RMS/Peak dB telemetry.
 */

export const PCM_PROCESSOR_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channelId = (options && options.processorOptions && options.processorOptions.channelId) || 'channel_a';
    this.bufferSize = 128; // Standard Web Audio render quantum
    this.int16Buffer = new Int16Array(this.bufferSize);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];
    const len = channelData.length;

    let sumSquares = 0;
    let peak = 0;

    if (this.int16Buffer.length !== len) {
      this.int16Buffer = new Int16Array(len);
    }

    for (let i = 0; i < len; i++) {
      let sample = channelData[i];

      // Measure Peak & RMS
      const absSample = Math.abs(sample);
      if (absSample > peak) {
        peak = absSample;
      }
      sumSquares += sample * sample;

      // Hard clamp to prevent 16-bit integer overflow wrap-around distortion
      if (sample > 1.0) sample = 1.0;
      else if (sample < -1.0) sample = -1.0;

      // Convert Float32 [-1.0, 1.0] to signed Int16 [-32768, 32767]
      this.int16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    const rms = Math.sqrt(sumSquares / len);
    const rmsDb = rms > 0.00001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
    const peakDb = peak > 0.00001 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
    const isClipping = peak >= 0.999;

    // Post PCM chunk and telemetry
    this.port.postMessage({
      type: 'pcm-data',
      channelId: this.channelId,
      pcmData: this.int16Buffer.slice().buffer,
      rmsDb: Math.round(rmsDb * 10) / 10,
      peakDb: Math.round(peakDb * 10) / 10,
      isClipping,
      timestampMs: currentTime * 1000
    }, [this.int16Buffer.slice().buffer]);

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
`
