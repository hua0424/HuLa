import { defineStore } from 'pinia'

export const useGroupStore = defineStore('group', () => {
  const list = ref<any[]>([])
  const groupDetail = ref<any>({})
  const updateUserItem = (item: any) => {}
  const removeGroupDetail = () => { groupDetail.value = {} }
  const getGroupUserList = async () => []

  return { list, groupDetail, updateUserItem, removeGroupDetail, getGroupUserList }
})
