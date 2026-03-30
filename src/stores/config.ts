import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { ConfigType } from '@/services/types'
import * as ImRequestUtils from '@/utils/ImRequestUtils'

export const useConfigStore = defineStore(StoresEnum.CONFIG, () => {
  const config = ref<ConfigType>({} as any)

  /** 初始化配置（system-server 不可用时静默失败） */
  const initConfig = async () => {
    try {
      const res = await ImRequestUtils.initConfig()
      if (res) config.value = res
    } catch (error) {
      console.warn('[config] initConfig 失败（system-server 可能未启动），使用默认配置:', error)
    }
  }

  /** 获取七牛配置 */
  const getQiNiuConfig = () => config.value.qiNiu

  return { config, initConfig, getQiNiuConfig }
})
