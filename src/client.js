/**
 * DSH Fleet Cleaner Client Module.
 * Conforms to DSH window.__ModuleLoader__.load({ id, factory }) specification.
 * Integrates cleanly into DSH Right Sidebar Tab without invalid slot registrations.
 * Pure script without raw ESM import/export statements for reliable browser combo loading.
 * UI Version: v0.2.1 (Phase 1 · Anti-Slop & Adaptive Theme Edition)
 */

(function () {
  function ensureStyles() {
    if (typeof document === 'undefined') return;
    const tagId = 'dsh-fleet-cleaner-css';
    if (document.getElementById(tagId)) return;
    const style = document.createElement('style');
    style.id = tagId;
    style.setAttribute('data-plugin', 'dsh-fleet-cleaner');
    style.textContent = `
      .dsh-fc-container {
        padding: 12px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15));
        border-radius: 10px;
        background: var(--dsw-alias-bg-base, #ffffff);
        color: var(--dsw-alias-label-primary, inherit);
        font-family: sans-serif;
        font-size: 12px;
      }
      .dsh-fc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15));
      }
      .dsh-fc-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
        border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.12));
        border-radius: 6px;
        font-size: 12px;
        min-width: 0;
      }
      .dsh-fc-chip-label {
        font-size: 10px;
        color: var(--dsw-alias-label-secondary, #71717a);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsh-fc-chip-val {
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, inherit);
        font-family: monospace;
      }
    `;
    document.head.appendChild(style);
  }

  function createModule(React) {
    ensureStyles();
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useCallback = React.useCallback;

    const I18N = {
      ru: {
        title: 'Монитор флота',
        phaseBadge: 'Phase 1 · Read-Only',
        audit: 'Аудит',
        auditing: 'Аудит...',
        refresh: 'Обновить',
        close: 'Закрыть',
        init: 'Инициализация монитора...',
        chats: 'Чаты (User)',
        active: 'Активные субагенты',
        dormant: 'В архиве',
        unknown: 'Неизвестные',
        browsers: 'Браузеры Neko',
        nodeRss: 'Память Node RSS',
        stale: 'Устарело',
        cached: 'Кэш',
        policy: 'Политика',
        status: 'Статус',
        errUnavailable: 'Монитор флота: Недоступен',
        errUpdate: 'Ошибка обновления',
        tipChats: 'Корневые сессии пользователей (100% иммунитет)',
        tipActive: 'Активные выполняющиеся субагенты',
        tipDormant: 'Завершенные субагенты (кандидаты)',
        tipUnknown: 'Неизвестные сессии без метаданных',
        tipBrowsers: 'Изолированные контейнеры браузера Neko',
        tipRss: 'Потребление памяти процессом (Node.js RSS)',
        verdicts: {
          REJECTED_NON_SUBAGENT: 'ИММУНИТЕТ',
          REJECTED_NON_ONESHOT: 'ЗАЩИЩЕН',
          REJECTED_USER_PROTECTED: 'РУЧНОЙ ИММУНИТЕТ',
          REJECTED_INTERACTION_REQUIRED: 'ОЖИДАЕТ ВВОДА',
          REJECTED_RECENT_START: 'НОВЫЙ ЗАПУСК',
          REJECTED_ACTIVE_HEARTBEAT: 'ВЫПОЛНЯЕТСЯ',
          REJECTED_SESSION_STILL_OPEN: 'СЕССИЯ ОТКРЫТА',
          REJECTED_GRACE_PERIOD_ACTIVE: 'ЛЬГОТНЫЙ ПЕРИОД',
          ACCEPTED_ABORTED_TERMINAL: 'ПРЕРВАН',
          ACCEPTED_EXPIRED_TERMINAL: 'ИСТЕК',
          ACCEPTED_ONESHOT_FINISHED: 'ЗАВЕРШЕН',
        },
        modal: {
          title: 'План удержания и очистки сессий',
          summary: 'Сводка аудита',
          candidates: 'Кандидаты на очистку',
          none: 'Кандидаты отсутствуют. Все текущие субагенты защищены политикой.',
          id: 'Идентификатор',
          verdict: 'Вердикт',
          readOnlyNotice: 'Внимание: В Phase 1 удаление выключено (Read-Only аудит).',
        }
      },
      en: {
        title: 'Fleet Monitor',
        phaseBadge: 'Phase 1 · Read-Only',
        audit: 'Audit',
        auditing: 'Auditing...',
        refresh: 'Refresh',
        close: 'Close',
        init: 'Initializing monitor...',
        chats: 'Chats (User)',
        active: 'Active Subagents',
        dormant: 'Dormant',
        unknown: 'Unknown',
        browsers: 'Neko Browsers',
        nodeRss: 'Node RSS',
        stale: 'Stale',
        cached: 'Cached',
        policy: 'Policy',
        status: 'Status',
        errUnavailable: 'Fleet Monitor: Unavailable',
        errUpdate: 'Update error',
        tipChats: 'User root chat sessions (100% immune from retention)',
        tipActive: 'Active running subagents',
        tipDormant: 'Completed subagents (retention candidates)',
        tipUnknown: 'Unknown session records with missing metadata',
        tipBrowsers: 'Isolated Neko browser instances',
        tipRss: 'Node.js Resident Set Size (RSS)',
        verdicts: {
          REJECTED_NON_SUBAGENT: 'IMMUNE',
          REJECTED_NON_ONESHOT: 'PROTECTED',
          REJECTED_USER_PROTECTED: 'USER_PROTECTED',
          REJECTED_INTERACTION_REQUIRED: 'NEEDS_INPUT',
          REJECTED_RECENT_START: 'RECENT',
          REJECTED_ACTIVE_HEARTBEAT: 'ACTIVE',
          REJECTED_SESSION_STILL_OPEN: 'STILL_OPEN',
          REJECTED_GRACE_PERIOD_ACTIVE: 'GRACE_PERIOD',
          ACCEPTED_ABORTED_TERMINAL: 'ABORTED',
          ACCEPTED_EXPIRED_TERMINAL: 'EXPIRED',
          ACCEPTED_ONESHOT_FINISHED: 'FINISHED',
        },
        modal: {
          title: 'Retention & Quarantine Plan',
          summary: 'Audit Summary',
          candidates: 'Purge Candidates',
          none: 'No purge candidates. All subagents are protected by policy.',
          id: 'Session ID',
          verdict: 'Verdict',
          readOnlyNotice: 'Notice: In Phase 1 mutation is disabled (Read-Only audit).',
        }
      }
    };

    // Compact SVG Icons
    const createSvg = (viewBox, children) => (props) => {
      const size = props.size || 14;
      const color = props.color || 'currentColor';
      return h('svg', {
        width: size,
        height: size,
        viewBox,
        fill: 'none',
        stroke: color,
        strokeWidth: '1.75',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
      }, children);
    };

    const IconFleetCleaner = createSvg('0 0 24 24', [
      h('path', { key: 'p1', d: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' })
    ]);

    const IconChat = createSvg('0 0 24 24', [
      h('path', { key: 'p1', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
    ]);

    const IconSubagent = createSvg('0 0 24 24', [
      h('rect', { key: 'r1', x: '3', y: '11', width: '18', height: '10', rx: '2' }),
      h('circle', { key: 'c1', cx: '12', cy: '5', r: '2' }),
      h('path', { key: 'p1', d: 'M12 7v4M8 16h.01M16 16h.01' })
    ]);

    const IconArchive = createSvg('0 0 24 24', [
      h('polyline', { key: 'pl1', points: '21 8 21 21 3 21 3 8' }),
      h('rect', { key: 'r1', x: '1', y: '3', width: '22', height: '5' }),
      h('line', { key: 'l1', x1: '10', y1: '12', x2: '14', y2: '12' })
    ]);

    const IconBrowser = createSvg('0 0 24 24', [
      h('circle', { key: 'c1', cx: '12', cy: '12', r: '10' }),
      h('line', { key: 'l1', x1: '2', y1: '12', x2: '22', y2: '12' }),
      h('path', { key: 'p1', d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' })
    ]);

    const IconRam = createSvg('0 0 24 24', [
      h('rect', { key: 'r1', x: '2', y: '6', width: '20', height: '12', rx: '2' }),
      h('path', { key: 'p1', d: 'M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 2v4M10 2v4M14 2v4M18 2v4M6 18v4M10 18v4M14 18v4M18 18v4' })
    ]);

    const IconTelemetryGauge = createSvg('0 0 24 24', [
      h('path', { key: 'p1', d: 'M12 14v-4M3.34 19a10 10 0 1 1 17.32 0' })
    ]);

    const IconRefresh = createSvg('0 0 24 24', [
      h('path', { key: 'p1', d: 'M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19' })
    ]);

    const IconAudit = createSvg('0 0 24 24', [
      h('path', { key: 'p1', d: 'M9 11l3 3L22 4' }),
      h('path', { key: 'p2', d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' })
    ]);

    const IconClose = createSvg('0 0 24 24', [
      h('line', { key: 'l1', x1: '18', y1: '6', x2: '6', y2: '18' }),
      h('line', { key: 'l2', x1: '6', y1: '6', x2: '18', y2: '18' })
    ]);

    // Error boundary component
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('FleetCleaner ErrorBoundary caught:', error, errorInfo);
        }
      }
      render() {
        if (this.state.hasError) {
          return h('div', {
            style: {
              padding: '12px',
              margin: '8px 0',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontSize: '11px',
            }
          }, [
            h('strong', { key: 'hdr', style: { display: 'block', marginBottom: '4px' } }, 'Fleet Cleaner Render Error'),
            h('div', { key: 'msg' }, String(this.state.error?.message || this.state.error || 'Unknown error'))
          ]);
        }
        return this.props.children;
      }
    }

    function FleetCleanerHud({ isVisible = true, initialSnapshot = null }) {
      const [lang, setLang] = useState(() => {
        try {
          return localStorage.getItem('dsh-fleet-cleaner-lang') || 'ru';
        } catch {
          return 'ru';
        }
      });

      const handleLangChange = (nextLang) => {
        setLang(nextLang);
        try {
          localStorage.setItem('dsh-fleet-cleaner-lang', nextLang);
        } catch {}
      };

      const t = I18N[lang] || I18N.en;

      const [snapshot, setSnapshot] = useState(initialSnapshot);
      const [statsError, setStatsError] = useState(null);
      const [plan, setPlan] = useState(null);
      const [planError, setPlanError] = useState(null);
      const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
      const [isLoadingPlan, setIsLoadingPlan] = useState(false);
      const [isRefreshing, setIsRefreshing] = useState(false);

      const loadStats = useCallback(async (force = false) => {
        try {
          const res = await fetch(`/fleet-cleaner/api/stats${force ? '?force=true' : ''}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setSnapshot(data);
          setStatsError(null);
        } catch (err) {
          setStatsError(err.message || String(err));
        } finally {
          setIsRefreshing(false);
        }
      }, []);

      const runAudit = async () => {
        setIsLoadingPlan(true);
        setPlanError(null);
        try {
          const res = await fetch('/fleet-cleaner/api/plan');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setPlan(data);
          setIsPlanModalOpen(true);
        } catch (err) {
          setPlanError(err.message || 'Audit failed');
          setIsPlanModalOpen(true);
        } finally {
          setIsLoadingPlan(false);
        }
      };

      // Visibility-aware polling
      useEffect(() => {
        if (!isVisible) return;
        const onVisibilityChange = () => {
          if (!document.hidden) loadStats();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        loadStats();
        const interval = setInterval(() => {
          if (!document.hidden) loadStats();
        }, 15000);
        return () => {
          document.removeEventListener('visibilitychange', onVisibilityChange);
          clearInterval(interval);
        };
      }, [isVisible, loadStats]);

      if (statsError && !snapshot) {
        return h('div', {
          key: 'hud-error',
          style: {
            padding: '10px',
            margin: '6px 0',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            fontSize: '11px',
            color: '#ef4444'
          }
        }, [
          h('div', { key: 'err-title', style: { fontWeight: 'bold', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
            h(IconTelemetryGauge, { key: 'err-ico', size: 14, color: '#ef4444' }),
            t.errUnavailable
          ]),
          h('div', { key: 'err-msg', style: { fontSize: '10px' } }, statsError),
        ]);
      }

      if (!snapshot) {
        return h('div', {
          style: {
            padding: '12px',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #71717a)'
          }
        }, t.init);
      }

      const { memory, sessions, browsers, fromCache, stale } = snapshot;

      const renderStatChip = (key, iconComponent, iconColor, iconBg, label, value, tooltip) => {
        const displayValue = (value !== null && value !== undefined) ? value : 'N/A';
        return h('div', {
          key,
          title: tooltip,
          className: 'dsh-fc-chip'
        }, [
          h('div', {
            key: 'icon-wrap',
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '5px',
              background: iconBg,
              flexShrink: 0
            }
          }, [h(iconComponent, { key: 'ico', size: 13, color: iconColor })]),
          h('div', { key: 'content-wrap', style: { display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' } }, [
            h('span', { key: 'lbl', className: 'dsh-fc-chip-label' }, `${label}: `),
            h('span', { key: 'val', className: 'dsh-fc-chip-val' }, String(displayValue))
          ])
        ]);
      };

      return h('div', {
        key: 'hud-root',
        className: 'dsh-fc-container'
      }, [
        h('div', {
          key: 'header',
          className: 'dsh-fc-header'
        }, [
          h('div', { key: 'title-box', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
            h('div', {
              key: 'title-ico-wrap',
              style: {
                width: '22px',
                height: '22px',
                borderRadius: '5px',
                background: 'rgba(16, 185, 129, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            }, [h(IconFleetCleaner, { key: 'brand-ico', size: 14, color: '#10b981' })]),
            h('span', {
              key: 'title',
              style: { fontWeight: '600', fontSize: '12px', color: 'var(--dsw-alias-label-primary, inherit)' }
            }, t.title),
            h('span', {
              key: 'phase-badge',
              style: {
                fontSize: '9px',
                fontWeight: '600',
                padding: '2px 5px',
                borderRadius: '4px',
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#3b82f6',
                letterSpacing: '0.3px',
                textTransform: 'uppercase'
              }
            }, t.phaseBadge)
          ]),
          h('div', { key: 'hdr-right', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            stale ? h('span', {
              key: 'stale',
              style: { color: '#f59e0b', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(245, 158, 11, 0.1)' }
            }, `[${t.stale}]`) :
            fromCache ? h('span', {
              key: 'cached',
              style: { color: 'var(--dsw-alias-label-secondary, #71717a)', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))' }
            }, `[${t.cached}]`) : null,
            h('div', {
              key: 'lang-toggle',
              style: {
                display: 'inline-flex',
                background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))',
                borderRadius: '4px',
                padding: '2px',
                border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15))'
              }
            }, [
              h('button', {
                key: 'ru',
                onClick: () => handleLangChange('ru'),
                style: {
                  background: lang === 'ru' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                  color: lang === 'ru' ? '#10b981' : 'var(--dsw-alias-label-secondary, #71717a)',
                  border: 'none',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  padding: '2px 5px',
                  cursor: 'pointer'
                }
              }, 'RU'),
              h('button', {
                key: 'en',
                onClick: () => handleLangChange('en'),
                style: {
                  background: lang === 'en' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                  color: lang === 'en' ? '#10b981' : 'var(--dsw-alias-label-secondary, #71717a)',
                  border: 'none',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  padding: '2px 5px',
                  cursor: 'pointer'
                }
              }, 'EN')
            ])
          ])
        ]),

        // Stat Grid
        h('div', {
          key: 'metrics-grid',
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '6px', marginBottom: '10px' }
        }, [
          renderStatChip('c-chat', IconChat, '#38bdf8', 'rgba(56, 189, 248, 0.12)', t.chats, sessions?.chats, t.tipChats),
          renderStatChip('c-active', IconSubagent, '#34d399', 'rgba(52, 211, 153, 0.12)', t.active, sessions?.subagentsActive, t.tipActive),
          renderStatChip('c-dormant', IconArchive, '#fbbf24', 'rgba(251, 191, 36, 0.12)', t.dormant, sessions?.subagentsDormant, t.tipDormant),
          renderStatChip('c-browser', IconBrowser, '#a78bfa', 'rgba(167, 139, 250, 0.12)', t.browsers, browsers?.total, t.tipBrowsers),
          renderStatChip('c-rss', IconRam, '#f472b6', 'rgba(244, 114, 182, 0.12)', t.nodeRss, memory?.nodeRssMb ? `${memory.nodeRssMb} MB` : 'N/A', t.tipRss),
        ]),

        // Footer Actions
        h('div', {
          key: 'footer-actions',
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            paddingTop: '8px',
            borderTop: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15))'
          }
        }, [
          h('button', {
            key: 'btn-refresh',
            onClick: () => { setIsRefreshing(true); loadStats(true); },
            disabled: isRefreshing,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '5px',
              border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
              background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: '11px',
              cursor: isRefreshing ? 'default' : 'pointer'
            }
          }, [h(IconRefresh, { key: 'r-ico', size: 12 }), t.refresh]),
          h('button', {
            key: 'btn-audit',
            onClick: runAudit,
            disabled: isLoadingPlan,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 12px',
              borderRadius: '5px',
              border: 'none',
              background: '#10b981',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: '600',
              cursor: isLoadingPlan ? 'default' : 'pointer'
            }
          }, [h(IconAudit, { key: 'a-ico', size: 12 }), isLoadingPlan ? t.auditing : t.audit])
        ]),

        // Audit Plan Modal
        isPlanModalOpen ? h('div', {
          key: 'plan-modal-overlay',
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '16px'
          }
        }, [
          h('div', {
            key: 'plan-modal-box',
            style: {
              background: 'var(--dsw-alias-bg-base, #ffffff)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
              borderRadius: '10px',
              width: '100%',
              maxWidth: '560px',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }
          }, [
            h('div', {
              key: 'modal-hdr',
              style: {
                padding: '12px 16px',
                borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15))',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.04))'
              }
            }, [
              h('span', { key: 'm-title', style: { fontWeight: '600', fontSize: '13px' } }, t.modal.title),
              h('button', {
                key: 'm-close',
                onClick: () => setIsPlanModalOpen(false),
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--dsw-alias-label-secondary, #71717a)',
                  cursor: 'pointer',
                  padding: '2px'
                }
              }, [h(IconClose, { key: 'm-close-ico', size: 14 })])
            ]),
            h('div', {
              key: 'modal-body',
              style: { padding: '16px', overflowY: 'auto', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '12px' }
            }, [
              h('div', {
                key: 'ro-notice',
                style: {
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  color: '#3b82f6',
                  fontSize: '11px',
                  lineHeight: '1.4'
                }
              }, t.modal.readOnlyNotice),
              planError ? h('div', { key: 'm-err', style: { color: '#ef4444' } }, planError) :
              plan ? [
                h('div', {
                  key: 'm-summary',
                  style: {
                    padding: '10px',
                    borderRadius: '6px',
                    background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))',
                    border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.12))'
                  }
                }, [
                  h('div', { key: 'sum-hdr', style: { fontWeight: '600', marginBottom: '6px' } }, t.modal.summary),
                  h('div', { key: 'sum-content', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', color: 'var(--dsw-alias-label-secondary, #71717a)' } }, [
                    h('div', { key: 'sc-1' }, `Evaluated: ${plan.summary?.evaluatedCount ?? 0}`),
                    h('div', { key: 'sc-2' }, `Purge Candidates: ${plan.summary?.candidateCount ?? 0}`),
                    h('div', { key: 'sc-3' }, `Protected: ${plan.summary?.retainedCount ?? 0}`),
                    h('div', { key: 'sc-4' }, `Mode: ${plan.readOnly ? 'Read-Only (Phase 1)' : 'Live'}`),
                  ])
                ]),
                h('div', { key: 'cand-sec' }, [
                  h('div', { key: 'c-hdr', style: { fontWeight: '600', marginBottom: '6px' } }, t.modal.candidates),
                  (!plan.candidates || plan.candidates.length === 0) ?
                    h('div', { key: 'no-cand', style: { color: 'var(--dsw-alias-label-secondary, #71717a)', fontStyle: 'italic', padding: '6px 0' } }, t.modal.none) :
                    h('div', { key: 'cand-list', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                      plan.candidates.map((c, i) => h('div', {
                        key: `c-${i}`,
                        style: {
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06))',
                          fontFamily: 'monospace'
                        }
                      }, [
                        h('span', { key: 'cid' }, c.sessionId?.slice(0, 16) || 'Unknown'),
                        h('span', { key: 'cver', style: { color: '#10b981' } }, t.verdicts[c.verdict] || c.verdict)
                      ]))
                    )
                ])
              ] : null
            ]),
            h('div', {
              key: 'modal-ftr',
              style: {
                padding: '10px 16px',
                borderTop: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.15))',
                display: 'flex',
                justifyContent: 'flex-end',
                background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.04))'
              }
            }, [
              h('button', {
                key: 'm-btn-close',
                onClick: () => setIsPlanModalOpen(false),
                style: {
                  padding: '5px 14px',
                  borderRadius: '5px',
                  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2))',
                  background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08))',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }
              }, t.close)
            ])
          ])
        ]) : null
      ]);
    }

    function FleetCleanerTab(props) {
      return h(ErrorBoundary, null, h(FleetCleanerHud, props));
    }

    return {
      FleetCleanerTab,
      FleetCleanerHud,
      IconFleetCleaner,
    };
  }

  function apply(ctx, { React }) {
    const { FleetCleanerTab, IconFleetCleaner } = createModule(React);

    const register = () => {
      if (typeof ctx?.inject !== 'function') return () => {};
      ctx.inject(['slots', 'sidebarRightTabs'], (sidebarCtx) => {
        const id = 'dsh-fleet-cleaner/fleet-cleaner';
        const title = () => 'Fleet Monitor';

        sidebarCtx.effect(() => sidebarCtx.sidebarRightTabs.register({
          id,
          kind: 'fleet-cleaner',
          title,
          guide: [{ order: 40, title, icon: IconFleetCleaner, description: () => 'Open Fleet Monitor' }],
        }));

        const Body = ({ useTabInfo }) => {
          const { tab } = useTabInfo();
          return React.createElement(FleetCleanerTab, { isVisible: tab?.visible !== false });
        };

        const Title = () => {
          return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, [
            React.createElement(IconFleetCleaner, { key: 'ico', size: 14 }),
            title()
          ]);
        };

        sidebarCtx.effect(() => sidebarCtx.slots.inject('sidebar.right.pane.tab', () =>
          sidebarCtx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)));

        sidebarCtx.effect(() => sidebarCtx.slots.inject('sidebar.right.pane.tab.title', () =>
          sidebarCtx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, Title)));
      });
      return () => {};
    };

    if (typeof ctx?.effect === 'function') {
      return ctx.effect(register);
    }
    return register();
  }

  function createClientFactory() {
    return (require) => {
      const React = require('react');
      if (!React || typeof React.createElement !== 'function') {
        throw new TypeError('dsh-fleet-cleaner [client]: React with createElement is required by ModuleLoader factory.');
      }

      const { FleetCleanerTab, FleetCleanerHud, IconFleetCleaner } = createModule(React);

      function applyClient(ctx) {
        return apply(ctx, { React });
      }

      return {
        apply: applyClient,
        inject: ['sidebarRightTabs'],
        FleetCleanerHud,
        FleetCleanerTab,
        IconFleetCleaner,
      };
    };
  }

  // Browser auto-registration into DSH ModuleLoader
  if (typeof window !== 'undefined' && window.__ModuleLoader__) {
    window.__ModuleLoader__.load({
      id: 'dsh-fleet-cleaner',
      factory: createClientFactory(),
    });
  }
})();
