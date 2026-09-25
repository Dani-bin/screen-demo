/*
 * @Author: 
 * @Date: 2025-09-06 15:37:57
 * @Description:  
 */
import { defineStore } from "pinia"
import { ref } from "vue"

const dictStore = defineStore("dict", () => {
  const dictList = ref([])

  const setDateList = (data) => {
    dictList.value = data || []
  }

  return {
    dictList,
    setDateList
  }
})

export default dictStore