/**
 * DUALAI - High-Performance Circular Ring Buffer
 * Pre-allocated linear FIFO buffer for Int16 audio frames.
 * Eliminates garbage-collection pauses and audio dropouts (target 30ms frames).
 */

export class CircularAudioBuffer {
  private buffer: Int16Array
  private capacity: number
  private writeIndex: number = 0
  private readIndex: number = 0
  private availableCount: number = 0

  /**
   * @param capacity Total number of Int16 samples buffer can hold (default 16000 = 1 sec at 16kHz)
   */
  constructor(capacity: number = 16000) {
    this.capacity = capacity
    this.buffer = new Int16Array(capacity)
  }

  /**
   * Write new audio samples into circular buffer
   */
  public write(samples: Int16Array): void {
    const len = samples.length
    for (let i = 0; i < len; i++) {
      this.buffer[this.writeIndex] = samples[i]
      this.writeIndex = (this.writeIndex + 1) % this.capacity

      if (this.availableCount < this.capacity) {
        this.availableCount++
      } else {
        // Buffer overflow: advance read pointer to drop oldest sample
        this.readIndex = (this.readIndex + 1) % this.capacity
      }
    }
  }

  /**
   * Read requested number of samples into a pre-allocated array.
   * Returns true if read succeeded, false if not enough samples.
   */
  public readInto(targetArray: Int16Array): boolean {
    const len = targetArray.length
    if (this.availableCount < len) {
      return false
    }

    for (let i = 0; i < len; i++) {
      targetArray[i] = this.buffer[this.readIndex]
      this.readIndex = (this.readIndex + 1) % this.capacity
    }

    this.availableCount -= len
    return true
  }

  /**
   * Read requested number of samples returning a new Int16Array.
   */
  public read(sampleCount: number): Int16Array | null {
    if (this.availableCount < sampleCount) {
      return null
    }

    const output = new Int16Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      output[i] = this.buffer[this.readIndex]
      this.readIndex = (this.readIndex + 1) % this.capacity
    }

    this.availableCount -= sampleCount
    return output
  }

  public getAvailableSamples(): number {
    return this.availableCount
  }

  public getCapacity(): number {
    return this.capacity
  }

  public clear(): void {
    this.writeIndex = 0
    this.readIndex = 0
    this.availableCount = 0
    this.buffer.fill(0)
  }
}
