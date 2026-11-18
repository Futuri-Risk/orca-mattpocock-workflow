import { describe, expect, it } from 'vitest'

import type { AgentKindState } from '../core/skill-command.ts'
import {
  createSkillCommandService,
  type SkillCommandHost,
} from './skill-command-service.ts'

/** 假宿主：设置、agent 列表与存储都能换。 */
function fakeHost(overrides: {
  readonly setting?: string | null
  readonly agents?: readonly AgentKindState[]
  readonly remembered?: string | null
  readonly failSetting?: boolean
  readonly failAgents?: boolean
}): SkillCommandHost & { readonly stored: string[] } {
  const stored: string[] = []
  return {
    stored,
    getSetting: async () => {
      if (overrides.failSetting === true) throw new Error('没有 settings:own')
      return overrides.setting ?? null
    },
    listAgents: async () => {
      if (overrides.failAgents === true) throw new Error('没有 agent:read')
      return overrides.agents ?? []
    },
    readRemembered: async () => overrides.remembered ?? null,
    writeRemembered: async (style) => {
      stored.push(style)
    },
  }
}

describe('技能命令写法解析', () => {
  it('手动设置压过探测结果', async () => {
    const service = createSkillCommandService(
      fakeHost({ setting: 'omp', agents: [{ kind: 'codex', state: 'working' }] }),
    )
    await expect(service.resolve()).resolves.toEqual({ style: 'omp', source: 'setting' })
  })

  it('探测到在跑的 agent 时用它并记住', async () => {
    const host = fakeHost({ agents: [{ kind: 'omp', state: 'working' }] })
    const service = createSkillCommandService(host)
    await expect(service.resolve()).resolves.toEqual({ style: 'omp', source: 'detected' })
    expect(host.stored).toEqual(['omp'])
  })

  it('没有 agent 在跑时用记住的值', async () => {
    const service = createSkillCommandService(fakeHost({ remembered: 'codex' }))
    await expect(service.resolve()).resolves.toEqual({ style: 'codex', source: 'remembered' })
  })

  it('探测不到也读不到设置时用默认写法', async () => {
    const service = createSkillCommandService(
      fakeHost({ failSetting: true, failAgents: true }),
    )
    await expect(service.resolve()).resolves.toEqual({ style: 'claude', source: 'default' })
  })

  it('设置与探测都失败时不抛错', async () => {
    const service = createSkillCommandService(fakeHost({ failSetting: true, failAgents: true }))
    await expect(service.resolve()).resolves.toMatchObject({ style: 'claude' })
  })
})
