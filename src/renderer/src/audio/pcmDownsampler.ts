/**
 * DUALAI - High-Speed Linear PCM 16 kHz Downsampler
 * Converts 48 kHz / 44.1 kHz OS audio capture cleanly to 16 kHz linear16 PCM
 * before streaming to the Soniox Unified WebSocket Gateway, reducing upstream
 * bandwidth by 67% while matching Soniox's optimal speech recognition sample rate.
 */

export const TARGET_STREAM_SAMPLE_RATE = 16000

export function downsampleInt16Pcm(
  input: Int16Array,
  inputSampleRate: number,
  targetSampleRate: number = TARGET_STREAM_SAMPLE_RATE
): Int16Array {
  if (
    !input.length ||
    inputSampleRate <= targetSampleRate ||
    targetSampleRate <= 0
  ) {
    return input
  }

  const ratio = inputSampleRate / targetSampleRate
  const outputLength = Math.floor(input.length / ratio)
  if (outputLength <= 0) {
    return new Int16Array(0)
  }

  const output = new Int16Array(outputLength)

  // Fast exact integer decimation with box averaging for 48kHz -> 16kHz (ratio === 3)
  if (Math.abs(ratio - Math.round(ratio)) < 0.001) {
    const step = Math.round(ratio)
    for (let i = 0; i < outputLength; i++) {
      let sum = 0
      const base = i * step
      for (let k = 0; k < step; k++) {
        sum += input[base + k]
      }
      output[i] = Math.round(sum / step)
    }
    return output
  }

  // General linear-interpolated resampling (e.g., 44100 Hz -> 16000 Hz)
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio
    const idx0 = Math.floor(srcPos)
    const idx1 = Math.min(input.length - 1, idx0 + 1)
    const frac = srcPos - idx0
    output[i] = Math.round(input[idx0] * (1 - frac) + input[idx1] * frac)
  }

  return output
}
