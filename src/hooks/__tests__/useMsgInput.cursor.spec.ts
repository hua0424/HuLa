import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { EffectScope } from 'vue'

vi.mock('@/stores/user', () => ({ useUserStore: () => ({ userInfo: { uid: '11' } }) }))
vi.mock('@/stores/global', () => ({
  useGlobalStore: () => ({ currentSessionRoomId: 'room-1', currentSession: { detailId: 'agent' } })
}))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ isGroup: true }) }))
vi.mock('@/stores/group', () => ({
  useGroupStore: () => ({ getUserInfo: () => ({ name: 'OpenCmdTestAI' }), userList: [] })
}))
vi.mock('@/stores/setting', () => ({ useSettingStore: () => ({ chat: ref({ sendKey: 'Enter' }) }) }))
vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/hooks/useMessage', () => ({ useMessage: () => ({ handleMsgClick: vi.fn() }) }))
vi.mock('@/hooks/useMessageSender', () => ({ useMessageSender: () => ({ sendWithTracking: vi.fn() }) }))
vi.mock('@/hooks/useUpload', () => ({
  UploadProviderEnum: { QINIU: 'qiniu', MINIO: 'minio' },
  useUpload: () => ({ uploadFile: vi.fn(), doUpload: vi.fn() })
}))
vi.mock('@/hooks/useFileUploadQueue', () => ({ globalFileUploadQueue: {} }))
vi.mock('@/strategy/MessageStrategy', () => ({ messageStrategyMap: {} }))
vi.mock('@/utils/AiclawUtils', () => ({ isAiclaw: (uid: string) => uid === 'agent' }))
vi.mock('@/utils/ImRequestUtils', () => ({ getSessionDetailWithFriends: vi.fn() }))
vi.mock('@/utils/PathUtil', () => ({ getImageCache: vi.fn() }))
vi.mock('@/utils/TauriInvokeHandler', () => ({ invokeWithErrorHandler: vi.fn(), invokeSilently: vi.fn() }))
vi.mock('@/utils/PlatformConstants', () => ({
  isWeb: () => false,
  isMobile: () => false,
  isMac: () => false,
  isWindows: () => true
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/agentCommands', () => ({ postAgentCommand: vi.fn(), getAgentCommand: vi.fn() }))

import { MsgEnum } from '@/enums'
import { postAgentCommand } from '@/services/agentCommands'
import { useCommon } from '@/hooks/useCommon'
import { useMsgInput } from '@/hooks/useMsgInput'

const scopes: EffectScope[] = []
const setup = () => {
  const editor = document.createElement('div')
  editor.id = 'message-input'
  editor.contentEditable = 'true'
  editor.textContent = '@'
  document.body.append(editor)
  const range = document.createRange()
  range.selectNodeContents(editor.firstChild!)
  range.collapse(false)
  window.getSelection()!.addRange(range)
  const scope = effectScope()
  scopes.push(scope)
  const input = scope.run(() => useMsgInput(ref(editor)))!
  editor.addEventListener('input', input.handleInput)
  editor.addEventListener('keyup', input.updateSelectionRange)
  input.updateSelectionRange()
  input.handleAit({ uid: 'agent', name: 'OpenCmdTestAI', avatar: '', account: 'agent' })
  const mention = editor.querySelector<HTMLElement>('#aitSpan')!
  expect(mention.textContent).toBe('@OpenCmdTestAI')
  expect(mention.contentEditable).toBe('false')
  return { editor, input, mention }
}

const select = (node: Node, offset: number) => {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
  window.getSelection()!.removeAllRanges()
})
afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop()
  await vi.runAllTimersAsync()
  await flushPromises()
  vi.useRealTimers()
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('mention cursor restoration through the real picker and selection hooks', () => {
  it('does not restore a cached caret inside the protected mention text', () => {
    const { editor, input, mention } = setup()
    const selection = select(mention.firstChild!, mention.textContent!.length)
    input.updateSelectionRange()
    const html = editor.innerHTML

    input.focusOn(editor)

    expect(editor.contains(selection.anchorNode)).toBe(true)
    expect(mention.contains(selection.anchorNode)).toBe(false)
    expect(selection.anchorNode).toBe(editor)
    expect(selection.anchorOffset).toBe(editor.childNodes.length)
    expect(editor.innerHTML).toBe(html)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
    expect(input.getCursorSelectionRange()?.range).toBe(selection.getRangeAt(0))
  })

  it.each(['foreign', 'detached'])('falls back without restoring a %s cached range', (location) => {
    const { editor, input, mention } = setup()
    const other = document.createElement('div')
    other.textContent = 'outside'
    if (location === 'foreign') document.body.append(other)
    const selection = select(other.firstChild!, 2)
    input.updateSelectionRange()
    expect(input.getCursorSelectionRange()?.range.startContainer).toBe(other.firstChild)
    selection.removeAllRanges()
    const html = editor.innerHTML

    input.focusOn(editor)

    expect(selection.anchorNode).toBe(editor)
    expect(selection.anchorOffset).toBe(editor.childNodes.length)
    expect(editor.innerHTML).toBe(html)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
    expect(input.getCursorSelectionRange()?.range).toBe(selection.getRangeAt(0))
  })

  it.each(['start', 'end'])('rejects a noncollapsed range with a protected %s endpoint', (endpoint) => {
    const { editor, input, mention } = setup()
    const range = document.createRange()
    if (endpoint === 'start') {
      range.setStart(mention.firstChild!, 1)
      range.setEnd(editor, editor.childNodes.length)
    } else {
      range.setStart(editor, 0)
      range.setEnd(mention.firstChild!, 1)
    }
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    input.updateSelectionRange()

    input.focusOn(editor)

    expect(selection.isCollapsed).toBe(true)
    expect(selection.anchorNode).toBe(editor)
    expect(selection.anchorOffset).toBe(editor.childNodes.length)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
  })

  it('uses a valid current caret when the cached caret belongs to another editor', () => {
    const { editor, input, mention } = setup()
    const other = document.createElement('div')
    other.textContent = 'outside'
    document.body.append(other)
    select(other.firstChild!, 2)
    input.updateSelectionRange()
    const empty = document.createTextNode('')
    editor.append(empty)
    const selection = select(empty, 0)

    input.focusOn(editor)

    expect(selection.anchorNode).toBe(empty)
    expect(selection.anchorOffset).toBe(0)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
    expect(input.getCursorSelectionRange()?.range).toBe(selection.getRangeAt(0))
  })

  it('preserves the legal empty Text caret after deleting the tail draft through the input path', async () => {
    const { editor, input, mention } = setup()
    useCommon().insertNode(MsgEnum.TEXT, 'draft', editor)
    const draft = Array.from(editor.childNodes).find((node) => node.textContent === 'draft')!
    draft.textContent = ''
    const selection = select(draft, 0)
    editor.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }))
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }))
    await vi.runAllTimersAsync()
    const html = editor.innerHTML

    input.focusOn(editor)

    expect(selection.anchorNode).toBe(draft)
    expect(selection.anchorOffset).toBe(0)
    expect(editor.innerHTML).toBe(html)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
  })

  it.each(['draft', 'whole mention'])('preserves a legal noncollapsed %s selection', (kind) => {
    const { editor, input, mention } = setup()
    useCommon().insertNode(MsgEnum.TEXT, 'draft', editor)
    const draft = Array.from(editor.childNodes).find((node) => node.textContent === 'draft')!
    const range = document.createRange()
    if (kind === 'draft') {
      range.setStart(draft, 1)
      range.setEnd(draft, 4)
    } else {
      range.selectNode(mention)
    }
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    input.updateSelectionRange()
    const selected = kind === 'draft' ? 'raf' : '@OpenCmdTestAI'
    const html = editor.innerHTML

    input.focusOn(editor)

    expect(selection.isCollapsed).toBe(false)
    expect(selection.toString()).toBe(selected)
    expect(editor.innerHTML).toBe(html)
    expect(editor.querySelector('#aitSpan')).toBe(mention)
  })

  it('keeps the restored selection usable by the real text insertion path', () => {
    const { editor, input, mention } = setup()
    select(mention.firstChild!, 1)
    input.updateSelectionRange()
    input.focusOn(editor)

    useCommon().insertNode(MsgEnum.TEXT, 'pasted text', editor)

    expect(editor.querySelector('#aitSpan')).toBe(mention)
    expect(mention.textContent).toBe('@OpenCmdTestAI')
    expect(editor.textContent).toBe('@OpenCmdTestAI\u00A0pasted text')
  })

  it('retains picker provenance after restoration and suppresses command discovery during IME', async () => {
    vi.mocked(postAgentCommand).mockImplementation(async (body) => ({ ...body, status: 'completed' }))
    const { editor, input, mention } = setup()
    select(mention.firstChild!, 1)
    input.updateSelectionRange()
    input.focusOn(editor)
    useCommon().insertNode(MsgEnum.TEXT, '/', editor)
    editor.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }))
    await vi.runAllTimersAsync()
    expect(postAgentCommand).not.toHaveBeenCalled()

    editor.dispatchEvent(new InputEvent('input', { isComposing: false, bubbles: true }))
    await vi.runAllTimersAsync()

    expect(postAgentCommand).toHaveBeenCalledTimes(1)
    expect(postAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        aiclawUid: 'agent',
        operation: 'discover'
      })
    )
    expect(editor.querySelector('#aitSpan')).toBe(mention)
  })
})
