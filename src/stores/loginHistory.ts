import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLoginHistoryStore = defineStore('loginHistory', () => {
  const history = ref<any[]>([])
  const addLoginHistory = (item: any) => {}
  const getLoginHistory = async () => []
  const clearLoginHistory = async () => {}
  return { history, addLoginHistory, getLoginHistory, clearLoginHistory }
})
export const useLoginHistoriesStore = useLoginHistoryStore
