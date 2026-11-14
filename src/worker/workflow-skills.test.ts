import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createWorkflowSkills, renderSkillFile } from './workflow-skills.ts'

const skillsRoot = resolve(import.meta.dirname, '../../skills')

describe('入池技能文件', () => {
  it('仓库里的 SKILL.md 与生成的正文一致', async () => {
    for (const skill of createWorkflowSkills()) {
      const file = join(skillsRoot, skill.name, 'SKILL.md')
      await expect(readFile(file, 'utf8')).resolves.toBe(renderSkillFile(skill))
    }
  })

  it('两个入池技能各有一份 SKILL.md', async () => {
    const names = createWorkflowSkills().map((skill) => skill.name)
    expect(names).toEqual(['mattwf-bug', 'mattwf-feature'])
  })
})
