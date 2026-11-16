/**
 * happy-dom + React 19 的用例夹具：挂载、点击、等微任务与按 testid 查询。
 *
 * 每个测试文件在 `beforeEach` 里调用 {@link setupDom}、在 `afterEach` 里调用
 * {@link teardownDom}。Vitest 默认按文件隔离模块，这份单例不会跨文件串用。
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** React 19 的 act 只在测试环境识别这个标志；类型库没声明它。 */
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let container: HTMLDivElement | null = null
let root: Root | null = null

/** 建一个容器并挂上 React 根节点。 */
export function setupDom(): void {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

/** 卸载根节点并移除容器。 */
export async function teardownDom(): Promise<void> {
  const mounted = root
  root = null
  if (mounted !== null) {
    await act(async () => {
      mounted.unmount()
    })
  }
  container?.remove()
  container = null
}

function requireDom(): { readonly container: HTMLDivElement; readonly root: Root } {
  if (container === null || root === null) throw new Error('DOM test harness is not set up')
  return { container, root }
}

/** 按 testid 找元素；找不到返回 null。 */
export function find(testId: string): HTMLElement | null {
  return requireDom().container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

/** 按 testid 找元素；找不到直接失败。 */
export function mustFind(testId: string): HTMLElement {
  const element = find(testId)
  if (element === null) throw new Error(`missing testid ${testId}`)
  return element
}

/** 按 testid 找按钮；不是按钮也直接失败。 */
export function button(testId: string): HTMLButtonElement {
  const element = mustFind(testId)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`${testId} is not a button`)
  return element
}

/** 等 React 处理完一轮微任务（请求的 then 回调与随后的重渲染）。 */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** 渲染一次并等微任务落地；重复调用即重渲染。 */
export async function render(element: React.ReactElement): Promise<void> {
  const mounted = requireDom().root
  await act(async () => {
    mounted.render(element)
  })
  await settle()
}

/** 点击并等 React 与已结算的请求落地。 */
export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
  })
  await settle()
}

/** 在 act 里执行一次结算动作（例如 resolve 一个 deferred）。 */
export async function settleWith(action: () => void): Promise<void> {
  await act(async () => {
    action()
    await Promise.resolve()
  })
}
