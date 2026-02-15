import { defineStore } from 'pinia'

export const useGroupStore = defineStore('group', () => {
  const list = ref([])
  const groupDetail = ref({})
  const updateUserItem = () => {}
  const removeGroupDetail = () => { groupDetail.value = {} }
  return { list, groupDetail, updateUserItem, removeGroupDetail }
})
