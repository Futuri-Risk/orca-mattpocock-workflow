import { describe, expect, it } from 'vitest'

import type { AttentionItem, TicketSnapshot } from '../protocol/tracker.ts'
import { MESSAGES, MESSAGE_PARAMS_COMPLETE, type MessageId } from '../protocol/i18n.ts'
import { avatarHint, avatarLabel } from './avatar-display.ts'
import { backendFullLabel, backendLabel } from './backend-label.ts'
import { capabilityText, envBackendLabel, envCheckTitle } from './env-check-text.ts'
import { remedyContent } from './env-remedy-text.ts'
import { errorText } from './error-text.ts'
import {
  activeTranslate,
  createTranslator,
  formatMessage,
  normalizeLanguageSetting,
  resolveLocale,
} from './i18n.ts'
import { attentionText, pressureFacts, pressureTierLabel } from './overview-text.ts'
import { formatRelativeTime } from './relative-time.ts'
import { formatAge } from './snapshot-age.ts'
import { worktreeAvailability } from './worktree-action.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import { updateAgeBuckets } from './overview-chart-data.ts'

const ZH = createTranslator('zh-CN')
const EN = createTranslator('en')

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)]
    .map((match) => match[1] ?? '')
    .sort()
}

function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    ref: '#1',
    number: 1,
    title: 'ticket',
    state: 'open',
    category: 'bug',
    status: 'ready',
    labels: [],
    author: null,
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

describe('语言解析', () => {
  it.each([
    ['zh-CN', 'en-US', 'zh-CN'],
    ['en', 'zh-CN', 'en'],
    ['auto', 'zh-CN', 'zh-CN'],
    ['auto', 'zh-Hans', 'zh-CN'],
    ['auto', 'en-US', 'en'],
    ['auto', 'EN-gb', 'en'],
    ['auto', 'ja', 'zh-CN'],
    ['auto', '', 'zh-CN'],
    [undefined, 'en-GB', 'en'],
    ['fr', 'en-US', 'en'],
    [42, 'zh-CN', 'zh-CN'],
  ])('设置 %s + 宿主 %s → %s', (setting, host, expected) => {
    expect(resolveLocale(setting, host)).toBe(expected)
  })

  it('非法设置回落到 auto，合法值原样保留', () => {
    expect(normalizeLanguageSetting('auto')).toBe('auto')
    expect(normalizeLanguageSetting('zh-CN')).toBe('zh-CN')
    expect(normalizeLanguageSetting('en')).toBe('en')
    expect(normalizeLanguageSetting('fr')).toBe('auto')
    expect(normalizeLanguageSetting('EN')).toBe('auto')
    expect(normalizeLanguageSetting(null)).toBe('auto')
  })
})

describe('插值', () => {
  it('填上声明的参数', () => {
    expect(formatMessage('{a} / {b}', { a: 1, b: 'x' })).toBe('1 / x')
    expect(ZH('time.minutesAgo', { n: 3 })).toBe('3 分钟前')
    expect(EN('time.minutesAgo', { n: 3 })).toBe('3 minutes ago')
  })

  it('缺参数时保留占位符原文，不出现 undefined 或 NaN', () => {
    expect(formatMessage('{a} / {b}', { a: 1 })).toBe('1 / {b}')
    expect(formatMessage('{a}', {})).toBe('{a}')
    expect(formatMessage('{a}')).toBe('{a}')
    expect(formatMessage('{a}', { a: Number.NaN })).not.toContain('NaN')
  })
})

describe('消息目录', () => {
  it('两种语言的键集合完全一致', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES['zh-CN']).sort())
  })

  it('每条文案都非空，且两种语言的占位符集合一致', () => {
    expect(MESSAGE_PARAMS_COMPLETE).toBe(true)
    for (const id of Object.keys(MESSAGES['zh-CN']) as MessageId[]) {
      expect(MESSAGES['zh-CN'][id].length).toBeGreaterThan(0)
      expect(MESSAGES.en[id].length).toBeGreaterThan(0)
      expect(placeholders(MESSAGES.en[id])).toEqual(placeholders(MESSAGES['zh-CN'][id]))
    }
  })

  it('复制失败提示由原因码与手动复制说明拼成一句', () => {
    expect(
      ZH('copy.manualNotice', { reason: ZH('copy.clipboardUnavailable') }),
    ).toBe('复制失败：当前环境不允许写入剪贴板。下面的文本框已全选，按 ⌘C 复制。')
  })

  it('中文措辞与今天的界面逐字一致', () => {
    expect(MESSAGES['zh-CN']['tickets.emptyRepo']).toBe('这个仓库还没有工单。')
    expect(MESSAGES['zh-CN']['tickets.emptyFiltered']).toBe('没有符合筛选条件的工单。')
    expect(MESSAGES['zh-CN']['pressure.tier.light']).toBe('轻松')
    expect(MESSAGES['zh-CN']['time.minutesAgo']).toBe('{n} 分钟前')
    expect(MESSAGES['zh-CN']['error.ticket-not-found']).toBe('找不到这张工单，它可能已被删除。')
  })

  it('英文目录里只有语言名保留中文', () => {
    const withHan = Object.entries(MESSAGES.en)
      .filter(([, value]) => /\p{Script=Han}/u.test(value))
      .map(([id]) => id)
    expect(withHan).toEqual(['language.zhCN'])
  })
})

describe('纯函数模块的双语输出', () => {
  it('后端名：品牌原样，本地 Markdown 跟随语言', () => {
    expect(backendLabel('github', ZH)).toBe('GitHub')
    expect(backendLabel('markdown', ZH)).toBe('本地')
    expect(backendLabel('markdown', EN)).toBe('Local')
    expect(backendFullLabel('markdown', EN)).toBe('Local Markdown')
    expect(envBackendLabel(null, ZH)).toBe('未判定')
    expect(envBackendLabel(null, EN)).toBe('Not determined')
  })

  it('压力档位与触发说明', () => {
    expect(pressureTierLabel('tight', ZH)).toBe('吃紧')
    expect(pressureTierLabel('tight', EN)).toBe('Tight')
    expect(
      pressureFacts(
        {
          dimension: 'scale',
          tier: 'normal',
          signals: [{ metric: 'backlog', value: 7 }],
          triggers: ['backlog'],
          gaps: [],
          provisional: false,
        },
        EN,
      ),
    ).toBe('Open backlog: 7')
  })

  it('关注原因与年龄分档', () => {
    const item: AttentionItem = {
      ref: '#1',
      title: 't',
      reason: 'stale',
      evidence: 5,
    }
    expect(attentionText(item, ZH)).toBe('陈旧 5 天未更新')
    expect(attentionText(item, EN)).toBe('Stale: no update for 5 days')
    expect(updateAgeBuckets([], Date.parse('2026-01-01T00:00:00Z'), EN).map((b) => b.label)).toEqual(
      ['Within 7 days', '8–14 days', '15–30 days', 'Over 30 days'],
    )
  })

  it('相对时间两种语言各覆盖四个量级', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour

    expect(formatRelativeTime(now - 10_000, now, ZH)).toBe('刚刚')
    expect(formatRelativeTime(now - 3 * minute, now, ZH)).toBe('3 分钟前')
    expect(formatRelativeTime(now - 3 * hour, now, ZH)).toBe('3 小时前')
    expect(formatRelativeTime(now - 3 * day, now, ZH)).toBe('3 天前')

    expect(formatAge(now - 10_000, now, EN)).toBe('just now')
    expect(formatAge(now - 3 * minute, now, EN)).toBe('3 minutes ago')
    expect(formatAge(now - 3 * hour, now, EN)).toBe('3 hours ago')
    expect(formatAge(now - 3 * day, now, EN)).toBe('3 days ago')
  })

  it('错误码映射与未知码回落', () => {
    expect(errorText({ code: 'gh-missing', message: 'raw' }, ZH)).toContain('未找到 gh')
    expect(errorText({ code: 'gh-missing', message: 'raw' }, EN)).toContain('gh was not found')
    expect(errorText({ code: 'fetch-failed', message: '后端诊断' }, EN)).toBe('后端诊断')
  })

  it('环境检查标题、能力诊断与解决方式', () => {
    expect(
      envCheckTitle(
        { id: 'cli', subject: 'github', status: 'fail', detail: '', remedy: null, blockedBy: null },
        EN,
      ),
    ).toBe('GitHub CLI (gh) installed')
    expect(
      envCheckTitle(
        { id: 'skill', subject: 'triage', status: 'fail', detail: '', remedy: null, blockedBy: null },
        ZH,
      ),
    ).toBe('技能 triage 已安装')
    expect(
      capabilityText({ id: 'clipboard', category: 'ui-extension', status: 'missing' }, EN).impact,
    ).toContain('host policy')
    expect(
      remedyContent(
        'check-repository-access',
        {
          backend: 'github',
          repository: 'owner/repo',
          subject: 'github',
          title: 'GitHub 仓库可达',
          detail: '',
        },
        EN,
      ).action,
    ).toEqual({ kind: 'command', command: 'gh repo view owner/repo --json nameWithOwner,viewerPermission' })
    expect(
      remedyContent(
        'install-skill',
        {
          backend: null,
          repository: null,
          subject: 'triage',
          title: '技能 triage 已安装',
          detail: '',
        },
        ZH,
      ).summary,
    ).toBe('把 triage 技能装到 Orca 扫描的技能目录；装好后重新检查。')
  })

  it('技能徽标、头像与 worktree 入口', () => {
    const blocked = ticket({
      status: 'blocked',
      skillAction: 'none',
      skillActionReason: 'blocked',
      openBlockers: 2,
    })
    expect(actionBadgeLabel(blocked, ZH)).toBe('阻塞 2')
    expect(actionHint(blocked, EN)).toContain('Open blockers remain')
    expect(avatarLabel('creator', null, ZH)).toBe('创建人：未署名')
    expect(avatarHint({ login: 'cnzgray', displayName: 'Cnzgray', avatarUrl: null }, EN)).toBe(
      'Cnzgray (@cnzgray)',
    )
    expect(worktreeAvailability(ticket({ status: 'closed' }), 'github', '/repo', ZH).reason).toBe(
      '工单已关闭',
    )
  })
})

describe('模块级当前语言', () => {
  it('默认中文', () => {
    expect(activeTranslate()('tickets.newFeature')).toBe('新建需求')
  })
})
