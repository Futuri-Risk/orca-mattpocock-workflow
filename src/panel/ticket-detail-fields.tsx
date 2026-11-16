/**
 * 工单详情里的操作与可写属性。
 *
 * - 头部操作：关闭/重开、复制链接，放在导航行右侧（技能按钮在详情视图里与它们同排）；
 * - 属性条：标签与分配人各成一组，挤在一行里，窄面板时自然换行；加号展开带补全的输入框。
 *   标签按仓库颜色着色，分配人带头像。
 *
 * 能力缺失时对应控件不出现，属性条下用一句话说明「哪个后端、缺哪些能力」；
 * 写操作期间控件禁用，避免重复提交。所有写操作都交给父组件的同一个提交入口。
 */
import * as React from 'react'

import type { MessageId } from '../protocol/i18n.ts'
import type { TicketDetail, TicketPatch } from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import type { AvatarUser } from './avatar-display.ts'
import { backendLabel } from './backend-label.ts'
import { useMessages } from './i18n.ts'
import { CheckIcon, CloseIcon, LinkIcon, PersonIcon, PlusIcon, TagIcon } from './icons.tsx'
import { COLORS } from './task-panel-styles.ts'
import { TokenEditor, type SuggestionSource } from './ticket-combobox.tsx'
import {
  DETAIL_ADD_STYLE,
  DETAIL_ERROR_STYLE,
  DETAIL_GROUP_ICON_STYLE,
  DETAIL_GROUP_STYLE,
  DETAIL_HINT_STYLE,
  DETAIL_INPUT_STYLE,
  DETAIL_STACK_STYLE,
  DETAIL_STRIP_STYLE,
  DETAIL_TOKEN_EMPTY_STYLE,
  DETAIL_TOKEN_REMOVE_STYLE,
  DETAIL_TOKEN_STYLE,
  HEADER_CLOSE_STYLE,
  HEADER_ICON_BUTTON_STYLE,
  HEADER_TEXT_BUTTON_STYLE,
  VISUALLY_HIDDEN_STYLE,
} from './ticket-detail-styles.ts'
import { labelColorStyle } from './ticket-visuals.tsx'
import { UserAvatar } from './user-avatar.tsx'

/** 写操作相关的共用参数。 */
export interface FieldProps {
  readonly detail: TicketDetail
  /** 有写操作进行中：所有写控件禁用。 */
  readonly busy: boolean
  readonly onApply: (patch: TicketPatch) => void
}

/** 复制链接的结果；“已复制”两秒后自动回到 idle。 */
export interface CopyState {
  readonly status: 'idle' | 'copied' | 'failed'
  readonly message?: string
}

/**
 * 头部右侧的工单操作：关闭/重开、复制链接。都是低频动作，放在导航行里不占正文区域；
 * 关闭用错误色文字，复制是图标按钮，成功后图标短暂变成对勾。
 * `afterState` 插在关闭/重开之后、复制链接之前，详情用它放手动刷新。
 */
export function HeaderActions(
  props: FieldProps & {
    readonly copy: CopyState
    readonly onCopy: () => void
    /** 关闭/重开之后、复制链接之前的操作（详情头部的手动刷新）。 */
    readonly afterState?: React.ReactNode
  },
): React.ReactElement {
  const t = useMessages()
  const { detail, busy } = props
  const next = detail.state === 'open' ? 'closed' : 'open'
  const copied = props.copy.status === 'copied'

  return (
    <>
      {detail.capabilities.state ? (
        <button
          type="button"
          data-testid="detail-state-toggle"
          // 关闭是破坏性较强的动作：错误色文字、悬停浅红底；重开是普通动作。
          data-hover={next === 'closed' ? 'secondary' : 'soft'}
          disabled={busy}
          onClick={() => {
            props.onApply({ state: next })
          }}
          style={next === 'closed' ? HEADER_CLOSE_STYLE : HEADER_TEXT_BUTTON_STYLE}
        >
          {next === 'closed' ? t('detail.close') : t('detail.reopen')}
        </button>
      ) : null}
      {props.afterState}
      {detail.url === null ? null : (
        <button
          type="button"
          data-testid="detail-copy"
          data-hover="soft"
          aria-label={t('detail.copyLink')}
          title={
            copied
              ? t('common.copied')
              : t('detail.copyLinkWithUrl', { url: detail.url })
          }
          onClick={props.onCopy}
          style={
            copied
              ? { ...HEADER_ICON_BUTTON_STYLE, color: COLORS.success }
              : HEADER_ICON_BUTTON_STYLE
          }
        >
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
      )}
      {copied ? (
        <span role="status" data-testid="copy-notice" style={VISUALLY_HIDDEN_STYLE}>
          {t('detail.copiedLinkNotice')}
        </span>
      ) : null}
    </>
  )
}

/** 复制失败：说明原因，并把地址放进只读输入框（聚焦即全选）供手动复制。 */
export function CopyFailure(props: {
  readonly copy: CopyState
  readonly url: string | null
  /** 失败区与地址框的测试 id；列表行复用同一组件时区分两处入口。 */
  readonly errorTestId?: string
  readonly inputTestId?: string
}): React.ReactElement | null {
  const t = useMessages()
  const { copy, url } = props
  if (copy.status !== 'failed' || url === null) return null
  return (
    <div
      role="alert"
      data-testid={props.errorTestId ?? 'copy-error'}
      style={{ ...DETAIL_ERROR_STYLE, ...DETAIL_STACK_STYLE }}
    >
      {copy.message}
      <input
        data-testid={props.inputTestId ?? 'detail-link'}
        aria-label={t('detail.linkLabel')}
        readOnly
        value={url}
        onFocus={(event) => {
          event.currentTarget.select()
        }}
        style={DETAIL_INPUT_STYLE}
      />
    </div>
  )
}

/** 补全候选与标签颜色：由详情视图按需读取一次，展开编辑器时才请求。 */
export interface OptionsState {
  readonly labels: SuggestionSource
  readonly assignees: SuggestionSource
  /** 标签名到 `#rrggbb` 颜色；没读到或没有颜色的标签不在表里。 */
  readonly labelColors: ReadonlyMap<string, string>
  /** 请求候选；已读到或正在读时什么也不做。 */
  readonly request: () => void
}

/** 属性条：标签组与分配人组同一行；后端缺的能力在下方一句话说明。 */
export function PropertyStrip(
  props: FieldProps & { readonly options: OptionsState },
): React.ReactElement {
  const t = useMessages()
  const { detail, busy, options } = props
  const unsupported = unsupportedActions(detail).map((id) => t(id))

  return (
    <div style={DETAIL_STACK_STYLE}>
      <div style={DETAIL_STRIP_STYLE}>
        <TokenGroup
          kind="label"
          name={t('detail.labels')}
          addLabel={t('detail.addLabels')}
          icon={<TagIcon />}
          values={detail.labels.map((name): TokenItem => ({
            kind: 'label',
            name,
            color: options.labelColors.get(name) ?? null,
          }))}
          emptyText={t('detail.noLabels')}
          placeholder={t('detail.searchLabels')}
          editable={detail.capabilities.labels}
          busy={busy}
          source={options.labels}
          onOpen={options.request}
          onChange={(labels) => {
            props.onApply({ labels })
          }}
        />
        <TokenGroup
          kind="assignee"
          name={t('detail.assignees')}
          addLabel={t('detail.addAssignees')}
          icon={<PersonIcon />}
          values={detail.assignees.map((user): TokenItem => ({ kind: 'assignee', user }))}
          emptyText={t('detail.unassigned')}
          placeholder={t('detail.searchAssignees')}
          editable={detail.capabilities.assignees}
          busy={busy}
          source={options.assignees}
          onOpen={options.request}
          onChange={(assignees) => {
            props.onApply({ assignees })
          }}
          onAssignSelf={() => {
            props.onApply({ assignSelf: true })
          }}
        />
      </div>
      {unsupported.length === 0 ? null : (
        <div data-testid="detail-unsupported-note" style={DETAIL_HINT_STYLE}>
          {t('detail.unsupported', {
            backend: backendLabel(detail.backend, t),
            actions: unsupported.join(t('common.listSeparator')),
          })}
        </div>
      )}
    </div>
  )
}

/** 属性条里的一个小块：标签或带头像的分配人。 */
type TokenItem =
  | {
      readonly kind: 'label'
      /** 标签名，也是写进补丁的值。 */
      readonly name: string
      readonly color: string | null
    }
  | {
      readonly kind: 'assignee'
      /** 分配人；登录名是写进补丁的值。 */
      readonly user: AvatarUser
    }

/** 小块写进补丁的值：标签名或登录名。 */
function tokenKey(item: TokenItem): string {
  return item.kind === 'label' ? item.name : item.user.login
}

/** 一组小块（标签或分配人）：前导图标、已有值、加号；加号展开带补全的编辑器。 */
function TokenGroup(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly addLabel: string
  readonly icon: React.ReactElement
  readonly values: readonly TokenItem[]
  readonly emptyText: string
  readonly placeholder: string
  readonly editable: boolean
  readonly busy: boolean
  readonly source: SuggestionSource
  readonly onOpen: () => void
  readonly onChange: (values: string[]) => void
  readonly onAssignSelf?: () => void
}): React.ReactElement {
  const { kind, values, busy } = props
  const [editing, setEditing] = React.useState(false)
  const keys = values.map(tokenKey)

  return (
    <div
      role="group"
      aria-label={props.name}
      data-testid={kind === 'label' ? 'detail-labels' : 'detail-assignees'}
      // 编辑时整组占满一行，候选列表才有地方展开。
      style={editing ? { ...DETAIL_GROUP_STYLE, flexBasis: '100%' } : DETAIL_GROUP_STYLE}
    >
      <span title={props.name} style={DETAIL_GROUP_ICON_STYLE}>
        {props.icon}
      </span>
      {values.length === 0 && !editing ? (
        <span style={DETAIL_TOKEN_EMPTY_STYLE}>{props.emptyText}</span>
      ) : null}
      {values.map((item) => (
        <Token
          key={tokenKey(item)}
          kind={kind}
          name={props.name}
          item={item}
          editable={props.editable}
          busy={busy}
          onRemove={() => {
            props.onChange(keys.filter((key) => key !== tokenKey(item)))
          }}
        />
      ))}
      {!props.editable ? null : editing ? (
        <TokenEditor
          kind={kind}
          name={props.name}
          placeholder={props.placeholder}
          busy={busy}
          selected={keys}
          source={props.source}
          onAdd={(value) => {
            if (!keys.includes(value)) props.onChange([...keys, value])
          }}
          onAssignSelf={props.onAssignSelf}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : (
        <button
          type="button"
          data-testid={`${kind}-edit`}
          data-hover="soft"
          aria-label={props.addLabel}
          title={props.addLabel}
          disabled={busy}
          onClick={() => {
            props.onOpen()
            setEditing(true)
          }}
          style={DETAIL_ADD_STYLE}
        >
          <PlusIcon />
        </button>
      )}
    </div>
  )
}

/**
 * 一个标签或分配人小块；可写时带圆形移除按钮。
 * 标签按仓库颜色着色；分配人带头像，文本优先用服务给的展示名。
 */
function Token(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly item: TokenItem
  readonly editable: boolean
  readonly busy: boolean
  readonly onRemove: () => void
}): React.ReactElement {
  const t = useMessages()
  const { item } = props
  const isAssignee = item.kind === 'assignee'
  const text = isAssignee ? authorName(item.user) : item.name
  const label = isAssignee
    ? t('detail.removeAssignee', { value: text })
    : t('detail.removeLabel', { value: text })
  const style: React.CSSProperties = {
    ...DETAIL_TOKEN_STYLE,
    ...(isAssignee ? { paddingLeft: 2 } : labelColorStyle(item.color)),
    ...(props.editable ? {} : { paddingRight: 9 }),
  }

  return (
    <span
      data-testid={`${props.kind}-chip`}
      style={style}
      {...(isAssignee ? { title: authorTitle(item.user, t) } : {})}
    >
      {isAssignee ? <UserAvatar user={item.user} role="assignee" size={16} /> : null}
      <span data-token-name="" style={isAssignee ? { marginLeft: 3 } : undefined}>
        {text}
      </span>
      {props.editable ? (
        <button
          type="button"
          data-testid={`${props.kind}-remove`}
          data-hover="soft"
          aria-label={label}
          title={label}
          disabled={props.busy}
          onClick={props.onRemove}
          style={{ ...DETAIL_TOKEN_REMOVE_STYLE, color: 'inherit', opacity: 0.7 }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </span>
  )
}

function unsupportedActions(detail: TicketDetail): MessageId[] {
  // 与宿主 `capability-unsupported` 的文案保持同一句式：哪个后端、缺哪项能力。
  const actions: MessageId[] = []
  if (!detail.capabilities.labels) actions.push('detail.unsupported.labels')
  if (!detail.capabilities.assignees) actions.push('detail.unsupported.assignees')
  if (!detail.capabilities.state) actions.push('detail.unsupported.state')
  if (detail.url === null) actions.push('detail.unsupported.link')
  return actions
}
