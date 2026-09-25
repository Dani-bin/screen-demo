/**
 * 音频录制工具类
 * 录制麦克风音频并转换为 WAV 格式
 */
class AudioRecorder {
  constructor() {
    this.audioContext = null
    this.stream = null
    this.audioChunks = []
    this.isRecording = false
    this.processor = null

    this.config = {
      sampleRate: 16000,
      channelCount: 1,
      bufferSize: 4096
    }
  }

  async initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.config.sampleRate
      })
      return true
    } catch (error) {
      console.error('初始化音频上下文失败:', error)
      throw error
    }
  }

  async getMicrophonePermission() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: this.config.channelCount,
          sampleRate: this.config.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      return true
    } catch (error) {
      console.error('获取麦克风权限失败:', error)
      throw error
    }
  }

  async startRecording(onError) {
    try {
      if (this.isRecording) return

      this.audioChunks = []

      await this.initAudioContext()
      await this.getMicrophonePermission()

      const source = this.audioContext.createMediaStreamSource(this.stream)
      const processor = this.audioContext.createScriptProcessor(
        this.config.bufferSize,
        this.config.channelCount,
        this.config.channelCount
      )

      processor.onaudioprocess = (event) => {
        if (!this.isRecording) return
        const inputData = event.inputBuffer.getChannelData(0)
        const pcmData = this.floatTo16BitPCM(inputData)
        this.audioChunks.push(new Uint8Array(pcmData))
      }

      source.connect(processor)
      processor.connect(this.audioContext.destination)

      this.processor = processor
      this.isRecording = true
      console.log('开始录制音频')
    } catch (error) {
      console.error('开始录制失败:', error)
      if (onError) onError(error)
      throw error
    }
  }

  async stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.isRecording) {
        reject(new Error('未在录制中'))
        return
      }

      this.isRecording = false

      if (this.processor) {
        this.processor.disconnect()
        this.processor = null
      }

      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop())
        this.stream = null
      }

      if (this.audioContext) {
        this.audioContext.close()
        this.audioContext = null
      }

      console.log('停止录制音频')

      try {
        const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of this.audioChunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }

        const wavBuffer = this.pcmToWav(combined.buffer)
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
        resolve(audioBlob)
      } catch (error) {
        console.error('处理音频数据失败:', error)
        reject(error)
      }
    })
  }

  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    return output.buffer
  }

  createWavHeader(pcmData, sampleRate, numChannels, bitsPerSample) {
    const buffer = new ArrayBuffer(44)
    const view = new DataView(buffer)

    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + pcmData.byteLength, true)
    writeString(view, 8, 'WAVE')

    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true)
    view.setUint16(32, numChannels * bitsPerSample / 8, true)
    view.setUint16(34, bitsPerSample, true)

    writeString(view, 36, 'data')
    view.setUint32(40, pcmData.byteLength, true)

    return buffer
  }

  pcmToWav(pcmData, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
    const wavHeader = this.createWavHeader(pcmData, sampleRate, numChannels, bitsPerSample)
    const wavFile = new Uint8Array(wavHeader.byteLength + pcmData.byteLength)
    wavFile.set(new Uint8Array(wavHeader), 0)
    wavFile.set(new Uint8Array(pcmData), wavHeader.byteLength)
    return wavFile.buffer
  }

  static isSupported() {
    return !!(navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext))
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

export default AudioRecorder
