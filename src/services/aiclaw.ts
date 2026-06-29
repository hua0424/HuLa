import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

export interface AiclawCcLaunchResult {
  /** 可在目标机器直接执行的 CC 启动命令 */
  launchCommand: string
  /** 命令预期执行的工作目录 */
  workspaceDir: string
}

/**
 * 获取指定房间 / aiclaw 的 CC 启动命令。
 *
 * @param roomId 房间 ID（群聊 roomId 或私聊 roomId）
 * @param aiclawUid aiclaw uid；多 CC 场景下用于消歧，单 CC 时可不传
 */
export const fetchAiclawCcLaunchCommand = async (roomId: string, aiclawUid?: string): Promise<AiclawCcLaunchResult> => {
  return await imRequest<AiclawCcLaunchResult>({
    url: ImUrlEnum.AICLAW_CC_LAUNCH,
    params: {
      roomId,
      ...(aiclawUid ? { uid: aiclawUid } : {})
    }
  })
}
