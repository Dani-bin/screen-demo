<template>
  <div class="flex items-center map-search">
    <el-select v-model="queryData.area" placeholder="请选择" clearable>
      <el-option-group v-for="group in areaOptions" :key="group.id" :label="group.name">
        <el-option v-for="item in group.children" :key="item.id" :label="item.name" :value="item.id" />
      </el-option-group>
    </el-select>
    <div v-if="hasCategory" class="line"></div>
    <el-cascader v-model="queryData.categoryList" :props="cascaderProps" placeholder="请选择" clearable v-if="hasCategory"
      :show-all-levels="false" />
    <div class="line"></div>
    <img src="@/assets/images/aqsc/search-icon.svg" alt="" class="search-icon" />
    <el-input v-model="queryData.name" placeholder="输入企业或点位名称搜索" clearable />
    <el-button type="primary" size="default" @click="searchGlobal">搜索</el-button>
  </div>
</template>

<script setup>
import request from "@/utils/request"
import EventBus from "@/utils/event-bus.js"
import useDictStore from "@/store/modules/dict"

const props = defineProps({
  hasCategory: {
    type: Boolean,
    default: false
  }
})

const dictStore = useDictStore()
const queryData = reactive({
  area: undefined,
  name: undefined,
  flag: true,
  categoryList: undefined
})
const areaOptions = ref([
  {
    id: "320924",
    name: "射阳县"
  }
])
const categoryMajorList = ref([
  {
    "label": "餐饮类",
    "value": "0",
    dictType: 'Catering'
  },
  {
    "label": "旅馆类",
    "value": "1",
    dictType: 'HotelType'
  },
  {
    "label": "商超类",
    "value": "2",
    dictType: 'Supermarket'
  },
  {
    "label": "社会服务类",
    "value": "3",
    dictType: 'SocialServices'
  },
  {
    "label": "医疗机构",
    "value": "4",
    dictType: 'MInstitution'
  },
  {
    "label": "教育培训机构",
    "value": "5",
    dictType: 'EducationTrainingInstitutions'
  },
  {
    "label": "娱乐场所",
    "value": "6",
    dictType: 'EntertainmentVenues'
  },
  {
    "label": "仓储场所",
    "value": "7",
    dictType: 'StorageLocation'
  },
  {
    "label": "小生产加工类",
    "value": "8",
    dictType: 'SmallScaleProductionProcessing'
  },
  {
    "label": "再生物资回收与批发类",
    "value": "9",
    dictType: 'RecyclingWholesale'
  },
  {
    "label": "休闲健身类",
    "value": "10",
    dictType: 'LeisureFitness'
  },
  {
    "label": "其他未分类小场所",
    "value": "11",
    dictType: 'OtherSmallPlaces'
  },
  {
    "label": "维修场所",
    "value": "12",
    dictType: 'Maintenance'
  },
])

const cascaderProps = {
  lazy: true,
  checkStrictly: true,
  lazyLoad(node, resolve) {
    const { level } = node
    if (level === 1) {
      let list = dictStore.dictList.filter(item => item.dictType === node.data.dictType) || []
      list.forEach(item => {
        item.leaf = true
      })
      resolve(list)
    } else {
      resolve(categoryMajorList.value)
    }
  }
}

const searchGlobal = () => {
  EventBus.emit("searchGlobal", queryData)
}

const getAreaOptions = async () => {
  const res = await request({
    url: `/admin-api/system/area/tree?code=320924000000`,
    method: "get"
  })
  let data = (res.data || []).map(val => {
    val.children = []
    return val
  })
  data.unshift({ id: '320924000000', name: '射阳县' })

  areaOptions.value[0].children = data
}
onMounted(() => {
  getAreaOptions()
  EventBus.on("setTown", (code) => {
    let data = null
    areaOptions.value.forEach(item => {
      let index = item.children.findIndex(item => item.id === code)
      if (index !== -1) {
        data = item.children[index]
      }
    })
    queryData.area = data?.id
    EventBus.emit("searchGlobal", queryData)
  })
  EventBus.on("setName", (name) => {
    queryData.name = name
    EventBus.emit("searchGlobal", queryData)
  })
  EventBus.on("clearSearch", () => {
    queryData.area = undefined
    queryData.name = undefined
    EventBus.emit("searchGlobal", queryData)
  })
})
onUnmounted(() => {
  EventBus.off("setTown")
  EventBus.off("setName")
  EventBus.off("clearSearch")
})
</script>

<style lang="scss" scoped>
.map-search {
  width: 100%;
  height: 100%;

  .el-select {
    height: 100%;
    width: 240px;

    :deep(.el-select__wrapper) {
      padding: 0 10px 0 20px;

      .el-select__placeholder {
        color: rgba(34, 66, 103, 0.8);
      }

      .el-select__suffix {
        .el-select__caret {
          font-size: 30px;
          color: #488feb;
        }
      }
    }
  }

  :deep(.el-cascader) {
    height: 100%;
    width: 260px;

    .el-input {
      .el-input__wrapper {
        box-shadow: none;

        .el-input__inner {
          color: rgba(34, 66, 103);

          &::placeholder {
            color: rgba(34, 66, 103, 0.8);
          }
        }

        .el-input__suffix {

          .el-input__suffix-inner .el-icon {
            font-size: 30px;
            color: #488feb;
          }
        }
      }
    }
  }

  .line {
    width: 2px;
    height: 46px;
    background: #00bbff;
  }

  .search-icon {
    width: 42px;
  }

  .el-input {
    flex-grow: 1;
    width: 10%;
    margin-right: 0px;

    :deep(.el-input__wrapper) {

      .el-input__inner {
        color: rgba(34, 66, 103);

        &::placeholder {
          color: rgba(34, 66, 103, 0.8);
        }
      }

      .el-input__suffix {

        .el-input__suffix-inner .el-icon {
          font-size: 30px;
          color: #488feb;
        }
      }
    }

  }

  .el-button {
    width: 102px;
    height: 60px;
    border-radius: 4px 4px 4px 4px;
    border: 1px solid;
    border-image: linear-gradient(159deg,
        rgba(126, 224, 255, 0),
        rgba(126, 224, 255, 1)) 1 1;
    font-family:
      Source Han Sans CN,
      Source Han Sans CN;
    font-weight: 500;
    font-size: 30px;
    color: #ffffff;
  }
}
</style>
