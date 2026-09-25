/**
 * 语音服务：语音转文字（SenseVoice）+ 浏览器文字转语音播报
 */
class VoiceService {
  constructor() {
    this.appId = import.meta.env.VITE_SENSEVOICE_API_ID || ''
    this.apiSecret = import.meta.env.VITE_SENSEVOICE_API_SECRET || ''
    this.apiUrl = import.meta.env.VITE_SENSEVOICE_API_URL || '/sensevoice/api/v3/auc/bigmodel/recognize/flash'
  }
/**
   * 生成UUID
   * @returns {string} UUID字符串
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }
  /**
   * 将 Blob 转为 Base64 字符串
   * @param {Blob} blob - 音频 Blob
   * @returns {Promise<string>} Base64 字符串
   */
  async base64Encode(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * 语音转文字 - 发送音频到 SenseVoice 接口
   * @param {Blob} audioBlob - WAV 音频文件
   * @returns {Promise<string>} 识别结果文本
   */
  async transcribe(audioBlob) {
    return new Promise(async (resolve, reject) => {
       // 构建请求数据
      const base64Data = await this.base64Encode(audioBlob)
      const reqData = {
        "user": {
          "uid": this.appId
        },
        "audio": {
          "data": base64Data
        },
        "request": {
          "model_name": "bigmodel"
        }
      }
       const xhr = new XMLHttpRequest()
      xhr.open('POST', this.apiUrl, true)
      
    // "X-Api-App-Key": appid,
    // "X-Api-Access-Key": token,
    //   xhr.setRequestHeader('X-Api-Key', this.appId)
      xhr.setRequestHeader('X-Api-App-Key', this.appId)
      xhr.setRequestHeader('X-Api-Access-Key', this.apiSecret)
      xhr.setRequestHeader('X-Api-Resource-Id', 'volc.bigasr.auc_turbo')
      xhr.setRequestHeader('X-Api-Request-Id', this.generateUUID())
      xhr.setRequestHeader('X-Api-Sequence', '-1')
      xhr.setRequestHeader('Content-Type', 'application/json')
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            // 适配新的返回格式
            // 返回格式: { audio_info: { duration: 2499 }, result: { text: "...", utterances: [...] } }
            if (response.result && response.result.text) {
              // 返回完整的识别结果对象，包含详细信息
              const resultData = {
                // 完整文本
                text: response.result.text,
                // 音频时长（毫秒）
                duration: response.audio_info?.duration || 0,
                // 分句信息
                utterances: response.result.utterances?.map(utterance => ({
                  // 该句文本
                  text: utterance.text,
                  // 开始时间（毫秒）
                  startTime: utterance.start_time,
                  // 结束时间（毫秒）
                  endTime: utterance.end_time,
                  // 分词信息
                  words: utterance.words?.map(word => ({
                    text: word.text,
                    startTime: word.start_time,
                    endTime: word.end_time,
                    confidence: word.confidence || 0
                  })) || []
                })) || []
              }
              resolve(resultData.text)
            } else {
              reject(new Error('服务器返回格式错误：缺少 result.text 字段'))
            }
          } catch (error) {
            reject(new Error('解析响应失败: ' + error.message))
          }
        } else {
          reject(new Error('请求失败，状态码: ' + xhr.status))
        }
      }

      xhr.onerror = () => {
        reject(new Error('网络连接失败'))
      }

      xhr.ontimeout = () => {
        reject(new Error('请求超时，请稍后重试'))
      }

      xhr.timeout = 60000
      xhr.send(JSON.stringify(reqData))
    })
  }

  /**
   * 文字转语音播报（浏览器 SpeechSynthesis API）
   * @param {string} text - 需要播报的文字
   */
  speakText(text) {
    return new Promise((resolve) => {
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.8
      utterance.pitch = 1
      utterance.volume = 1;    // 最大音量

      // 3. 选择声音并添加事件监听 (需要等待语音列表加载完成)
      // window.speechSynthesis.onvoiceschanged = () => {
      //     const voices = window.speechSynthesis.getVoices();
      //     console.error(voices)
      //     // const chineseVoice = voices.find(voice => voice.lang === 'zh-CN');
      //     const chineseVoice = voices[2];
      //     if (chineseVoice) {
      //         utterance.voice = chineseVoice; // 使用找到的第一个中文声音
      //     }


      // utterance.onend = () => resolve()
      // utterance.onerror = () => resolve() // 即使出错也 resolve，不阻塞流程

      // window.speechSynthesis.speak(utterance)
      // };

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve() // 即使出错也 resolve，不阻塞流程

      window.speechSynthesis.speak(utterance)
    })
  }

  /**
   * 停止语音播报
   */
  stopSpeaking() {
    window.speechSynthesis.cancel()
  }
}

export default new VoiceService()
