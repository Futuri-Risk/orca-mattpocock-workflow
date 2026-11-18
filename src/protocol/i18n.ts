/**
 * 面板的用户可见文案目录：`zh-CN` 与 `en` 两份，消息 id 一一对应。
 *
 * 这里只放纯数据与类型，不放解析或插值逻辑（那些在 `src/panel/i18n.ts`）：
 * protocol 是叶子模块，面板与 worker 共用同一份文案源。
 *
 * 约定：
 * - 消息 id 用点分分组（`tickets.*`、`overview.*`、`env.*`、`detail.*`、`help.*`、
 *   `flow.*`、`error.*`、`common.*`、`time.*`），语义按来源划分；
 * - 带参数的文案用 `{name}` 占位，参数名与类型在 {@link MessageParams} 里逐条声明；
 * - 品牌名（GitHub / GitLab / Gitea / MattWorkflow）、追踪标签名、工单标题与正文
 *   不翻译——它们是产品契约或用户内容，不属于界面文案。
 */

/** 面板支持的语言。 */
export const LOCALES = ['zh-CN', 'en'] as const

/** 语言的联合类型。 */
export type Locale = (typeof LOCALES)[number]

/** 插件设置项：界面语言。 */
export const LANGUAGE_SETTING_KEY = 'language'

/** 语言设置的取值：跟随宿主、固定中文或固定英文。 */
export const LANGUAGE_SETTINGS = ['auto', ...LOCALES] as const

/** 语言设置值的联合类型。 */
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number]

/**
 * 中文目录，也是消息 id 的来源。中文措辞是现有界面的原文，改动必须逐字核对。
 */
const ZH_CN = {
  // ── 通用 ────────────────────────────────────────────────────────────────
  'common.viewGroup': '视图',
  'common.comma': '，',
  'common.listSeparator': '、',
  'common.period': '。',
  'common.loadingTickets': '正在读取工单…',
  'common.live': '实时',
  'common.cache': '本地缓存',
  'common.identifyingRepository': '正在识别仓库…',
  'common.unknownRepository': '未识别到仓库',
  'common.noSnapshot': '尚无快照',
  'common.refresh': '刷新',
  'common.refreshBusy': '刷新中…',
  'common.recheck': '重新检查',
  'common.recheckBusy': '检查中…',
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.dismiss': '收起',
  'common.add': '添加',
  'common.copied': '已复制',

  // ── 视图页签与服务入口 ──────────────────────────────────────────────────
  'view.tickets': '列表',
  'view.overview': '概览',
  'view.env': '环境检查',
  'view.help': '流程帮助',
  'language.label': '语言',
  'language.effective': '当前：{language}',
  'language.autoEffective': '跟随宿主（{language}）',
  'language.zhCN': '中文',
  'language.en': 'English',

  // ── 相对时间 ────────────────────────────────────────────────────────────
  'time.justNow': '刚刚',
  'time.minutesAgo': '{n} 分钟前',
  'time.hoursAgo': '{n} 小时前',
  'time.daysAgo': '{n} 天前',

  // ── 后端与状态 ──────────────────────────────────────────────────────────
  'backend.markdown': '本地',
  'backend.markdownFull': '本地 Markdown',
  'backend.unknown': '未判定',
  'status.ready': '可接',
  'status.blocked': '阻塞',
  'status.open': '开放',
  'status.closed': '已关闭',
  'category.bug': 'bug',
  'category.enhancement': 'enhancement',
  'category.untriaged': '未定级',

  // ── 工单列表 ────────────────────────────────────────────────────────────
  'tickets.loadedTotal': '已加载 {loaded} / 共 {total}',
  'tickets.emptyRepo': '这个仓库还没有工单。',
  'tickets.emptyFiltered': '没有符合筛选条件的工单。',
  'tickets.loadMoreRemaining': '还有 {count} 张未加载',
  'tickets.loadMoreHint': '继续加载后面的工单',
  'tickets.loadingMore': '加载中…',
  'tickets.loadMore': '加载更多',
  'tickets.refreshFull': '全量刷新',
  'tickets.newFeature': '新建需求',
  'tickets.newFeatureHint': '把需求入池提示词复制到剪贴板',
  'tickets.newFeatureLabel': '新建需求：复制提示词',
  'tickets.newBug': 'bug',
  'tickets.newBugHint': '把缺陷入池提示词复制到剪贴板',
  'tickets.newBugLabel': 'bug：复制提示词',
  'tickets.filterGroup': '状态过滤',
  'tickets.layoutGroup': '布局',
  'tickets.layout.flat': '平铺',
  'tickets.layout.hierarchy': '父子',
  'tickets.layout.flatHint': '平铺：所有票按当前排序排成一条线',
  'tickets.layout.nativeHint': '父子：父子关系来自 GitHub 原生子工单',
  'tickets.layout.conventionHint': '父子：父子关系来自本地工单的 Parent: 行',
  'tickets.layout.giteaHint': '父子：父子关系来自 Gitea 工单正文首行的 Part of 约定',
  'tickets.layout.gitlabHint': '父子：父子关系来自 GitLab 工作项层级；epic 分组不在列表里',
  'tickets.layout.unavailableGitlab':
    '这次没有取到 GitLab 工作项层级，父子布局暂不可用；下次刷新会重试',
  'tickets.layout.unavailable': '当前后端不提供父子关系，父子布局不可用',
  'tickets.layout.fallback':
    '当前快照没有父子关系，已按平铺显示；偏好已保留，刷新成功或换回支持的后端后自动恢复。',
  'tickets.layout.coverage':
    '父子关系只覆盖已加载的 {loaded} / 共 {total} 张票；继续加载更多会补齐。',
  'tickets.childCount': '{count} 张子票',
  'tickets.collapse': '收起子票',
  'tickets.expand': '展开子票',
  'tickets.parentOutside': '父级 {parent}（不在列表）',
  'tickets.parentOutsideHint':
    '父级可能被筛选掉、还没加载、在别的仓库，或是 GitLab epic；继续加载或调整筛选可能补齐。',
  'tickets.sortGroup': '排序',
  'tickets.sortField': '排序字段',
  'tickets.sortAscHint': '升序，点击改为降序',
  'tickets.sortDescHint': '降序，点击改为升序',
  'tickets.stat.ready': '可接',
  'tickets.stat.blocked': '阻塞',
  'tickets.stat.open': '其他开放',
  'tickets.stat.closed': '已关闭',
  'tickets.filter.all': '全部',
  'tickets.filter.open': 'Open',
  'tickets.filter.closed': '已关闭',
  'tickets.filter.blocked': '阻塞',
  'tickets.filter.ready': '可接',
  'tickets.people.group': '我的工单筛选',
  'tickets.people.assigned': '分配给我',
  'tickets.people.assignedHint': '只显示分配给我的工单；数字按当前状态筛选统计',
  'tickets.people.created': '我创建的',
  'tickets.people.createdHint': '只显示我创建的工单；数字按当前状态筛选统计',
  'tickets.people.clear': '清除',
  'tickets.people.viewer': '@{login}',
  'tickets.people.viewerHint': '人员筛选按当前登录用户 @{login} 匹配',
  'tickets.sort.status': '状态',
  'tickets.sort.updated': '更新',
  'tickets.sort.created': '创建',
  'tickets.sort.number': '编号',
  'tickets.sort.title': '标题',
  'tickets.ageTitle': '创建：{created}；更新：{updated}',
  'tickets.refCopyLabel': '复制工单链接 {ref}',
  'tickets.refCopyHint': '复制工单链接：{url}',
  'tickets.refCopiedNotice': '已复制工单链接 {ref}。',

  // ── 概览 ────────────────────────────────────────────────────────────────
  'overview.loadedTickets': '已加载 {loaded} / 共 {total} 张',
  'overview.noTicketsLoaded': '未读取到工单',
  'overview.section.flow': '流量',
  'overview.opened30': '近 30 天新开',
  'overview.closed30': '近 30 天关闭',
  'overview.netFlow': '净流入',
  'overview.count': '{n} 张',
  'overview.underestimate': '可能低估',
  'overview.overestimate': '可能高估',
  'overview.section.age': '时效',
  'overview.ageCaption': '开放票距上次更新',
  'overview.section.composition': '构成',
  'overview.statusDistribution': '状态分布',
  'overview.categoryDistribution': '分类分布',
  'overview.section.attention': '关注清单',
  'overview.attentionCount': '{n} 张',
  'overview.attentionEmpty': '没有需要特别关注的票。',
  'overview.metricUnavailable': '不可用',
  'overview.sampleNote': '样本 {loaded}/{total}',
  'overview.pressure': '压力总览',
  'overview.pressureTierHint': '整体档位取三个维度里最重的一档',
  'overview.pressureNote': '整体档位取三个维度里最重的一档',
  'overview.pressureCoverage': '；按已加载的 {loaded} / 共 {total} 张判定。',
  'overview.provisional': '暂估',
  'overview.dimensionHint': '看{basis}',
  'overview.tierMeterLabel': '{name}：{tier}',
  'overview.metric.backlog': '开放积压',
  'overview.metric.ready': '可接容量',
  'overview.metric.triage': '待 triage',
  'overview.metric.blockedRatio': '阻塞占比',
  'overview.metric.chain': '最长阻塞链',
  'overview.metric.stalled': '停滞票',
  'overview.metric.stale': '陈旧票',
  'overview.metric.oldest': '最久未动',
  'overview.unit.layers': '{n} 层',
  'overview.unit.days': '{n} 天',

  // ── 压力档位与维度 ──────────────────────────────────────────────────────
  'pressure.tier.light': '轻松',
  'pressure.tier.normal': '正常',
  'pressure.tier.tight': '吃紧',
  'pressure.dimension.scale': '规模',
  'pressure.dimension.blocking': '阻塞',
  'pressure.dimension.freshness': '时效',
  'pressure.basis.scale': '开放积压与近 30 天净流入',
  'pressure.basis.blocking': '阻塞票占开放票的比例',
  'pressure.basis.freshness': '陈旧率与停滞票',
  'pressure.gap.no-timestamps': '后端不提供工单时间，时效与流量指标不可用。',
  'pressure.gap.no-closed-time': '后端不提供关闭时间，关闭速度与净流入不可用。',
  'pressure.gap.no-dependency-edges': '后端不提供阻塞依赖边，最长阻塞链不可用。',
  'pressure.facts.none': '暂无可判定的指标。',
  'pressure.signal.backlog': '开放积压 {n} 张',
  'pressure.signal.netFlow': '近 30 天净流入 {sign}{n} 张',
  'pressure.signal.blockedRatio': '阻塞占比 {percent}',
  'pressure.signal.staleRatio': '陈旧率 {percent}',
  'pressure.signal.stalled': '停滞票 {n} 张',
  'pressure.gapNote.no-timestamps': '缺时间数据',
  'pressure.gapNote.no-closed-time': '缺关闭时间',
  'pressure.gapNote.no-dependency-edges': '缺依赖边',
  'attention.untriagedBug': '缺陷还没定性',
  'attention.stale': '陈旧 {n} 天未更新',
  'attention.mostBlocking': '被 {n} 张未关闭票挡住',
  'attention.oldestStalled': '停滞 {n} 天没人管',

  // ── 构成与图表 ──────────────────────────────────────────────────────────
  'distribution.ready': '可接',
  'distribution.blocked': '阻塞',
  'distribution.open': '其他开放',
  'distribution.closed': '已关闭',
  'distribution.bug': 'bug',
  'distribution.enhancement': 'enhancement',
  'distribution.untriaged': '未定级',
  'chart.opened': '新开',
  'chart.closed': '关闭',
  'chart.thisWeek': '本周',
  'chart.readoutOpened': '新开',
  'chart.readoutClosed': '关闭',
  'chart.flowSummary': '{range}：新开 {opened} 张{closed}',
  'chart.flowSummaryClosed': '，关闭 {n} 张',
  'chart.ageTooltip': '{label}：{count} 张',
  'chart.segmentSummaryItem': '{label} {count}（{percent}）',
  'chart.segmentTitle': '{title}：{summary}',
  'chart.segmentTooltip': '{label}：{count} 张（{percent}）',
  'age.week': '7 天内',
  'age.fortnight': '8–14 天',
  'age.month': '15–30 天',
  'age.older': '超过 30 天',

  // ── 环境检查 ────────────────────────────────────────────────────────────
  'env.summary': '环境检查 {passed}/{total}',
  'env.loading': '正在检查环境…',
  'env.noWorkspace':
    '当前会话没有工作区目录，无法检查环境。请在打开的工作区里重新打开面板。',
  'env.title.home': '用户主目录可解析',
  'env.title.backend': '已选择工单后端',
  'env.title.backendWith': '已选择工单后端（{backend}）',
  'env.title.cli.github': 'GitHub CLI (gh) 已安装',
  'env.title.cli.gitlab': 'GitLab CLI (glab) 已安装',
  'env.title.cli.gitea': 'Gitea CLI (tea) 已安装',
  'env.title.cliFallback': '命令行工具已安装',
  'env.title.auth.github': 'gh 已登录',
  'env.title.auth.gitlab': 'glab 已登录远端实例',
  'env.title.auth.gitea': 'tea 已登录远端实例',
  'env.title.authFallback': '命令行工具已登录',
  'env.title.repository.github': 'GitHub 仓库可达',
  'env.title.repository.gitlab': 'GitLab 仓库可达',
  'env.title.repository.gitea': 'Gitea 仓库可达',
  'env.title.repositoryFallback': '仓库可达',
  'env.title.orca': 'Orca 命令行可用',
  'env.title.workspace': '工作区已初始化',
  'env.title.localIssues': '本地工单目录可用',
  'env.title.skill': '技能 {skill} 已安装',
  'env.status.pass': '通过',
  'env.status.fail': '失败',
  'env.status.skipped': '跳过',
  'env.blockedBecause': '因为「{title}」未通过',
  'env.jumpTo': '跳到「{title}」',
  'env.capabilities': '能力诊断 · present {present} / missing {missing}',
  'env.capability.impact': '影响：{impact}',
  'env.capability.fix': '补法：{fix}',
  'env.category.hostService': '宿主服务',
  'env.category.uiExtension': '界面扩展点',
  'env.state.present': '可用',
  'env.state.missing': '缺失',
  'env.cap.cli.gh': 'GitHub CLI (gh) 已安装',
  'env.cap.cli.gh.impact': '读不到 GitHub 仓库的工单，列表与详情都不可用。',
  'env.cap.cli.gh.fix': '安装 gh：brew install gh',
  'env.cap.cli.ghAuth': 'gh 已登录',
  'env.cap.cli.ghAuth.impact': 'gh 没登录时读不到远端工单。',
  'env.cap.cli.ghAuth.fix': '运行 gh auth login',
  'env.cap.cli.glab': 'GitLab CLI (glab) 已安装',
  'env.cap.cli.glab.impact': '读不到 GitLab 仓库的工单。',
  'env.cap.cli.glab.fix': '安装 glab：brew install glab',
  'env.cap.cli.glabAuth': 'glab 已登录远端实例',
  'env.cap.cli.glabAuth.impact': 'glab 没登录时读不到远端工单。',
  'env.cap.cli.glabAuth.fix': '运行 glab auth login；自建实例要在登录时填实例地址',
  'env.cap.cli.tea': 'Gitea CLI (tea) 已安装',
  'env.cap.cli.tea.impact': '读不到 Gitea 仓库的工单。',
  'env.cap.cli.tea.fix': '安装 tea：brew install tea',
  'env.cap.cli.teaAuth': 'tea 已登录远端实例',
  'env.cap.cli.teaAuth.impact': 'tea 没登录时读不到远端工单。',
  'env.cap.cli.teaAuth.fix': '运行 tea login add',
  'env.cap.remote': '远端地址可解析',
  'env.cap.remote.impact': '认不出仓库用哪个后端，列表读不到工单。',
  'env.cap.remote.fix': '核对 origin 指向的远端地址：git remote -v',
  'env.cap.workspace': '工作区可初始化',
  'env.cap.workspace.impact': '工作区没按插件要求初始化，本地工单目录与技能都不可用。',
  'env.cap.workspace.fix': '让 agent 运行 setup-matt-pocock-skills 初始化当前工作区',
  'env.cap.localIssues': '本地工单目录可读',
  'env.cap.localIssues.impact': '本地 Markdown 后端读不到 .scratch 里的工单。',
  'env.cap.localIssues.fix': '按 docs/local-issues.md 的约定放好工单文件',
  'env.cap.panelBridge': '面板桥',
  'env.cap.panelBridge.impact': '面板发不出请求，工单列表与环境检查都打不开。',
  'env.cap.panelBridge.fix': '升级宿主到提供插件桥的版本后重启面板',
  'env.cap.clipboard': '剪贴板',
  'env.cap.clipboard.impact':
    '面板内一键复制可能被宿主策略拒绝，会自动尝试兼容写入，仍失败时只能用手动复制区。',
  'env.cap.clipboard.fix': '点提示词按钮；写入失败时面板会自动展开手动复制区，按 ⌘C 复制',
  'env.cap.worker': 'worker 可达',
  'env.cap.worker.impact': '面板发不出业务请求，工单列表与环境检查都打不开。',
  'env.cap.worker.fix': '确认插件的 worker 已启动：查看宿主日志里的插件启动报错',
  'env.cap.skill': '技能 {skill} 已安装',
  'env.cap.skill.impact': '相关的手势与提示词在会话里不可用。',
  'env.cap.skill.fix':
    '把 {skill} 装到 Orca 扫描的技能目录（~/.claude/skills、~/.codex/skills、~/.agents/skills 或仓库的 .agents/skills）',

  // ── 环境检查：快照库 ────────────────────────────────────────────────────
  'env.cache.title': '本地快照库',
  'env.cache.loading': '正在读取本地快照库…',
  'env.cache.entriesUnknown': '条目数未知',
  'env.cache.entries': '按仓库计：{n} 份缓存',
  'env.cache.writtenUnknown': '写入时间未知',
  'env.cache.neverWritten': '还没有写入记录',
  'env.cache.lastWritten': '最近写入：{time}',
  'env.cache.clear': '清除本地快照库',
  'env.cache.clearing': '清除中…',
  'env.cache.cleared': '已清除 {n} 条本地快照。',
  'env.cache.failed': '本地快照库操作失败：{detail}',
  'env.cache.unknownError': '未知错误',

  // ── 环境检查：解决方式 ──────────────────────────────────────────────────
  'env.remedy.installCli.named': '安装 {cli}：命令在本机终端运行，装好后重新检查。',
  'env.remedy.installCli.unnamed':
    '安装后端对应的命令行工具（gh / glab / tea），装好后重新检查。',
  'env.remedy.installCli.link': '{cli} 安装说明',
  'env.remedy.installOrca.summary':
    '安装 Orca，或把 ORCA_CLI_COMMAND 指到 Orca 自带的命令行；改好后重新检查。',
  'env.remedy.installOrca.link': 'Orca 下载与文档',
  'env.remedy.loginCli.named':
    '登录 {cli}；自建实例要在登录时填实例地址，登录后重新检查。',
  'env.remedy.loginCli.unnamed': '登录后端对应的命令行工具（gh / glab / tea），登录后重新检查。',
  'env.remedy.installSkill.summary': '把 {skill} 技能装到 Orca 扫描的技能目录；装好后重新检查。',
  'env.remedy.installSkill.unknown': '缺失技能',
  'env.remedy.installSkill.link': 'mattpocock/skills 仓库',
  'env.remedy.initWorkspace.summary': '让 agent 运行 {skill}，把工作区按面板要求初始化。',
  'env.remedy.initWorkspace.prompt':
    '初始化当前工作区。环境检查项「{title}」未通过：{detail}。',
  'env.remedy.initWorkspace.promptTail': '按技能完成初始化后告诉我，我再重新检查。',
  'env.remedy.placeLocalIssues.summary':
    '把工单放进工作区的 .scratch/<feature>/issues/，每个文件开头写 Status: 行；约定见 docs/local-issues.md。',
  'env.remedy.placeLocalIssues.prompt':
    '环境检查项「{title}」未通过：{detail}。按 docs/local-issues.md 的约定，在当前工作区的 .scratch/<feature>/issues/ 下补上本地工单文件（文件名以编号开头，开头写 # 标题 与 Status: 行）。放好后告诉我，我再重新检查。',
  'env.remedy.checkRepositoryAccess.summary':
    '核对当前账号对 {repository} 的访问权限；命令只读，不会改动仓库。',
  'env.remedy.remoteRepository': '远端仓库',
  'env.remedy.checkRemoteAddress.summary': '核对 origin 指向的仓库地址；远端写错时先改正，再重新检查。',
  'env.remedy.checkNetwork.summary': '网络不可达：检查代理与网络设置，确认能访问代码托管服务后重新检查。',
  'env.remedy.checkHome.summary':
    '宿主进程没有可用的用户主目录。在启动 Orca 的终端或服务配置里设置 HOME，然后重启 Orca；命令只核对当前环境。',
  'env.remedy.hostLogs': 'Orca 的插件日志目录',
  'env.remedy.checkLogs.summary': '探测没有返回结果。宿主日志在 {logs} 下，最新一份就是本次启动的报告。',
  'env.remedy.fixBackend.summary': '修好后端选择：核对 origin 远端，或补上 glab / tea 的安装与登录。',
  'env.remedy.fixBackend.prompt':
    '环境检查项「{title}」未通过：{detail}。检查当前仓库的 origin 远端：GitHub 仓库要指向 github.com；GitLab 自建实例需要安装并登录 glab；Gitea 实例需要安装并登录 tea。修好后告诉我，我再重新检查。',
  'env.remedy.retry.summary':
    '重新检查一次，确认是否为偶发失败；仍然失败时看 {logs} 下最新的启动报告。',
  'env.remedy.copyCommand': '复制命令',
  'env.remedy.commandNoun': '命令',
  'env.remedy.copied': '已复制',
  'env.remedy.copyFailed': '复制失败，请手动选择{noun}。',
  'env.remedy.copyPrompt': '复制提示词',
  'env.remedy.copyPromptAria': '复制提示词',
  'env.remedy.manualPrompt': '手动复制',
  'env.remedy.manualPromptAria': '手动复制提示词',
  'env.remedy.installing': '安装中…',
  'env.remedy.install': '安装 {skill}',
  'env.remedy.installFailed': '安装失败：{detail}',
  'env.remedy.installSummary': '已安装 {count} 个技能。',
  'env.remedy.installSummaryPartial': '已安装 {installed} 个技能，{failed} 个失败：{reason}',
  'env.remedy.unknownReason': '未知原因',

  // ── 工单详情 ────────────────────────────────────────────────────────────
  'detail.loading': '正在读取工单详情…',
  'detail.back': '返回列表',
  'detail.backHint': '返回列表（Esc）',
  'detail.backTo': '返回 {ref}',
  'detail.backToTitle': '返回 {ref}（Esc）',
  'detail.blockers.title': '阻塞项',
  'detail.blockers.expand': '展开查看阻塞项',
  'detail.blockers.collapse': '收起阻塞项',
  'detail.blockers.unloaded': '未加载',
  'detail.blockers.unloadedTitle': '这张阻塞票不在当前列表快照里',
  'detail.blockers.hint': '{hint}；{action}',
  'detail.blockers.openTitle': '打开 {ref}：{title}',
  'detail.blockers.toggle': '{label}：{hint}',
  'detail.openInBrowser': '在浏览器打开 {url}',
  'detail.createdAt': '创建于 {time}',
  'detail.updatedAt': '更新于 {time}',
  'detail.commentCount': '{n} 条评论',
  'detail.loadFailed': '读取工单详情失败。',
  'detail.refresh': '刷新工单',
  'detail.refreshing': '正在刷新工单…',
  'detail.refreshFailed': '刷新失败：{detail}',
  'detail.close': '关闭工单',
  'detail.reopen': '重新打开',
  'detail.copyLink': '复制链接',
  'detail.copyLinkWithUrl': '复制链接 {url}',
  'detail.copiedLinkNotice': '已复制链接地址。',
  'detail.linkLabel': '工单链接',
  'detail.labels': '标签',
  'detail.addLabels': '添加标签',
  'detail.removeLabel': '移除标签 {value}',
  'detail.noLabels': '无标签',
  'detail.searchLabels': '搜索或输入标签',
  'detail.assignees': '分配人',
  'detail.addAssignees': '添加分配人',
  'detail.removeAssignee': '移除分配人 {value}',
  'detail.unassigned': '未分配',
  'detail.searchAssignees': '搜索或输入用户名',
  'detail.assignSelf': '分配给我',
  'detail.unsupported': '当前后端（{backend}）不支持{actions}。',
  'detail.unsupported.labels': '修改标签',
  'detail.unsupported.assignees': '修改分配人',
  'detail.unsupported.state': '关闭或重开',
  'detail.unsupported.link': '提供链接地址',
  'detail.body': '正文',
  'detail.noBody': '这张工单没有正文。',
  'detail.comments': '评论（{n}）',
  'detail.noComments': '还没有评论。',
  'detail.commentBy': '{author}的评论',
  'detail.unnamed': '未署名',
  'detail.verb.created': '创建于',
  'detail.verb.commented': '评论于',
  'detail.authorBadge': '作者',
  'detail.more': '更多操作',
  'detail.delete.menu': '删除工单…',
  'detail.delete.title': '永久删除 {ref}？',
  'detail.delete.body': '「{title}」和它的全部评论会从 {backend} 上删除，无法恢复。',
  'detail.delete.confirmPrefix': '输入 ',
  'detail.delete.confirmSuffix': ' 确认：',
  'detail.delete.deleting': '正在删除…',
  'detail.delete.confirm': '永久删除',
  'detail.combobox.aria': '要添加的{name}',
  'detail.combobox.suggestions': '候选',
  'detail.combobox.loading': '正在读取候选…',
  'detail.combobox.unavailable': '{reason}可以直接输入后回车添加。',
  'detail.combobox.noMore': '没有更多候选。',
  'detail.combobox.noMatch': '没有匹配的候选，回车添加“{query}”。',
  'detail.optionsFailed': '读取候选失败：{detail}',

  // ── 头像与作者 ──────────────────────────────────────────────────────────
  'avatar.role.creator': '创建人',
  'avatar.role.commenter': '评论作者',
  'avatar.role.assignee': '分配人',
  'avatar.role.candidate': '可分配用户',
  'avatar.unnamed': '未署名',
  'avatar.label': '{role}：{name}',
  'author.title': '{name}（@{login}）',

  // ── 技能动作与 worktree ─────────────────────────────────────────────────
  'skill.action.closed': '已关闭',
  'skill.action.blocked': '阻塞 {n}',
  'skill.action.wontfix': 'wontfix',
  'skill.action.readyForHuman': '需人工实现',
  'skill.hint.closed': '工单已关闭，不再开工',
  'skill.hint.blocked': '还有未关闭的阻塞工单，依赖解开后才开工',
  'skill.hint.wontfix': '已标记 wontfix，不再处理',
  'skill.hint.readyForHuman': '已标记 ready-for-human，由人工实现',
  'skill.hint.needsTriage': '带 needs-triage，先按 triage 状态机定性并补标签',
  'skill.hint.needsInfo': '带 needs-info，先追问缺失信息',
  'skill.hint.bug': '带 ready-for-agent 且分类为 bug，先建立复现回路再定位根因',
  'skill.hint.readyForAgent': '带 ready-for-agent，按规格实现',
  'skill.hint.untriaged': '没有 triage 状态标签，先按状态机分类',
  'skill.badge.aria': '{label}：{hint}',
  'skill.badge.copiedHint': '{hint}；提示词已复制',
  'worktree.reason.closed': '工单已关闭',
  'worktree.reason.blocked': '还有未关闭的阻塞票',
  'worktree.reason.blockedCount': '还有 {n} 张未关闭的阻塞票',
  'worktree.reason.localOnly': '本地工单没有远端链接，无法挂到 worktree',
  'worktree.action': '建 worktree',
  'worktree.actionCompact': 'worktree',
  'worktree.busy': '创建中…',
  'worktree.busyHint': '正在创建 worktree，请稍候',
  'worktree.hint': '为这张工单创建 Orca worktree',
  'worktree.aria': '{action}：{hint}',
  'worktree.notice.created': '已创建 worktree，Orca 已切到新工作区。',
  'worktree.notice.existing': '这张票已经有 worktree（已存在），没有重复创建。',
  'worktree.branch': '分支',
  'worktree.path': '路径',
  'worktree.reference': '工单',
  'worktree.copyPath': '复制路径',
  'worktree.copiedPath': '已复制路径',
  'worktree.copyFailed': '复制失败，请手动选中路径。',
  'worktree.openEnvCheck': '查看环境检查',

  // ── 提示词复制 ──────────────────────────────────────────────────────────
  'copy.copied': '提示词已复制到剪贴板，粘贴到会话里即可使用。',
  'copy.manualHint': '下面的文本框已全选，按 ⌘C 复制。',
  'copy.manualNotice': '{reason}下面的文本框已全选，按 ⌘C 复制。',
  'copy.clipboardUnavailable': '复制失败：当前环境不允许写入剪贴板。',
  'copy.fieldAria': '提示词，手动复制',

  // ── 错误 ────────────────────────────────────────────────────────────────
  'error.gh-missing': '未找到 gh 命令，请先安装 GitHub CLI（https://cli.github.com）。',
  'error.gh-unauthenticated': 'gh 未登录，请运行 gh auth login 后重试。',
  'error.glab-missing': '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
  'error.glab-unauthenticated': 'glab 未登录或令牌已失效，请运行 glab auth login 后重试。',
  'error.tea-missing': '未找到 tea 命令，请先安装 Gitea CLI（https://gitea.com/gitea/tea）。',
  'error.tea-unauthenticated': 'tea 未登录该实例或令牌已失效，请运行 tea login add 后重试。',
  'error.markdown-read-failed': '读取 .scratch 里的工单失败，请检查文件读取权限。',
  'error.ticket-not-found': '找不到这张工单，它可能已被删除。',
  'error.orca-missing': '未找到 Orca 命令行，请先在环境检查里确认安装或设置 ORCA_CLI_COMMAND。',
  'error.viewEnvCheck': '查看环境检查',
  'error.noWorkspaceTickets': '当前会话没有工作区目录，无法读取工单。',
  'error.staleData': '数据可能不是最新的',
  'error.bridgeUnavailable': 'Orca 插件桥不可用',
  'error.badResponse': 'worker 返回的响应格式不正确。',
  'error.requestFailedUnknown': '请求 worker 失败：未知错误',
  'error.requestFailed': '请求 worker 失败：{message}{suffix}',
  'error.requestCodeSuffix': '（{code}）',

  // ── 工作区候选 ──────────────────────────────────────────────────────────
  'workspace.pickerTitle': '认不到当前工作区，点「使用」选一个仓库目录：',
  'workspace.use': '使用',
  'workspace.useAria': '使用 {label}',

  // ── 流程帮助与流程定义 ──────────────────────────────────────────────────
  'help.back': '← 返回',
  'help.title': '流程帮助',
  'help.intro':
    '入池只建票、不处理；处理从票出发，每一步都在命令之间停下，等你发下一条命令。',
  'help.tabsAria': '场景',
  'help.legend.plugin': 'mattwf- 插件命令',
  'help.legend.matt': 'matt 技能',
  'help.legend.stop': 'agent 停下，等你发下一条命令',
  'flow.command.intakeBug.summary': '把缺陷报告写成原始工单',
  'flow.command.intakeFeature.summary': '把需求写成原始工单',
  'flow.command.triage.summary': '定性原始工单',
  'flow.command.toSpec.summary': '写成规格',
  'flow.command.toTickets.summary': '拆成可接的工单',
  'flow.command.grillWithDocs.summary': '访谈需求',
  'flow.command.wayfinder.summary': '画决策地图',
  'flow.command.diagnosingBugs.summary': '诊断难查的缺陷',
  'flow.command.implement.summary': '按规格实现',
  'flow.command.codeReview.summary': '两轴评审改动',
  'flow.command.pr.summary': '写 PR 正文',
  'flow.command.intakeBug.description': '把缺陷报告写成原始工单；只入池，不处理。',
  'flow.command.intakeFeature.description': '把需求写成原始工单；只入池，不处理。',
  'flow.skill.intake.bug.intro':
    '你在把用户报的缺陷写进当前仓库的工单池。这一步只建票，不定性、不处理。',
  'flow.skill.intake.bug.hardInfo': '现象、复现步骤、预期行为',
  'flow.skill.intake.bug.section1': '发生了什么',
  'flow.skill.intake.bug.section2': '预期',
  'flow.skill.intake.bug.section3': '复现步骤',
  'flow.skill.intake.bug.section4': '补充信息',
  'flow.skill.intake.feature.intro':
    '你在把用户说的需求写进当前仓库的工单池。这一步只建票，不访谈、不写规格。',
  'flow.skill.intake.feature.hardInfo': '问题、期望结果',
  'flow.skill.intake.feature.section1': '问题',
  'flow.skill.intake.feature.section2': '期望结果',
  'flow.skill.intake.feature.section3': '背景',
  'intake.bug.slot1': '现象：',
  'intake.bug.slot2': '复现步骤：',
  'intake.bug.slot3': '预期行为：',
  'intake.feature.slot1': '需求（一句话）：',
  'flow.nextStep.triage.when': '默认；把原始票交给 triage 定性，由它判断去向。',
  'flow.nextStep.toSpec.when': '本次对话已经把需求讨论清楚时，在同一会话里把这张票原地写成规格。',
  'flow.nextStep.toSpec.reminder': '原地转规格时按需调整标签。',
  'flow.nextStep.grillWithDocs.when': '需求还模糊、但一个会话装得下时，先把需求问清楚。',
  'flow.nextStep.wayfinder.when': '一个会话装不下的大工作时，先画出决策地图。',
  'flow.skill.ticketReference': '<票的引用>',
  'flow.diagram.intake-triage.title': '入池与 triage',
  'flow.diagram.intake-triage.summary': '原始报告先变成池里的票，再由 triage 定性。',
  'flow.diagram.feature-chain.title': '需求链',
  'flow.diagram.feature-chain.summary':
    '需求先入池，再按情况走定性、访谈或画图；之后写规格、拆票、实现。',
  'flow.diagram.bug-chain.title': '缺陷链',
  'flow.diagram.bug-chain.summary': '缺陷一律先 triage；难查的再诊断，根因清楚的直接实现。',
  'flow.diagram.choose-interview.title': '访谈还是画图',
  'flow.diagram.choose-interview.summary': '需求需要讨论时，按一个会话装不装得下来选。',
  'flow.node.defect': '缺陷',
  'flow.node.feature': '需求',
  'flow.node.triage': '定性',
  'flow.node.feature-chain.intakeFeature': '一句话需求',
  'flow.node.feature-chain.triage': '默认',
  'flow.node.feature-chain.toSpec': '讨论已清楚',
  'flow.node.feature-chain.grillWithDocs': '需求还模糊',
  'flow.node.feature-chain.wayfinder': '一个会话装不下',
  'flow.node.feature-chain.toSpecAfter': '走完之后',
  'flow.node.bug-chain.intakeBug': '三行槽位',
  'flow.node.bug-chain.diagnose': '确实难查',
  'flow.node.bug-chain.implement': '根因已经清楚',
  'flow.node.bug-chain.implementAfter': '诊断之后',
  'flow.node.choose-interview.state': '需求需要讨论',
  'flow.node.choose-interview.grill': '一个会话装得下',
  'flow.node.choose-interview.wayfinder': '一个会话装不下',
  'flow.diagram.after-implement.title': '实现之后',
  'flow.diagram.after-implement.summary':
    '实现完成后先评审；评审意见修完再写 PR 正文，合并后关票。',
  'flow.node.after-implement.done': '实现完成',
  'flow.node.after-implement.codeReview': '两轴评审',
  'flow.node.after-implement.reviewed': '评审意见已修完',
  'flow.node.after-implement.pr': '写 PR 正文',
  'flow.node.after-implement.merged': '已合并、票已关闭',
} as const satisfies Readonly<Record<string, string>>

/** 面板全部消息 id。 */
export type MessageId = keyof typeof ZH_CN

/** 一份语言的完整目录；漏键或多键都会在类型检查阶段失败。 */
export type Messages = Readonly<Record<MessageId, string>>

/**
 * 英文目录。与中文目录逐键对应；`satisfies Messages` 保证漏写一条就编译失败。
 */
const EN = {
  'common.viewGroup': 'View',
  'common.comma': ', ',
  'common.listSeparator': ', ',
  'common.period': '.',
  'common.loadingTickets': 'Loading tickets…',
  'common.live': 'Live',
  'common.cache': 'Local cache',
  'common.identifyingRepository': 'Identifying repository…',
  'common.unknownRepository': 'No repository identified',
  'common.noSnapshot': 'No snapshot yet',
  'common.refresh': 'Refresh',
  'common.refreshBusy': 'Refreshing…',
  'common.recheck': 'Check again',
  'common.recheckBusy': 'Checking…',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.dismiss': 'Dismiss',
  'common.add': 'Add',
  'common.copied': 'Copied',
  'view.tickets': 'Tickets',
  'view.overview': 'Overview',
  'view.env': 'Environment',
  'view.help': 'Workflow help',
  'language.label': 'Language',
  'language.effective': 'Current: {language}',
  'language.autoEffective': 'Follow host ({language})',
  'language.zhCN': '中文',
  'language.en': 'English',
  'time.justNow': 'just now',
  'time.minutesAgo': '{n} minutes ago',
  'time.hoursAgo': '{n} hours ago',
  'time.daysAgo': '{n} days ago',
  'backend.markdown': 'Local',
  'backend.markdownFull': 'Local Markdown',
  'backend.unknown': 'Not determined',
  'status.ready': 'Ready',
  'status.blocked': 'Blocked',
  'status.open': 'Open',
  'status.closed': 'Closed',
  'category.bug': 'bug',
  'category.enhancement': 'enhancement',
  'category.untriaged': 'Untriaged',
  'tickets.loadedTotal': 'Loaded {loaded} of {total}',
  'tickets.emptyRepo': 'No tickets in this repository yet.',
  'tickets.emptyFiltered': 'No tickets match the current filter.',
  'tickets.loadMoreRemaining': '{count} more not loaded',
  'tickets.loadMoreHint': 'Load more tickets',
  'tickets.loadingMore': 'Loading…',
  'tickets.loadMore': 'Load more',
  'tickets.refreshFull': 'Full refresh',
  'tickets.newFeature': 'New feature',
  'tickets.newFeatureHint': 'Copy the feature intake prompt to the clipboard',
  'tickets.newFeatureLabel': 'New feature: copy prompt',
  'tickets.newBug': 'bug',
  'tickets.newBugHint': 'Copy the bug intake prompt to the clipboard',
  'tickets.newBugLabel': 'bug: copy prompt',
  'tickets.filterGroup': 'Status filter',
  'tickets.layoutGroup': 'Layout',
  'tickets.layout.flat': 'Flat',
  'tickets.layout.hierarchy': 'Hierarchy',
  'tickets.layout.flatHint': 'Flat: every ticket follows the current sort in one list',
  'tickets.layout.nativeHint': 'Hierarchy: relationships come from GitHub sub-issues',
  'tickets.layout.conventionHint':
    'Hierarchy: relationships come from the Parent: line in local tickets',
  'tickets.layout.giteaHint':
    'Hierarchy: relationships come from the first-line Part of convention in Gitea issue bodies',
  'tickets.layout.gitlabHint':
    'Hierarchy: relationships come from GitLab work item hierarchy; epic groups are not in the list',
  'tickets.layout.unavailableGitlab':
    'This refresh could not read the GitLab work item hierarchy, so hierarchy layout is unavailable; the next refresh retries',
  'tickets.layout.unavailable':
    'This backend does not provide parent-child relationships, so hierarchy layout is unavailable',
  'tickets.layout.fallback':
    'This snapshot has no parent-child relationships, so the list is flat. Your preference is kept and returns when a refresh succeeds or you switch back to a capable backend.',
  'tickets.layout.coverage':
    'Parent-child relationships cover only the {loaded} loaded of {total} tickets; load more to fill the rest.',
  'tickets.childCount': '{count} sub-tickets',
  'tickets.collapse': 'Collapse sub-tickets',
  'tickets.expand': 'Expand sub-tickets',
  'tickets.parentOutside': 'Parent {parent} (not in list)',
  'tickets.parentOutsideHint':
    'The parent may be filtered out, not loaded yet, in another repository, or a GitLab epic; loading more or changing the filter may fill it in.',
  'tickets.sortGroup': 'Sort',
  'tickets.sortField': 'Sort field',
  'tickets.sortAscHint': 'Ascending; click for descending',
  'tickets.sortDescHint': 'Descending; click for ascending',
  'tickets.stat.ready': 'Ready',
  'tickets.stat.blocked': 'Blocked',
  'tickets.stat.open': 'Other open',
  'tickets.stat.closed': 'Closed',
  'tickets.filter.all': 'All',
  'tickets.filter.open': 'Open',
  'tickets.filter.closed': 'Closed',
  'tickets.filter.blocked': 'Blocked',
  'tickets.filter.ready': 'Ready',
  'tickets.people.group': 'My ticket filters',
  'tickets.people.assigned': 'Assigned to me',
  'tickets.people.assignedHint':
    'Show only tickets assigned to me; counts follow the status filter',
  'tickets.people.created': 'Created by me',
  'tickets.people.createdHint':
    'Show only tickets I created; counts follow the status filter',
  'tickets.people.clear': 'Clear',
  'tickets.people.viewer': '@{login}',
  'tickets.people.viewerHint': 'People filters match the current login @{login}',
  'tickets.sort.status': 'Status',
  'tickets.sort.updated': 'Updated',
  'tickets.sort.created': 'Created',
  'tickets.sort.number': 'Number',
  'tickets.sort.title': 'Title',
  'tickets.ageTitle': 'Created: {created}; updated: {updated}',
  'tickets.refCopyLabel': 'Copy link to {ref}',
  'tickets.refCopyHint': 'Copy link: {url}',
  'tickets.refCopiedNotice': 'Copied ticket link {ref}.',
  'overview.loadedTickets': 'Loaded {loaded} of {total}',
  'overview.noTicketsLoaded': 'No tickets loaded',
  'overview.section.flow': 'Flow',
  'overview.opened30': 'Opened in 30 days',
  'overview.closed30': 'Closed in 30 days',
  'overview.netFlow': 'Net flow',
  'overview.count': '{n}',
  'overview.underestimate': 'may be underestimated',
  'overview.overestimate': 'may be overestimated',
  'overview.section.age': 'Freshness',
  'overview.ageCaption': 'Open tickets since last update',
  'overview.section.composition': 'Composition',
  'overview.statusDistribution': 'Status distribution',
  'overview.categoryDistribution': 'Category distribution',
  'overview.section.attention': 'Attention',
  'overview.attentionCount': '{n}',
  'overview.attentionEmpty': 'Nothing needs special attention.',
  'overview.metricUnavailable': 'N/A',
  'overview.sampleNote': 'Sample {loaded}/{total}',
  'overview.pressure': 'Pressure',
  'overview.pressureTierHint': 'Overall tier is the heaviest of the three dimensions',
  'overview.pressureNote': 'Overall tier is the heaviest of the three dimensions',
  'overview.pressureCoverage': '; judged on {loaded} of {total} loaded tickets.',
  'overview.provisional': 'Provisional',
  'overview.dimensionHint': 'Based on {basis}',
  'overview.tierMeterLabel': '{name}: {tier}',
  'overview.metric.backlog': 'Open backlog',
  'overview.metric.ready': 'Ready capacity',
  'overview.metric.triage': 'Needs triage',
  'overview.metric.blockedRatio': 'Blocked share',
  'overview.metric.chain': 'Longest blocker chain',
  'overview.metric.stalled': 'Stalled',
  'overview.metric.stale': 'Stale',
  'overview.metric.oldest': 'Oldest update',
  'overview.unit.layers': '{n} levels',
  'overview.unit.days': '{n} days',
  'pressure.tier.light': 'Light',
  'pressure.tier.normal': 'Normal',
  'pressure.tier.tight': 'Tight',
  'pressure.dimension.scale': 'Scale',
  'pressure.dimension.blocking': 'Blocking',
  'pressure.dimension.freshness': 'Freshness',
  'pressure.basis.scale': 'open backlog and 30-day net flow',
  'pressure.basis.blocking': 'share of open tickets that are blocked',
  'pressure.basis.freshness': 'stale rate and stalled tickets',
  'pressure.gap.no-timestamps':
    'The backend provides no ticket timestamps; freshness and flow metrics are unavailable.',
  'pressure.gap.no-closed-time':
    'The backend provides no close time; close rate and net flow are unavailable.',
  'pressure.gap.no-dependency-edges':
    'The backend provides no blocking edges; the longest blocker chain is unavailable.',
  'pressure.facts.none': 'No metric can be judged yet.',
  'pressure.signal.backlog': 'Open backlog: {n}',
  'pressure.signal.netFlow': '30-day net flow: {sign}{n}',
  'pressure.signal.blockedRatio': 'Blocked share: {percent}',
  'pressure.signal.staleRatio': 'Stale rate: {percent}',
  'pressure.signal.stalled': 'Stalled: {n}',
  'pressure.gapNote.no-timestamps': 'no timestamp data',
  'pressure.gapNote.no-closed-time': 'no close time',
  'pressure.gapNote.no-dependency-edges': 'no dependency edges',
  'attention.untriagedBug': 'Bug not classified yet',
  'attention.stale': 'Stale: no update for {n} days',
  'attention.mostBlocking': 'Blocked by {n} open tickets',
  'attention.oldestStalled': 'Stalled: no activity for {n} days',
  'distribution.ready': 'Ready',
  'distribution.blocked': 'Blocked',
  'distribution.open': 'Other open',
  'distribution.closed': 'Closed',
  'distribution.bug': 'bug',
  'distribution.enhancement': 'enhancement',
  'distribution.untriaged': 'Untriaged',
  'chart.opened': 'Opened',
  'chart.closed': 'Closed',
  'chart.thisWeek': 'This week',
  'chart.readoutOpened': 'opened',
  'chart.readoutClosed': 'closed',
  'chart.flowSummary': '{range}: {opened} opened{closed}',
  'chart.flowSummaryClosed': ', {n} closed',
  'chart.ageTooltip': '{label}: {count}',
  'chart.segmentSummaryItem': '{label} {count} ({percent})',
  'chart.segmentTitle': '{title}: {summary}',
  'chart.segmentTooltip': '{label}: {count} ({percent})',
  'age.week': 'Within 7 days',
  'age.fortnight': '8–14 days',
  'age.month': '15–30 days',
  'age.older': 'Over 30 days',
  'env.summary': 'Environment check {passed}/{total}',
  'env.loading': 'Checking environment…',
  'env.noWorkspace':
    'This session has no workspace folder, so the environment cannot be checked. Reopen the panel inside a workspace.',
  'env.title.home': 'Home directory resolves',
  'env.title.backend': 'Ticket backend selected',
  'env.title.backendWith': 'Ticket backend selected ({backend})',
  'env.title.cli.github': 'GitHub CLI (gh) installed',
  'env.title.cli.gitlab': 'GitLab CLI (glab) installed',
  'env.title.cli.gitea': 'Gitea CLI (tea) installed',
  'env.title.cliFallback': 'Command-line tool installed',
  'env.title.auth.github': 'gh signed in',
  'env.title.auth.gitlab': 'glab signed in to the remote instance',
  'env.title.auth.gitea': 'tea signed in to the remote instance',
  'env.title.authFallback': 'Command-line tool signed in',
  'env.title.repository.github': 'GitHub repository reachable',
  'env.title.repository.gitlab': 'GitLab repository reachable',
  'env.title.repository.gitea': 'Gitea repository reachable',
  'env.title.repositoryFallback': 'Repository reachable',
  'env.title.orca': 'Orca command line available',
  'env.title.workspace': 'Workspace initialized',
  'env.title.localIssues': 'Local issues directory available',
  'env.title.skill': 'Skill {skill} installed',
  'env.status.pass': 'Pass',
  'env.status.fail': 'Fail',
  'env.status.skipped': 'Skipped',
  'env.blockedBecause': 'Blocked by “{title}”',
  'env.jumpTo': 'Go to “{title}”',
  'env.capabilities': 'Capabilities · present {present} / missing {missing}',
  'env.capability.impact': 'Impact: {impact}',
  'env.capability.fix': 'Fix: {fix}',
  'env.category.hostService': 'Host services',
  'env.category.uiExtension': 'UI extension points',
  'env.state.present': 'Available',
  'env.state.missing': 'Missing',
  'env.cap.cli.gh': 'GitHub CLI (gh) installed',
  'env.cap.cli.gh.impact': 'GitHub tickets cannot be read; lists and details are unavailable.',
  'env.cap.cli.gh.fix': 'Install gh: brew install gh',
  'env.cap.cli.ghAuth': 'gh signed in',
  'env.cap.cli.ghAuth.impact': 'Remote tickets cannot be read while gh is signed out.',
  'env.cap.cli.ghAuth.fix': 'Run gh auth login',
  'env.cap.cli.glab': 'GitLab CLI (glab) installed',
  'env.cap.cli.glab.impact': 'GitLab tickets cannot be read.',
  'env.cap.cli.glab.fix': 'Install glab: brew install glab',
  'env.cap.cli.glabAuth': 'glab signed in to the remote instance',
  'env.cap.cli.glabAuth.impact': 'Remote tickets cannot be read while glab is signed out.',
  'env.cap.cli.glabAuth.fix':
    'Run glab auth login; enter the instance address when signing in to a self-hosted instance',
  'env.cap.cli.tea': 'Gitea CLI (tea) installed',
  'env.cap.cli.tea.impact': 'Gitea tickets cannot be read.',
  'env.cap.cli.tea.fix': 'Install tea: brew install tea',
  'env.cap.cli.teaAuth': 'tea signed in to the remote instance',
  'env.cap.cli.teaAuth.impact': 'Remote tickets cannot be read while tea is signed out.',
  'env.cap.cli.teaAuth.fix': 'Run tea login add',
  'env.cap.remote': 'Remote address resolves',
  'env.cap.remote.impact': 'The ticket backend cannot be determined, so tickets cannot be read.',
  'env.cap.remote.fix': 'Check the origin remote: git remote -v',
  'env.cap.workspace': 'Workspace can be initialized',
  'env.cap.workspace.impact':
    'The workspace is not initialized for this plugin; local issues and skills are unavailable.',
  'env.cap.workspace.fix': 'Have the agent run setup-matt-pocock-skills for the current workspace',
  'env.cap.localIssues': 'Local issues directory readable',
  'env.cap.localIssues.impact':
    'The local Markdown backend cannot read tickets under .scratch.',
  'env.cap.localIssues.fix': 'Place ticket files as described in docs/local-issues.md',
  'env.cap.panelBridge': 'Panel bridge',
  'env.cap.panelBridge.impact':
    'The panel cannot send requests; tickets and the environment check cannot open.',
  'env.cap.panelBridge.fix': 'Upgrade the host to a version with the plugin bridge, then reopen the panel',
  'env.cap.clipboard': 'Clipboard',
  'env.cap.clipboard.impact':
    'One-click copy may be refused by host policy; a compatible write is attempted, and manual copy remains when that fails.',
  'env.cap.clipboard.fix':
    'Use the prompt button; if the write fails the panel opens a manual copy area, then press ⌘C',
  'env.cap.worker': 'Worker reachable',
  'env.cap.worker.impact':
    'The panel cannot send business requests; tickets and the environment check cannot open.',
  'env.cap.worker.fix': 'Confirm the plugin worker started: check the plugin startup error in the host log',
  'env.cap.skill': 'Skill {skill} installed',
  'env.cap.skill.impact': 'The related gestures and prompts are unavailable in sessions.',
  'env.cap.skill.fix':
    'Install {skill} into a skill directory Orca scans (~/.claude/skills, ~/.codex/skills, ~/.agents/skills, or the repository’s .agents/skills)',
  'env.cache.title': 'Local snapshot cache',
  'env.cache.loading': 'Reading the local snapshot cache…',
  'env.cache.entriesUnknown': 'Entry count unknown',
  'env.cache.entries': 'Per repository: {n} caches',
  'env.cache.writtenUnknown': 'Write time unknown',
  'env.cache.neverWritten': 'No writes yet',
  'env.cache.lastWritten': 'Last written: {time}',
  'env.cache.clear': 'Clear local snapshot cache',
  'env.cache.clearing': 'Clearing…',
  'env.cache.cleared': 'Cleared {n} local snapshots.',
  'env.cache.failed': 'Local snapshot cache operation failed: {detail}',
  'env.cache.unknownError': 'Unknown error',
  'env.remedy.installCli.named':
    'Install {cli}: run the command in a local terminal, then check again.',
  'env.remedy.installCli.unnamed':
    'Install the command-line tool for the backend (gh / glab / tea), then check again.',
  'env.remedy.installCli.link': '{cli} installation guide',
  'env.remedy.installOrca.summary':
    'Install Orca, or point ORCA_CLI_COMMAND at the command line bundled with Orca; then check again.',
  'env.remedy.installOrca.link': 'Orca downloads and docs',
  'env.remedy.loginCli.named':
    'Sign in to {cli}; enter the instance address for a self-hosted instance, then check again.',
  'env.remedy.loginCli.unnamed':
    'Sign in to the command-line tool for the backend (gh / glab / tea), then check again.',
  'env.remedy.installSkill.summary':
    'Install the {skill} skill into a skill directory Orca scans, then check again.',
  'env.remedy.installSkill.unknown': 'missing skill',
  'env.remedy.installSkill.link': 'mattpocock/skills repository',
  'env.remedy.initWorkspace.summary':
    'Have the agent run {skill} to initialize the workspace as the panel expects.',
  'env.remedy.initWorkspace.prompt':
    'Initialize the current workspace. Environment check “{title}” failed: {detail}.',
  'env.remedy.initWorkspace.promptTail':
    'Tell me when the skill has finished, and I will check again.',
  'env.remedy.placeLocalIssues.summary':
    'Put tickets under the workspace’s .scratch/<feature>/issues/, with a Status: line at the top of each file; see docs/local-issues.md.',
  'env.remedy.placeLocalIssues.prompt':
    'Environment check “{title}” failed: {detail}. Following docs/local-issues.md, add the local ticket files under the current workspace’s .scratch/<feature>/issues/ (file names start with the number, and each file starts with a # title and a Status: line). Tell me when they are in place, and I will check again.',
  'env.remedy.checkRepositoryAccess.summary':
    'Check this account’s access to {repository}; the command is read-only and does not change the repository.',
  'env.remedy.remoteRepository': 'the remote repository',
  'env.remedy.checkRemoteAddress.summary':
    'Check the repository address origin points at; fix a wrong remote, then check again.',
  'env.remedy.checkNetwork.summary':
    'Network unreachable: check proxy and network settings, confirm the code host is reachable, then check again.',
  'env.remedy.checkHome.summary':
    'The host process has no usable home directory. Set HOME in the terminal or service configuration that starts Orca, then restart Orca; the command only inspects the current environment.',
  'env.remedy.hostLogs': 'Orca’s plugin log directory',
  'env.remedy.checkLogs.summary':
    'The probe returned no result. Host logs are under {logs}; the newest one is this startup’s report.',
  'env.remedy.fixBackend.summary':
    'Fix the backend choice: check the origin remote, or install and sign in to glab / tea.',
  'env.remedy.fixBackend.prompt':
    'Environment check “{title}” failed: {detail}. Check the current repository’s origin remote: GitHub repositories must point at github.com; self-hosted GitLab instances need glab installed and signed in; Gitea instances need tea installed and signed in. Tell me when it is fixed, and I will check again.',
  'env.remedy.retry.summary':
    'Check once more in case the failure was transient; if it persists, read the newest startup report under {logs}.',
  'env.remedy.copyCommand': 'Copy command',
  'env.remedy.commandNoun': 'command',
  'env.remedy.copied': 'Copied',
  'env.remedy.copyFailed': 'Copy failed; select the {noun} manually.',
  'env.remedy.copyPrompt': 'Copy prompt',
  'env.remedy.copyPromptAria': 'Copy prompt',
  'env.remedy.manualPrompt': 'Copy manually',
  'env.remedy.manualPromptAria': 'Copy prompt manually',
  'env.remedy.installing': 'Installing…',
  'env.remedy.install': 'Install {skill}',
  'env.remedy.installFailed': 'Installation failed: {detail}',
  'env.remedy.installSummary': 'Installed {count} skills.',
  'env.remedy.installSummaryPartial': 'Installed {installed} skills; {failed} failed: {reason}',
  'env.remedy.unknownReason': 'Unknown reason',
  'detail.loading': 'Loading ticket details…',
  'detail.back': 'Back to list',
  'detail.backHint': 'Back to list (Esc)',
  'detail.backTo': 'Back to {ref}',
  'detail.backToTitle': 'Back to {ref} (Esc)',
  'detail.blockers.title': 'Blocking tickets',
  'detail.blockers.expand': 'Show blocking tickets',
  'detail.blockers.collapse': 'Hide blocking tickets',
  'detail.blockers.unloaded': 'Not loaded',
  'detail.blockers.unloadedTitle': 'This blocking ticket is outside the current list snapshot',
  'detail.blockers.hint': '{hint}; {action}',
  'detail.blockers.openTitle': 'Open {ref}: {title}',
  'detail.blockers.toggle': '{label}: {hint}',
  'detail.openInBrowser': 'Open {url} in the browser',
  'detail.createdAt': 'Created {time}',
  'detail.updatedAt': 'Updated {time}',
  'detail.commentCount': '{n} comments',
  'detail.loadFailed': 'Failed to load ticket details.',
  'detail.refresh': 'Refresh ticket',
  'detail.refreshing': 'Refreshing ticket…',
  'detail.refreshFailed': 'Refresh failed: {detail}',
  'detail.close': 'Close ticket',
  'detail.reopen': 'Reopen',
  'detail.copyLink': 'Copy link',
  'detail.copyLinkWithUrl': 'Copy link {url}',
  'detail.copiedLinkNotice': 'Link copied.',
  'detail.linkLabel': 'Ticket link',
  'detail.labels': 'Labels',
  'detail.addLabels': 'Add labels',
  'detail.removeLabel': 'Remove label {value}',
  'detail.noLabels': 'No labels',
  'detail.searchLabels': 'Search or type a label',
  'detail.assignees': 'Assignees',
  'detail.addAssignees': 'Add assignees',
  'detail.removeAssignee': 'Remove assignee {value}',
  'detail.unassigned': 'Unassigned',
  'detail.searchAssignees': 'Search or type a username',
  'detail.assignSelf': 'Assign to me',
  'detail.unsupported': 'The current backend ({backend}) does not support {actions}.',
  'detail.unsupported.labels': 'editing labels',
  'detail.unsupported.assignees': 'editing assignees',
  'detail.unsupported.state': 'closing or reopening',
  'detail.unsupported.link': 'providing a link',
  'detail.body': 'Body',
  'detail.noBody': 'This ticket has no body.',
  'detail.comments': 'Comments ({n})',
  'detail.noComments': 'No comments yet.',
  'detail.commentBy': "{author}'s comment",
  'detail.unnamed': 'Unnamed',
  'detail.verb.created': 'created',
  'detail.verb.commented': 'commented',
  'detail.authorBadge': 'Author',
  'detail.more': 'More actions',
  'detail.delete.menu': 'Delete ticket…',
  'detail.delete.title': 'Permanently delete {ref}?',
  'detail.delete.body':
    '“{title}” and all its comments will be deleted from {backend}; this cannot be undone.',
  'detail.delete.confirmPrefix': 'Type ',
  'detail.delete.confirmSuffix': ' to confirm:',
  'detail.delete.deleting': 'Deleting…',
  'detail.delete.confirm': 'Delete permanently',
  'detail.combobox.aria': 'Add {name}',
  'detail.combobox.suggestions': 'Suggestions',
  'detail.combobox.loading': 'Loading suggestions…',
  'detail.combobox.unavailable': '{reason} You can type a value and press Enter to add it.',
  'detail.combobox.noMore': 'No more suggestions.',
  'detail.combobox.noMatch': 'No matching suggestions; press Enter to add “{query}”.',
  'detail.optionsFailed': 'Failed to load suggestions: {detail}',
  'avatar.role.creator': 'Creator',
  'avatar.role.commenter': 'Commenter',
  'avatar.role.assignee': 'Assignee',
  'avatar.role.candidate': 'Assignable user',
  'avatar.unnamed': 'Unnamed',
  'avatar.label': '{role}: {name}',
  'author.title': '{name} (@{login})',
  'skill.action.closed': 'Closed',
  'skill.action.blocked': 'Blocked {n}',
  'skill.action.wontfix': 'wontfix',
  'skill.action.readyForHuman': 'Needs a human',
  'skill.hint.closed': 'The ticket is closed; no work starts.',
  'skill.hint.blocked': 'Open blockers remain; work starts after they clear.',
  'skill.hint.wontfix': 'Marked wontfix; no further work.',
  'skill.hint.readyForHuman': 'Marked ready-for-human; a person implements it.',
  'skill.hint.needsTriage': 'Carries needs-triage; classify it with the triage state machine first.',
  'skill.hint.needsInfo': 'Carries needs-info; ask for the missing information first.',
  'skill.hint.bug': 'Ready-for-agent and classified as bug; build a reproduction before locating the root cause.',
  'skill.hint.readyForAgent': 'Carries ready-for-agent; implement to spec.',
  'skill.hint.untriaged': 'No triage status label; classify it with the state machine first.',
  'skill.badge.aria': '{label}: {hint}',
  'skill.badge.copiedHint': '{hint}; prompt copied',
  'worktree.reason.closed': 'The ticket is closed',
  'worktree.reason.blocked': 'Open blockers remain',
  'worktree.reason.blockedCount': '{n} open blockers remain',
  'worktree.reason.localOnly': 'Local tickets have no remote link, so they cannot back a worktree',
  'worktree.action': 'Create worktree',
  'worktree.actionCompact': 'worktree',
  'worktree.busy': 'Creating…',
  'worktree.busyHint': 'Creating a worktree; please wait',
  'worktree.hint': 'Create an Orca worktree for this ticket',
  'worktree.aria': '{action}: {hint}',
  'worktree.notice.created': 'Worktree created; Orca switched to the new workspace.',
  'worktree.notice.existing': 'This ticket already has a worktree; nothing was created.',
  'worktree.branch': 'Branch',
  'worktree.path': 'Path',
  'worktree.reference': 'Ticket',
  'worktree.copyPath': 'Copy path',
  'worktree.copiedPath': 'Path copied',
  'worktree.copyFailed': 'Copy failed; select the path manually.',
  'worktree.openEnvCheck': 'View environment check',
  'copy.copied': 'Prompt copied to the clipboard; paste it into a session.',
  'copy.manualHint': 'The text below is selected; press ⌘C to copy.',
  'copy.manualNotice': '{reason} The text below is selected; press ⌘C to copy.',
  'copy.clipboardUnavailable': 'Copy failed: this environment does not allow writing to the clipboard.',
  'copy.fieldAria': 'Prompt, copy manually',
  'error.gh-missing': 'gh was not found. Install GitHub CLI first (https://cli.github.com).',
  'error.gh-unauthenticated': 'gh is not signed in. Run gh auth login and try again.',
  'error.glab-missing': 'glab was not found. Install GitLab CLI first (https://gitlab.com/gitlab-org/cli).',
  'error.glab-unauthenticated': 'glab is not signed in or its token expired. Run glab auth login and try again.',
  'error.tea-missing': 'tea was not found. Install Gitea CLI first (https://gitea.com/gitea/tea).',
  'error.tea-unauthenticated': 'tea is not signed in to this instance or its token expired. Run tea login add and try again.',
  'error.markdown-read-failed': 'Failed to read tickets under .scratch. Check file read permissions.',
  'error.ticket-not-found': 'This ticket was not found; it may have been deleted.',
  'error.orca-missing': 'Orca command line not found. Confirm the installation or set ORCA_CLI_COMMAND in the environment check.',
  'error.viewEnvCheck': 'View environment check',
  'error.noWorkspaceTickets': 'This session has no workspace folder, so tickets cannot be read.',
  'error.staleData': 'Data may be out of date',
  'error.bridgeUnavailable': 'Orca plugin bridge unavailable',
  'error.badResponse': 'The worker returned a malformed response.',
  'error.requestFailedUnknown': 'Worker request failed: unknown error',
  'error.requestFailed': 'Worker request failed: {message}{suffix}',
  'error.requestCodeSuffix': ' ({code})',
  'workspace.pickerTitle':
    'Could not identify the current workspace; click “Use” to pick a repository folder:',
  'workspace.use': 'Use',
  'workspace.useAria': 'Use {label}',
  'help.back': '← Back',
  'help.title': 'Workflow help',
  'help.intro':
    'Intake only files tickets. Work starts from a ticket and stops between commands, waiting for your next command.',
  'help.tabsAria': 'Scenarios',
  'help.legend.plugin': 'mattwf- plugin commands',
  'help.legend.matt': 'matt skills',
  'help.legend.stop': 'The agent stops and waits for your next command',
  'flow.command.intakeBug.summary': 'Write bug reports as raw tickets',
  'flow.command.intakeFeature.summary': 'Write feature requests as raw tickets',
  'flow.command.triage.summary': 'Classify raw tickets',
  'flow.command.toSpec.summary': 'Write the spec',
  'flow.command.toTickets.summary': 'Split into ready tickets',
  'flow.command.grillWithDocs.summary': 'Interview the requirement',
  'flow.command.wayfinder.summary': 'Draw the decision map',
  'flow.command.diagnosingBugs.summary': 'Diagnose hard bugs',
  'flow.command.implement.summary': 'Implement to spec',
  'flow.command.codeReview.summary': 'Review the change on two axes',
  'flow.command.pr.summary': 'Write the PR body',
  'flow.command.intakeBug.description': 'Write bug reports as raw tickets; intake only.',
  'flow.command.intakeFeature.description': 'Write feature requests as raw tickets; intake only.',
  'flow.skill.intake.bug.intro':
    'You are writing the bug the user reported into this repository’s ticket pool. This step only files the ticket: no classification, no work.',
  'flow.skill.intake.bug.hardInfo': 'symptom, reproduction steps, expected behavior',
  'flow.skill.intake.bug.section1': 'What happened',
  'flow.skill.intake.bug.section2': 'Expected',
  'flow.skill.intake.bug.section3': 'Reproduction steps',
  'flow.skill.intake.bug.section4': 'Additional context',
  'flow.skill.intake.feature.intro':
    'You are writing the feature the user described into this repository’s ticket pool. This step only files the ticket: no interview, no spec.',
  'flow.skill.intake.feature.hardInfo': 'problem, expected outcome',
  'flow.skill.intake.feature.section1': 'Problem',
  'flow.skill.intake.feature.section2': 'Expected outcome',
  'flow.skill.intake.feature.section3': 'Context',
  'intake.bug.slot1': 'Symptom:',
  'intake.bug.slot2': 'Reproduction steps:',
  'intake.bug.slot3': 'Expected behavior:',
  'intake.feature.slot1': 'Feature (one line):',
  'flow.nextStep.triage.when':
    'default; hand the raw ticket to triage, which decides where it goes.',
  'flow.nextStep.toSpec.when':
    'the requirement is already clear in this conversation; turn this ticket into a spec in place, in the same session.',
  'flow.nextStep.toSpec.reminder': 'Adjust labels as needed when converting in place.',
  'flow.nextStep.grillWithDocs.when':
    'the requirement is still vague but fits in one session; clarify it first.',
  'flow.nextStep.wayfinder.when':
    'the work is too big for one session; draw the decision map first.',
  'flow.skill.ticketReference': '<ticket reference>',
  'flow.diagram.intake-triage.title': 'Intake and triage',
  'flow.diagram.intake-triage.summary': 'A raw report becomes a ticket, then triage classifies it.',
  'flow.diagram.feature-chain.title': 'Feature chain',
  'flow.diagram.feature-chain.summary':
    'A feature enters intake, then goes through triage, interview or mapping as needed; then spec, split and implement.',
  'flow.diagram.bug-chain.title': 'Bug chain',
  'flow.diagram.bug-chain.summary':
    'Every bug goes through triage first; hard ones are diagnosed, and a clear root cause goes straight to implementation.',
  'flow.diagram.choose-interview.title': 'Interview or map',
  'flow.diagram.choose-interview.summary':
    'When a requirement needs discussion, choose by whether it fits in one session.',
  'flow.node.defect': 'Bug',
  'flow.node.feature': 'Feature',
  'flow.node.triage': 'Classify',
  'flow.node.feature-chain.intakeFeature': 'One-line feature',
  'flow.node.feature-chain.triage': 'Default',
  'flow.node.feature-chain.toSpec': 'Already clear',
  'flow.node.feature-chain.grillWithDocs': 'Still vague',
  'flow.node.feature-chain.wayfinder': 'Too big for one session',
  'flow.node.feature-chain.toSpecAfter': 'After the detour',
  'flow.node.bug-chain.intakeBug': 'Three-line prompt',
  'flow.node.bug-chain.diagnose': 'Genuinely hard',
  'flow.node.bug-chain.implement': 'Root cause clear',
  'flow.node.bug-chain.implementAfter': 'After diagnosis',
  'flow.node.choose-interview.state': 'Requirement needs discussion',
  'flow.node.choose-interview.grill': 'Fits in one session',
  'flow.node.choose-interview.wayfinder': 'Too big for one session',
  'flow.diagram.after-implement.title': 'After implementation',
  'flow.diagram.after-implement.summary':
    'Review first once implementation is done; write the PR body after the review feedback is fixed, then close the ticket once merged.',
  'flow.node.after-implement.done': 'Implementation done',
  'flow.node.after-implement.codeReview': 'Two-axis review',
  'flow.node.after-implement.reviewed': 'Review feedback fixed',
  'flow.node.after-implement.pr': 'Write the PR body',
  'flow.node.after-implement.merged': 'Merged, ticket closed',
} as const satisfies Messages

/**
 * 全部语言目录。`satisfies Record<Locale, Messages>` 与英文目录自己的
 * `satisfies Messages` 一起保证：两种语言的键集合完全一致。
 */
export const MESSAGES = {
  'zh-CN': ZH_CN,
  en: EN,
} as const satisfies Readonly<Record<Locale, Messages>>

/**
 * 带参数的文案。每条消息的参数名与类型都在这里声明；模板里出现的 `{name}`
 * 由面板的插值函数按这张表填充。没有列在这里的消息不接收参数。
 */
export interface MessageParams {
  'language.effective': { readonly language: string }
  'language.autoEffective': { readonly language: string }
  'tickets.loadedTotal': { readonly loaded: number; readonly total: number }
  'tickets.layout.coverage': { readonly loaded: number; readonly total: number }
  'tickets.childCount': { readonly count: number }
  'tickets.parentOutside': { readonly parent: string }
  'tickets.loadMoreRemaining': { readonly count: number }
  'tickets.people.viewer': { readonly login: string }
  'tickets.people.viewerHint': { readonly login: string }
  'tickets.ageTitle': { readonly created: string; readonly updated: string }
  'tickets.refCopyLabel': { readonly ref: string }
  'tickets.refCopyHint': { readonly url: string }
  'tickets.refCopiedNotice': { readonly ref: string }
  'time.minutesAgo': { readonly n: number }
  'time.hoursAgo': { readonly n: number }
  'time.daysAgo': { readonly n: number }
  'overview.loadedTickets': { readonly loaded: number; readonly total: number }
  'overview.count': { readonly n: number }
  'overview.attentionCount': { readonly n: number }
  'overview.sampleNote': { readonly loaded: number; readonly total: number }
  'overview.pressureCoverage': { readonly loaded: number; readonly total: number }
  'overview.dimensionHint': { readonly basis: string }
  'overview.tierMeterLabel': { readonly name: string; readonly tier: string }
  'overview.unit.layers': { readonly n: number }
  'overview.unit.days': { readonly n: number }
  'pressure.signal.backlog': { readonly n: number }
  'pressure.signal.netFlow': { readonly sign: string; readonly n: number }
  'pressure.signal.blockedRatio': { readonly percent: string }
  'pressure.signal.staleRatio': { readonly percent: string }
  'pressure.signal.stalled': { readonly n: number }
  'attention.stale': { readonly n: number }
  'attention.mostBlocking': { readonly n: number }
  'attention.oldestStalled': { readonly n: number }
  'chart.flowSummary': {
    readonly range: string
    readonly opened: number
    readonly closed: string
  }
  'chart.flowSummaryClosed': { readonly n: number }
  'chart.ageTooltip': { readonly label: string; readonly count: number }
  'chart.segmentSummaryItem': {
    readonly label: string
    readonly count: number
    readonly percent: string
  }
  'chart.segmentTitle': { readonly title: string; readonly summary: string }
  'chart.segmentTooltip': {
    readonly label: string
    readonly count: number
    readonly percent: string
  }
  'env.summary': { readonly passed: number; readonly total: number }
  'env.title.backendWith': { readonly backend: string }
  'env.title.skill': { readonly skill: string }
  'env.blockedBecause': { readonly title: string }
  'env.jumpTo': { readonly title: string }
  'env.capabilities': { readonly present: number; readonly missing: number }
  'env.capability.impact': { readonly impact: string }
  'env.capability.fix': { readonly fix: string }
  'env.cap.skill': { readonly skill: string }
  'env.cap.skill.fix': { readonly skill: string }
  'env.cache.entries': { readonly n: number }
  'env.cache.lastWritten': { readonly time: string }
  'env.cache.cleared': { readonly n: number }
  'env.cache.failed': { readonly detail: string }
  'env.remedy.installCli.named': { readonly cli: string }
  'env.remedy.installCli.link': { readonly cli: string }
  'env.remedy.loginCli.named': { readonly cli: string }
  'env.remedy.installSkill.summary': { readonly skill: string }
  'env.remedy.initWorkspace.summary': { readonly skill: string }
  'env.remedy.initWorkspace.prompt': { readonly title: string; readonly detail: string }
  'env.remedy.placeLocalIssues.prompt': { readonly title: string; readonly detail: string }
  'env.remedy.checkRepositoryAccess.summary': { readonly repository: string }
  'env.remedy.checkLogs.summary': { readonly logs: string }
  'env.remedy.fixBackend.prompt': { readonly title: string; readonly detail: string }
  'env.remedy.retry.summary': { readonly logs: string }
  'env.remedy.copyFailed': { readonly noun: string }
  'env.remedy.install': { readonly skill: string }
  'env.remedy.installFailed': { readonly detail: string }
  'env.remedy.installSummary': { readonly count: number }
  'env.remedy.installSummaryPartial': {
    readonly installed: number
    readonly failed: number
    readonly reason: string
  }
  'detail.openInBrowser': { readonly url: string }
  'detail.createdAt': { readonly time: string }
  'detail.updatedAt': { readonly time: string }
  'detail.commentCount': { readonly n: number }
  'detail.backTo': { readonly ref: string }
  'detail.backToTitle': { readonly ref: string }
  'detail.blockers.openTitle': { readonly ref: string; readonly title: string }
  'detail.blockers.hint': { readonly hint: string; readonly action: string }
  'detail.blockers.toggle': { readonly label: string; readonly hint: string }
  'detail.refreshFailed': { readonly detail: string }
  'detail.copyLinkWithUrl': { readonly url: string }
  'detail.removeLabel': { readonly value: string }
  'detail.removeAssignee': { readonly value: string }
  'detail.unsupported': { readonly backend: string; readonly actions: string }
  'detail.comments': { readonly n: number }
  'detail.commentBy': { readonly author: string }
  'detail.delete.title': { readonly ref: string }
  'detail.delete.body': { readonly title: string; readonly backend: string }
  'detail.combobox.aria': { readonly name: string }
  'detail.combobox.unavailable': { readonly reason: string }
  'detail.combobox.noMatch': { readonly query: string }
  'detail.optionsFailed': { readonly detail: string }
  'avatar.label': { readonly role: string; readonly name: string }
  'author.title': { readonly name: string; readonly login: string }
  'skill.action.blocked': { readonly n: number }
  'skill.badge.aria': { readonly label: string; readonly hint: string }
  'skill.badge.copiedHint': { readonly hint: string }
  'worktree.reason.blockedCount': { readonly n: number }
  'worktree.aria': { readonly action: string; readonly hint: string }
  'copy.manualNotice': { readonly reason: string }
  'error.requestFailed': { readonly message: string; readonly suffix: string }
  'error.requestCodeSuffix': { readonly code: string }
  'workspace.useAria': { readonly label: string }
}

/** 从模板里抽出 `{name}` 占位符名；目录只使用简单占位符。 */
type PlaceholderNames<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never

/** 某条消息在 {@link MessageParams} 里声明的参数名。 */
type ParamKeys<K extends MessageId> = K extends keyof MessageParams
  ? keyof MessageParams[K]
  : never

/** 目录里出现、但参数类型里没有声明的占位符；应当恒为 never。 */
type MissingPlaceholdersIn<Catalog extends { readonly [K in MessageId]: string }> = {
  [K in MessageId]: Exclude<PlaceholderNames<Catalog[K]>, ParamKeys<K>>
}[MessageId]

type MissingPlaceholderParams =
  | MissingPlaceholdersIn<typeof ZH_CN>
  | MissingPlaceholdersIn<typeof EN>

/**
 * 编译期守卫：任何模板里写了 `{name}` 却没用 {@link MessageParams} 声明，
 * 这个常量的类型就会变成 never，赋值 `true` 立刻编译失败。
 */
export const MESSAGE_PARAMS_COMPLETE: MissingPlaceholderParams extends never ? true : never = true
