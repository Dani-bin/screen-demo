/**
 * AI 对话函数调用处理器
 * 统一处理各种操作类型的执行逻辑
 */
  //页面名称映射 天气地图、态势分析、指挥调度、视频中心、视频会议、专项指挥
  //按钮名称映射 台风、雨量、云图、应急物资、避难场所、医院、救援队伍、低洼地带、闸口、设施大棚、高空构建、高空作业、海堤、积涝点、CD级危房、河道堤防、人员转移、人员疏散、周边风险、周边视频、通讯录、队伍调度、物资调度


import router from '@/router'
import EventBus from '@/utils/event-bus'

// ==================== 事件名称 ====================
const EVENT_NAMES = {
  // 页面跳转后执行操作
  EXECUTE_AFTER_NAVIGATION: 'executeAfterNavigation'
}

// ==================== 操作映射 ====================
// 这些按钮对应不同的功能操作
const ACTION_MAP = {
  // 分类展示类按钮 - 触发地图分类显示
  '天气地图': {type:'page',route:'TyphoonWeatherMap'},
  '态势分析': {type:'page',route:'TyphoonSituationAnalysis'},
  '指挥调度': {type:'page',route:'TyphoonCommandDispatch'},
  '视频中心': {type:'page',route:'TyphoonVideoCenter'},
  '视频会议': {type:'page',route:'TyphoonVideoMeeting'},  // 待实现
  '专项指挥': {type:'page',route:'TyphoonSpecialCommand'},
  
  '台风': { type:'action', category: 'toggleCategory',key:"typhoon" },
  '雨量': { type:'action', category: 'toggleCategory',key:"rainfall" },
  '云图': { type:'action', category: 'toggleCategory',key:"cloud" },
  '应急物资': { type:'action', category: 'toggleCategory',key:"emergency_materials" }, 
  '避难场所': { type:'action', category: 'toggleCategory',key:"shelter" },
  '医院': { type:'action', category: 'toggleCategory',key:"hospital" },
  '救援队伍': { type:'action', category: 'toggleCategory',key:"rescue_team" },
  '闸口': { type:'action', category: 'toggleCategory',key:"sluice_gate" },
  // '设施大棚': { type:'action', category: 'toggleCategory',key:"greenhouse" },
  // '高空构建': { type:'action', category: 'toggleCategory',key:"high_altitude_construction" },
  // '高空作业': { type:'action', category: 'toggleCategory',key:"high_altitude_operations" },
  // '积涝点': { type:'action', category: 'toggleCategory',key:"waterlogging_point" },
  // '低洼地带': { type:'action', category: 'toggleCategory',key:"low_lying_area" },
  '海堤': { type:'action', category: 'toggleCategory',key:"seawall" },
  'CD级危房': { type:'action', category: 'toggleCategory',key:"dangerous_house" },
  '河道堤防': { type:'action', category: 'toggleCategory',key:"river_embankment" },
  '人员转移': { type:'action', category: 'toggleCategory',key:"personnel_transfer" },
  '人员疏散': { type:'action', category: 'toggleCategory',key:"personnel_evacuation" },
  
  // 功能操作类按钮
  '周边风险': { type:'action', category: 'toggleCategory',key:"peripheral_risk" },
  '周边视频': { type:'action', category: 'toggleCategory',key:"peripheral_video" },
  '通讯录': { type:'action', category: 'toggleCategory',key:"contacts" },
  '队伍调度': { type:'action', category: 'toggleCategory',key:"dispatch_teams" },
  '物资调度': { type:'action', category: 'toggleCategory',key:"dispatch_materials" },
  '应急响应弹窗': { type:'action', category: 'toggleCategory',key:"open_emergency_response_popup" }
}


/**
 * 根据按钮名称获取对应的操作配置
 * @param {string} buttonName 按钮名称
 * @returns {Object|null} 操作配置
 */
export function getButtonAction(buttonName) {
  if (!buttonName) return null
  return BUTTON_ACTION_MAP[buttonName] || null
}

/**
 * 跳转到指定页面或执行操作
 * @param {Object} params 参数
 * @param {string} params.to 目标页面/操作名称
 * @returns {boolean} 是否执行成功
 */
export function navigateTo({ to,targetPage } = {}) {
  try {
    const actionConfig = ACTION_MAP[to]
    
    if (!actionConfig) {
      console.warn(`[ActionHandler] 未找到操作: ${to}`)
      return false
    }
    
    if (actionConfig.type === 'page') {
      if(to === '专项指挥'){
        //判断全局是否有专项预案的启动状态
        EventBus.emit('startZXyuan')
        return true
      }
      // 页面跳转
      router.push({ name: actionConfig.route })
      console.log(`[ActionHandler] 页面跳转成功: ${actionConfig.route}`)
      return true
    } else if (actionConfig.type === 'action') {
      // 执行操作函数
      const functionName = actionConfig.category
      const actionFunction = ACTION_FUNCTION_MAP[functionName]
      if (actionFunction && typeof actionFunction === 'function') {
        console.log(`[ActionHandler] 执行操作函数: ${functionName}`)
        actionFunction(actionConfig.key,targetPage)
        return true
      } else {
        console.warn(`[ActionHandler] 未找到操作函数: ${functionName}`)
        return false
      }
    } else {
      console.warn(`[ActionHandler] 操作未训练: ${to}`)
      return false
    }
  } catch (error) {
    console.error(`[ActionHandler] 执行失败:`, error)
    return false
  }
}


export function openVideosTo({ videoNameKeys } = {}) {
  try {
    //判断当前所在页面，如果是在视频中心，直接打开分屏监控，然后通过关键字过滤视频名称，然后再自动打开视频
    const currentPage = getCurrentRouteName()
    if(currentPage === 'TyphoonVideoCenterSplitScreenMonitoring'){
      //直接执行打开视频操作函数
      return navigateAndExecute(currentPage, 'openVideoBykeys', {keys:videoNameKeys})
    }
    return navigateAndExecute('TyphoonVideoCenterSplitScreenMonitoring', 'openVideoBykeys', {keys:videoNameKeys})
  } catch (error) {
    console.error(`[ActionHandler] 执行失败:`, error)
    return false
  }
}

export function startPlanTo({ planName } = {}) {
  try {
    //判断当前所在页面，
    const currentPage = getCurrentRouteName()
    //如果是在专项指挥页面，则通过语音提示预案已经启动
    if(currentPage === 'TyphoonSpecialCommand'){
      if(planName.indexOf('火灾') >= 0){
        return true
      }else if(planName.indexOf('台') >= 0 || planName.indexOf('风') >= 0){
        return navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:'contacts'})
      }else{
        return true
      }
    }else if(currentPage === 'TyphoonSituationAnalysis' || currentPage === 'TyphoonCommandDispatch'){
      if(planName.indexOf('火灾') >= 0){
        // 启动火灾预案
        return navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:'contacts'})
      }else if(planName.indexOf('台') >= 0 || planName.indexOf('风') >= 0){
        return true
      }
    }
    if(currentPage === 'TyphoonVideoCenterSplitScreenMonitoring'){
      //直接执行打开视频操作函数
      return navigateAndExecute(currentPage, 'openVideoBykeys', {keys:videoNameKeys})
    }
    return navigateAndExecute('TyphoonVideoCenterSplitScreenMonitoring', 'openVideoBykeys', {keys:videoNameKeys})
  } catch (error) {
    console.error(`[ActionHandler] 执行失败:`, error)
    return false
  }
}

/**
 * 执行 AI 函数调用
 * @param {Object} resData AI回复的数据
 * @returns {Object} 执行结果 { success: boolean, message: string, data?: any }
 */
export async function executeAction(resData = {}) {
  console.log(`[ActionHandler] 执行操作:`, { resData })
  const success = false;
  switch (resData.action) {
    case 'navigate':
      // navigate 操作需要一个目标页面关键词
      const to = resData.to
      const targetPage = resData.targetPage
      if (!to) {
        return { 
          success: false, 
          message: '未指定跳转目标页面' 
        }
      }
      const success = navigateTo({ to,targetPage })
      
      return {
        success,
        message: success ? `正在跳转到${to}...` : `未找到页面: ${to}`,
        data: { to }
      }
          
    case 'openVideos':
      // TODO: 打开视频
      let videoNameKeys = resData.to
      if (!videoNameKeys) {
        videoNameKeys = "物资库"
      }
      videoNameKeys = videoNameKeys.replaceAll(/\s+/g, ',')
      const videoSuccess = openVideosTo({ videoNameKeys })
      return {
        success: videoSuccess,
        message: videoSuccess ? `正在打开${videoNameKeys}视频` : `未找到视频资源，无法打开页面: ${videoNameKeys}`,
        data: { videoNameKeys }
      }
    
    case 'startMaterialTask':
      // TODO: 执行物资调度任务
      return {
        success: false,
        message: '物资调度任务功能待实现'
      }
    
    case 'startTeamsTask':
      // TODO: 执行队伍调度任务
      return {
        success: false,
        message: '队伍调度任务功能待实现'
      }
    
    case 'startTask':
      // TODO: 执行普通任务
      return {
        success: false,
        message: '普通任务功能待实现'
      }
    
    case 'startPlan':
      // TODO: 执行预案
      let planName = resData.to
      if (!planName) {
        planName = "启动火灾应急预案I级响应"
      }
      planName = planName.trim()
      var resContentData = {
        success: false,
        message: '',
        data: {}
      }
      try {
          //判断当前所在页面，
          const currentPage = getCurrentRouteName()
          //如果是在专项指挥页面，则通过语音提示预案已经启动
          if(currentPage === 'TyphoonSpecialCommand'){
            if(planName.indexOf('火灾') >= 0){
              resContentData.success = true
              resContentData.message = `${planName}预案已经启动。`
            }else if(planName.indexOf('台') >= 0 || planName.indexOf('风') >= 0){
              resContentData.success = navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:'contacts'})
              resContentData.message = `${planName}预案已经启动，跳转到态势分析页面。`
            }else{
              resContentData.success = false
              resContentData.message = `预案未训练！`
            }
          }else{
            if(planName.indexOf('火灾') >= 0){
              // 启动火灾预案
              //resContentData.success = navigateAndExecute('TyphoonSpecialCommand', 'category', {category:'contacts'})
              //判断全局是否有专项预案的启动状态
              EventBus.emit('startFirePlan')
              resContentData.message = `${planName}预案已经启动，跳转到专项指挥页面。`
            }else if(planName.indexOf('台') >= 0 || planName.indexOf('风') >= 0){
              resContentData.success = true
              resContentData.message = `${planName}预案已经启动。`
            }else{
              resContentData.success = false
              resContentData.message = `预案未训练！`
            }
          }
          
        } catch (error) {
          console.error(`[ActionHandler] 执行失败:`, error)
          resContentData.success = false
          resContentData.message = `执行预案失败: ${error.message}`
        }
        resContentData.data.planName = planName
        return resContentData
    case 'dispatchTeams':
      // TODO: 执行队伍调度
      return {
        success: false,
        message: '队伍调度功能待实现'
      }
    
    case 'dispatchMaterials':
      // TODO: 执行物资调度
      return {
        success: false,
        message: '物资调度功能待实现'
      }
    
    default:
      return {
        success: false,
        message: `未知操作类型: ${action}`
      }
  }
}

/**
 * 获取当前所在页面的路由名称
 * @returns {string} 当前页面的路由名称
 */
export function getCurrentRouteName() {
  return router.currentRoute.value.name || 'default'
}

/**
 * 页面跳转后执行操作
 * @param {string} targetRouteName 目标路由名称
 * @param {Function} executeFunction 要执行的函数
 * @param {Object} params 函数参数
 * @returns {Object} 执行结果
 */
export function navigateAndExecute(targetRouteName, executeFunction, params = {}) {
  const currentRouteName = getCurrentRouteName()
  if (currentRouteName === targetRouteName) {
    // 如果已经在目标页面，直接执行
    EventBus.emit(targetRouteName+'-'+EVENT_NAMES.EXECUTE_AFTER_NAVIGATION, {
      targetRouteName,
      functionName: executeFunction,
      params
    })
  }else{
    // 生成唯一标识，用于区分不同的导航请求
    const navId = Date.now() + Math.random()
    console.log('[导航] 开始导航到', targetRouteName, 'navId:', navId)
    
    // 使用 afterEach 路由守卫处理导航完成后的逻辑
    const unregister = router.afterEach((to, from) => {
      console.log('[导航] afterEach', to.name, '===', targetRouteName, '?', to.name === targetRouteName)
      if (to.name === targetRouteName) {
        console.log('[导航] 路由切换完成, navId:', navId)
        // 延迟一点确保组件已挂载
        setTimeout(() => {
          EventBus.emit(targetRouteName+'-'+EVENT_NAMES.EXECUTE_AFTER_NAVIGATION, {
            targetRouteName,
            functionName: executeFunction,
            params,
            navId
          })
        }, 100)
        unregister() // 取消路由守卫注册
      }
    })
    
    router.push({ name: targetRouteName })
  }
  return {
    success: true,
    message: `正在跳转到${targetRouteName}，加载完成后将自动执行操作`,
    data: { targetRouteName, functionName: executeFunction.name }
  }
}
/**
 * 点位分类的通用处理函数
 */
export function toggleCategory(category,targetPage) {
  //判断当前是否在天气地图或者视频中心或者视频会议页面
  const currentRouteName = getCurrentRouteName()
  if (category === 'typhoon' || category === 'rainfall' || category === 'cloud') {
    //直接打开应急物资功能
    return navigateAndExecute('TyphoonWeatherMap', 'category', {category:category})
  }else{
    if(
      category === 'emergency_materials' || category === 'shelter' || category === 'hospital' || category === 'rescue_team'
    ){
      if (currentRouteName === 'TyphoonWeatherMap' || currentRouteName === 'TyphoonVideoCenter' || currentRouteName === 'TyphoonVideoMeeting') {
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:category})
      }else{
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }
    }else if(
      category === 'seawall' || category === 'sluice_gate'
      || category === 'dangerous_house' || category === 'river_embankment' || category === 'personnel_transfer' 
    ){
      if (currentRouteName === 'TyphoonCommandDispatch' || currentRouteName === 'TyphoonSituationAnalysis' ) {
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }else{
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:category})
      }
    }else if(
      category === 'personnel_evacuation' || category === 'peripheral_risk' || category === 'peripheral_video'
    ){
      if (currentRouteName === 'TyphoonSpecialCommand') {
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }else{
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonSpecialCommand', 'category', {category:category})
      }
    }else if(
      category === 'dispatch_materials'
    ){
      if (currentRouteName === 'TyphoonSpecialCommand' || currentRouteName === 'TyphoonCommandDispatch') {
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }else{
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonCommandDispatch', 'category', {category:category})
      }
    }else if(
      category === 'dispatch_teams'
    ){
      if (targetPage) {
        //直接打开应急物资功能
        return navigateAndExecute(targetPage, 'category', {category:category})
      }else{
        if (currentRouteName === 'TyphoonSpecialCommand' || currentRouteName === 'TyphoonCommandDispatch') {
          //直接打开应急物资功能
          return navigateAndExecute(currentRouteName, 'category', {category:category})
        }else{
          //需要跳转到态势分析页面，然后打开应急物资功能
          return navigateAndExecute('TyphoonCommandDispatch', 'category', {category:category})
        }
      }
    }else if(category === 'contacts'){
      if (currentRouteName === 'TyphoonSituationAnalysis') {
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }else{
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonSituationAnalysis', 'category', {category:category})
      }
    }else if(category === 'open_emergency_response_popup'){
      if (currentRouteName === 'TyphoonCommandDispatch') {
        //直接打开应急物资功能
        return navigateAndExecute(currentRouteName, 'category', {category:category})
      }else{
        //需要跳转到态势分析页面，然后打开应急物资功能
        return navigateAndExecute('TyphoonCommandDispatch', 'category', {category:category})
      }
    }
  }
  
}
// ==================== 操作函数映射表 ====================
// 将 ACTION_MAP 中的 category 映射到实际的函数
const ACTION_FUNCTION_MAP = {
  toggleCategory
}

/**
 * 执行多个 action（支持数组和单个 action）
 * @param {Array|Object} actions - 单个 action 对象或 action 数组
 * @returns {Object} 执行结果汇总 { success: boolean, message: string, results: Array }
 */
export async function executeActions(actions = []) {
  console.log(`[ActionHandler] 执行多个操作:`, { actions })
  
  // 标准化输入：如果是单个对象，转换为数组
  const actionList = Array.isArray(actions) ? actions : [actions]
  
  const results = []
  const messages = []
  
  // 依次执行每个 action
  for (const actionData of actionList) {
    if (!actionData || !actionData.action) continue
    
    const result = await executeAction(actionData)
    results.push(result)
    
    // 收集成功的消息
    if (result.success && result.message) {
      messages.push(result.message)
    } else if (!result.success && result.message) {
      messages.push(result.message)
    }
  }
  
  // 汇总结果
  const allSuccess = results.every(r => r.success)
  const summaryMessage = messages.join('，') || '操作执行完成'
  
  return {
    success: allSuccess,
    message: summaryMessage,
    results: results
  }
}

export default {
  executeAction,
  executeActions,
  navigateTo,
  getButtonAction,
  toggleCategory,
}
