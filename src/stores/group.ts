import { defineStore } from 'pinia'
export const useGroupStore = defineStore('group', () => {
  const list = ref<any[]>([])
  const groupDetail = ref<any>({})
  const countInfo = ref<any>({})
  const updateUserItem = (item: any) => {}
  const removeGroupDetail = () => { groupDetail.value = {} }
  const getGroupUserList = async () => []
  const getUserInfo = (uid: string, roomId?: string) => ({})

  return { list, groupDetail, countInfo, updateUserItem, removeGroupDetail, getGroupUserList, getUserInfo }
})
