/*
 * @Author:
 * @Date: 2024-10-10 14:21:08
 * @Description:
 */
import request from '@/utils/request'


export function newConversation() {
  return request({
    url: '/knowledge/model-chat/new_conversation',
    method: 'get'
  })
}


export function completion(data, signal) {
  return request({
    url: '/knowledge/model-chat/chat',
    method: 'post',
    data,
    signal,
    headers: {
      'Content-Type': 'text/event-stream'
    }
  })
}

export function queryAiBy(data) {
  return request({
    url: '/dap/aiAnalysisModel/queryAiBy',
    method: 'post',
    data,

  })
}

export function queryIdeaById(data) {
  return request({
    url: '/dap/aiAnalysisModel/queryIdeaById',
    method: 'post',
    data,

  })
}

export function queryAiModelByModelId(params) {
  return request({
    url: '/dap/aiAnalysisModel/queryAiModelByModelId',
    method: 'get',
    params,

  })
}

export function saveOrUpdateTechnicalIdeasBy(data) {
  return request({
    url: '/dap/aiAnalysisModel/saveOrUpdateTechnicalIdeasBy',
    method: 'post',
    data,

  })
}

export function generateSql(data, signal) {
  return request({
    url: `/dap/aiTrainScript/generate-sql`,
    method: 'post',
    data,
    signal,

  })
}

export function queryBysql(data) {
  return request({
    url: `/dap/aiAnalysisModel/queryBysql`,
    method: 'post',
    data,

  })
}

export function getByInsertSql(data) {
  return request({
    url: `/dap/aiAnalysisModel/getByInsertSql`,
    method: 'post',
    data,

  })
}
