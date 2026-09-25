/*
 * @Description: 指挥调度页面相关接口
 */
import request from "@/utils/request"

/**
 * 获取应急物资仓库点位列表
 * 返回字段：pointName(名称) / lng(经度，字符串) / lat(纬度，字符串) /
 *           typeName(类型中文名) / id(点位ID)
 */
export function getResourceWarehousePoints(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/warehouse/points",
    method: "get",
    params
  })
}

/**
 * 获取避难场所点位列表（字段结构与应急物资点位一致）
 * 返回字段：pointName / lng / lat / typeName / id
 */
export function getShelterPoints(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/bncs/points",
    method: "get",
    params
  })
}

/**
 * 避难场所统计列表（用于"避难场所统计"面板）
 * 返回字段：id / name(名称) / areaName(行政区) /
 *           spaceCategory(空间类型) / capacity(可容纳人员数量)
 */
export function getShelterList(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/bncs/list",
    method: "get",
    params
  })
}

/**
 * 医院点位列表（字段结构与应急物资/避难场所点位一致）
 * 返回字段：pointName / lng / lat / typeName / id
 */
export function getHospitalPoints(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/hospital/points",
    method: "get",
    params
  })
}

/**
 * 医院列表（用于"医院列表"面板）
 * 返回字段：id / principalInformationId / categoryOne(类型) /
 *           hospitalLevel(等级) / ownership(所有制) / advantage(擅长领域)
 * 注：接口示例未直接返回医院名称字段，前端使用 name / hospitalName / pointName 兜底
 */
export function getHospitalList(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/hospital/list",
    method: "get",
    params
  })
}

/**
 * 救援队伍-根据性质统计
 * 返回字段：name(队伍性质，如"骨干队伍") / count(数量)
 */
export function getRescueTeamStats(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/teams/staticsCountByxz",
    method: "get",
    params
  })
}

/**
 * 救援队伍点位列表（字段结构与应急物资/避难场所/医院点位一致）
 * 返回字段：pointName / lng / lat / typeName / id
 */
export function getRescueTeamPoints(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/jydw/points",
    method: "get",
    params
  })
}

/**
 * 按点位类型 ID 查询点位列表（地图点位通用接口）
 * Query 参数：pointType(后端字典对应的数字，如 11=积涝点 / 22=CD级危房 / 51=设施大棚 ...)
 * 返回字段：id / pointName / typeName / lng / lat /
 *           additionalAttributes(JSON 字符串，图层信息) /
 *           attributesJson(JSON 字符串，扩展属性)
 * 注：接口文档里 data 写的是 object，实际可能是数组——前端做单/多兼容
 */
export function getPointsByType(params) {
  return request({
    url: "/admin-api/business/yjyl/point/listByPointType",
    method: "get",
    params
  })
}

/**
 * 根据行政区划统计指定点位类型的数量（用于积涝点统计等乡镇分布面板）
 * Query 参数：pointType(后端字典数字，如 102=积涝点)
 * 返回字段：name(行政区名称) / count(统计数量)
 */
export function getPointsAnalysisByArea(params) {
  return request({
    url: "/admin-api/business/yjyl/point/analysisByArea",
    method: "get",
    params
  })
}

/**
 * 风险点位详情（积涝点 / CD级危房 / 设施大棚 / 高空构建 / 高空作业 /
 * 海堤 / 河道堤防 / 闸口 / 人员转移 / 低洼地带 等通用点位）
 *
 * Query 参数：pointId(点位 ID，雪花字符串)
 * 字段较多，主要展示：name / pointTypeName / administrativeDivisionName /
 *   address / supervisionUnitName / responsibleUnitName / dutyUnitText /
 *   unitHead+unitHeadPhone / departmentHead+departmentHeadPhone /
 *   onSiteResponsiblePerson+onSiteResponsiblePersonPhone /
 *   contactPerson+contactPhone / safetyRiskLevelName /
 *   hazardCharacteristics / emergencyMeasures / pointIntroduction
 * 设备：riskDeviceRelations / videoDevices / monitoringDevices
 */
export function getRiskPointDetail(params) {
  return request({
    url: "/admin-api/business/yjyl/point/detail",
    method: "get",
    params
  })
}

/**
 * 生成调度任务（物资 / 队伍 / 救援队伍前置调度）
 * Query 参数：
 *   - planId(预案ID，整数；不传时由调用方提供，缺省可在前端按当前预案兜底)
 *   - type(调度任务类型，中文："物资" | "队伍")
 *   - status(任务状态，0-草稿/1-进行中/2-已完成)
 * 返回字段（每项）：
 *   id / planId / type / pointId / businessId /
 *   startName / startLat / startLng / endName / endLat / endLng /
 *   memo / responsibleUnit / responsiblePerson / responsiblePhone /
 *   sort / status(0-草稿/1-进行中/2-已完成) / createTime
 */
export function generateDispatchTask(params) {
  return request({
    url: "/admin-api/business/yjyl/task/generateTask",
    method: "get",
    params
  })
}

/**
 * 批量下发调度任务（点击"下发"按钮触发）
 * Query 参数：ids(任务 ID 逗号拼接字符串，如 "1,2,3")
 */
export function issueDispatchTasks(params) {
  return request({
    url: "/admin-api/business/yjyl/task/issueTasks",
    method: "get",
    params
  })
}

/**
 * 根据预案获取所有的应急响应（队伍调度 + 物资调度，按生成时间排序）
 * 用于「应急响应」侧边弹窗的卡片列表展示
 *
 * Query 参数：planId(预案ID，整数；指挥调度传 280 / 专项指挥传 281)
 * 返回字段（每项）：
 *   id / planId / type(队伍|物资) / pointId / businessId /
 *   startName(起点位置名称) / startLat / startLng /
 *   endName(终点位置名称) / endLat / endLng /
 *   memo(调度详情备注) / responsibleUnit(责任单位) /
 *   responsiblePerson(责任人姓名) / responsiblePhone(责任人电话) /
 *   sort(任务执行顺序) / status(0-草稿 / 1-进行中 / 2-已完成) /
 *   createTime(事件时间)
 */
export function getResponseTaskList(params) {
  return request({
    url: "/admin-api/business/yjyl/task/listAll",
    method: "get",
    params
  })
}

/**
 * 单个下发调度任务-标记完成（把某条应急响应任务的状态置为"已完成"）
 * Query 参数：id(任务 ID，整数)
 * 返回：code(0 表示成功) / data(true 表示成功) / msg
 */
export function completeResponseTask(params) {
  return request({
    url: "/admin-api/business/yjyl/task/completeTask",
    method: "get",
    params
  })
}

/**
 * 根据预案获取组中所有的部门 / 分组
 * Query 参数：pid(预案ID)
 * 返回字段：id / planId / orgType(1-分组 / 2-部门) / orgName(名称) /
 *           parentId / orgDesc / orgIco / memberList / sort
 * 注：业务侧通常只取 orgType="2" 的"部门"数据
 */
export function getPlanGroupsOrgs(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups/orgs",
    method: "get",
    params
  })
}

/**
 * 获得预案管理-分组清单（分组绑定角色成员）
 * 用于"工作组"tab：分页接口，每条数据是一个分组，分组下有 memberList 成员清单
 *
 * Query 参数（注意接口字段名首字母大写）：
 *   - PageNo / PageSize：分页参数（前端约定 PageSize=100，一次性拿全量）
 *   - PlanId：预案ID
 *   - OrgType：1-分组 / 2-涉及单位
 *   - OrgName / ParentId / OrgDesc 等：可选过滤字段
 *
 * 返回字段：id / planId / orgType / orgName / orgDesc / orgIco / memberList[] / sort
 *   memberList[i]: memberName / phone / memberRoleName / memberPostName / ...
 */
export function getPlanGroups(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups",
    method: "get",
    params
  })
}

/**
 * 根据组获取组中所有的成员
 * Query 参数：planId(预案ID) / memberOrgId(分组ID，对应 getPlanGroups 返回的 id)
 * 返回字段：id / memberOrgId / memberRole / memberRoleName /
 *           dataType / dataSourceId / memberPostId / memberPostName /
 *           memberId / memberName / phone / orgId / orgName / sort
 */
export function getPlanGroupMembers(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups/members",
    method: "get",
    params
  })
}

/**
 * 根据部门获取部门中所有的成员（与工作组成员是两套独立接口）
 * Query 参数：orgId(预案部门ID，**取 dataSourceId**，非 group.id)
 * 返回字段与工作组成员一致：
 *   id / memberOrgId / memberRole / memberRoleName / dataType /
 *   dataSourceId / memberPostId / memberPostName / memberId /
 *   memberName / phone / orgId / orgName / sort
 */
export function getPlanGroupOrgMembers(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups/orgMembers",
    method: "get",
    params
  })
}

/**
 * 救援队伍列表
 * 返回字段（节选）：id / name(队伍) / categoryTwo(专业类型) / categoryOne /
 *           natureName(性质) / administrativeDivisionName(行政区) /
 *           address(地址) / relationPerson(联系人) / phone(联系电话) /
 *           lng / lat
 */
export function getRescueTeamList(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/teams/list",
    method: "get",
    params
  })
}

/**
 * 应急仓库物资统计信息（用于"防台物资统计"面板）
 * 返回字段：materialName(物资名称) / unit(单位) /
 *           regionCount(县级储备数量) / townCount(镇区级储备数量)
 */
export function getMaterialAnalysis(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/material/analysis",
    method: "get",
    params
  })
}

/**
 * 物资全量列表（已按物资名称分组求和，同组类别不同时以逗号拼接）
 * 用于「物资统计」tab 的左侧全县汇总
 * 返回字段：materialName(名称) / count(数量) / unit(单位) /
 *           categories(类别，可能是"防汛抗旱,消防救援"这种逗号拼接的多值字符串)
 */
export function getMaterialListAll(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/materials/listAll",
    method: "get",
    params
  })
}

/**
 * 应急仓库列表（用于"物资库"弹窗左侧仓库选择列表）
 * 返回字段：id(仓库ID，字符串) / warehouseName(仓库名称) / areaName(行政区划)
 */
export function getWarehouseList(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/warehouse/listAll",
    method: "get",
    params
  })
}

/**
 * 按仓库ID查询该仓库下的物资明细
 * Query 参数：pid(仓库ID，字符串雪花ID，需以字符串透传以免数值精度丢失)
 * 返回字段：materialName(物资名称) / count(数量) / unit(单位) / categories(物资类型)
 */
export function getMaterialsByPid(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/warehouse/materialsByPid",
    method: "get",
    params
  })
}

/**
 * 按物资名称反查仓库清单（用于"物资统计"tab 右侧分布明细）
 * Query 参数：materialName(物资名称)
 * 返回字段：id / materialName / warehouseName(仓库名称) / count(数量) / unit(单位)
 */
export function getWarehousesByMaterialName(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/materials/wareHousesByMaterialName",
    method: "get",
    params
  })
}

/**
 * 单独 / 批量调度物资或队伍（生成实际下发的调度任务）
 *
 * Body 参数（raw-json）：
 *   - ids(队伍/仓库ID集合，数组，长度可为 1 表示单独调度)
 *   - planId(关联应急预案ID)
 *   - targetType(目的地类型：1-地图已有点位 / 2-地图任意位置标记)
 *   - targetId(targetType=1 时必填，目的地点位ID)
 *   - targetLng / targetLat / targetName(targetType=2 时必填，经纬度+名称)
 *   - type("队伍" | "物资" 中文枚举)
 *   - content(队伍调度可不填；物资调度填写物资清单，如 "100顶x帐篷、200双x雨鞋")
 *
 * 返回字段：code(0 表示成功) / data / msg
 */
export function createDispatchTask(data) {
  return request({
    url: "/admin-api/business/yjyl/task/createTask",
    method: "post",
    data
  })
}

/**
 * 上传响应图层（地图标绘 / 部署等图形保存）
 * 每完成一次绘制就调用一次，将单个图层（类型 + 几何信息 + 属性）持久化
 *
 * Query 参数：
 *   - planId(应急预案 ID，整数，缺省时由调用方传入默认值)
 *   - layerJson(JSON 字符串：{ type, points, props? } 等图层结构)
 *   - sort(展示排序序号，前端按绘制次序递增)
 * 返回字段：code(0 表示成功) / data(新增图层 ID) / msg
 */
export function uploadResponseLayer(data) {
  return request({
    url: "/admin-api/business/yjyl/task/uplayer",
    method: "post",
    data,
    // 上报失败时不打扰用户，由调用方按需 catch
    notError: true
  })
}

/**
 *  删除响应图层（地图标绘 / 部署等图形保存）
 * 每完成一次绘制就调用一次，将单个图层（类型 + 几何信息 + 属性）持久化
 *
 * Query 参数：
 *   - planId(应急预案 ID，整数，缺省时由调用方传入默认值)
 *   - layerJson(JSON 字符串：{ type, points, props? } 等图层结构)
 *   - sort(展示排序序号，前端按绘制次序递增)
 * 返回字段：code(0 表示成功) / data(新增图层 ID) / msg
 */
export function deleteResponseLayer(params) {
  return request({
    url: "/admin-api/business/yjyl/task/deletelayer",
    method: "get",
    params, 
    // 上报失败时不打扰用户，由调用方按需 catch
    notError: true
  })
}

/**
 * 获取所有的响应图层（页面加载时调用，恢复之前通过地图标绘工具栏绘制的图层）
 *
 * Query 参数：
 *   - planId(应急预案 ID，整数)
 * 返回字段：code(0 表示成功) / data(图层列表，每项包含 type, points, props 等) / msg
 */
export function getResponseLayerList(params) {
  return request({
    url: "/admin-api/business/yjyl/task/layerListAll",
    method: "get",
    params,
    notError: true
  })
}

/**
 * 获取点位详情（救援队伍 / 医院 / 避难场所 / 应急仓库，由后端依 ID 自行判断类型）
 * Query 参数：id(主体信息ID，字符串雪花ID，需以字符串透传)
 * 返回字段（按类型不同）：
 *   - 共性：area / address / name / category / dept_name / org /
 *           relation_person / phone / remark / videoDevices / type
 *   - 救援队伍特有：teamNature / teams_count / members / advantage
 *   - 医院特有：ownership / hospitalLevel / advantage
 *   - 避难场所特有：level / spaceType / timeType / capacity / functionType
 *   - 应急仓库特有：materials
 */
export function getPointDetail(params) {
  return request({
    url: "/admin-api/business/yjyl/resource/er/detail",
    method: "get",
    params
  })
}

/**
 * 根据 ID 获取风险点位详情
 * 用途：专项指挥页面进入时拉一个固定 ID 的风险点，按 lng/lat（起点）+
 *      attributesJson 中的 endLng/endLat（终点）+ imageUrl 在地图上铺一张
 *      自定义图片覆盖物（BMapGL.GroundOverlay）。
 *
 * Query 参数：id（风险点位ID，字符串雪花ID，需以字符串透传）
 * 关键返回字段：
 *   - lng / lat：左上角起点经纬度
 *   - attributesJson：扩展属性 JSON 字符串
 *         eg. [{"attributeName":"endLng","value":"120.265..."},
 *              {"attributeName":"endLat","value":"33.783..."}]
 *   - imageUrl：覆盖物图片地址
 */
export function getRiskPointById(params) {
  return request({
    url: "/admin-api/business/risk-point/get",
    method: "get",
    params
  })
}
