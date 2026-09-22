/**
 * BetterSidebar HUD Component for dsh-fleet-cleaner.
 *
 * Implements:
 * 1. Clean Anti-Slop Visual Hierarchy: icons strictly on the left of labels in semantic badges.
 * 2. Bilingual Support (RU / EN) with dynamic header toggle [ RU | EN ] and localStorage persistence.
 * 3. Descriptive tooltips on all metric chips explaining purpose and safety invariants.
 * 4. Error Boundary & Visibility-aware polling: pauses intervals when tab is hidden.
 * 5. Interactive Modal audit plan with localized verdicts and summary counts.
 */

export function createFleetCleanerHudView(React) {
  if (!React || typeof React.createElement !== 'function') {
    throw new TypeError('dsh-fleet-cleaner [FleetCleanerHud]: React with createElement is required.');
  }

  const h = React.createElement;
  const useState = React.useState;
  const useEffect = React.useEffect;
  const useCallback = (React && typeof React.useCallback === 'function') ? React.useCallback : (fn) => fn;

  const I18N = {
    ru: {
      title: 'Флот и очистка сессий',
      chats: 'Чаты',
      activeSub: 'Активные субагенты',
      dormant: 'В архиве',
      unknown: 'Неизвестные',
      browsers: 'Браузеры Neko',
      nodeRss: 'Память Node RSS',
      stale: 'Устарело',
      cached: 'Кэш',
      btnAudit: 'Аудит кандидатов (dryRun: true)',
      modalTitle: 'План аудита кандидатов (только чтение)',
      totalScanned: 'Всего проверено',
      eligible: 'Кандидаты: 0',
      rejected: 'Защищено фильтрами',
      auditedList: 'Проверенные кандидаты',
      noCandidates: 'Нет кандидатов для отображения.',
      policy: 'Политика',
      status: 'Статус',
      errUnavailable: 'Монитор флота: Недоступен',
      errUpdate: 'Ошибка обновления',
      init: 'Монитор флота: Инициализация...',
      generating: 'Формирование плана аудита...',
      tipChats: 'Пользовательские корневые чаты (100% иммунитет от очистки)',
      tipActive: 'Активные субагенты в процессе выполнения',
      tipDormant: 'Завершённые субагенты (кандидаты на аудит)',
      tipUnknown: 'Нераспознанные сессии с ошибками метаданных',
      tipBrowsers: 'Изолированные браузерные контейнеры Neko',
      tipRss: 'Потребление оперативной памяти Node.js (V8 RSS)',
      verdicts: {
        REJECTED_NON_SUBAGENT: 'ИММУНИТЕТ',
        REJECTED_NON_ONESHOT: 'ЗАЩИЩЕНО',
        REJECTED_TTL_NOT_EXPIRED: 'ЗАЩИЩЕНО',
        REJECTED_NOT_TERMINAL: 'АКТИВЕН',
        ELIGIBLE: 'КАНДИДАТ',
      },
      reasons: {
        REJECTED_NON_SUBAGENT: 'Пользовательский чат (100% иммунитет от очистки)',
        REJECTED_NON_ONESHOT: 'Режим субагента не подтверждён как одноразовый',
        REJECTED_TTL_NOT_EXPIRED: 'Срок удержания (TTL) ещё не истёк',
        REJECTED_NOT_TERMINAL: 'Сессия ещё выполняется или не завершена',
        ELIGIBLE: 'Все критерии подтверждены: готов к перемещению в карантин',
      }
    },
    en: {
      title: 'Fleet & Retention HUD',
      chats: 'Chats',
      activeSub: 'Active Sub',
      dormant: 'Dormant',
      unknown: 'Unknown/Legacy',
      browsers: 'Browsers',
      nodeRss: 'Node RSS',
      stale: 'Stale',
      cached: 'Cached',
      btnAudit: 'View Retention Plan (dryRun: true)',
      modalTitle: 'Retention Candidate Audit Plan (Read-Only)',
      totalScanned: 'Total Scanned',
      eligible: 'Eligible: 0',
      rejected: 'Protected',
      auditedList: 'Audited Candidates',
      noCandidates: 'No candidate items.',
      policy: 'Policy',
      status: 'Status',
      errUnavailable: 'Fleet Monitor: Unavailable',
      errUpdate: 'Update Error',
      init: 'Fleet Monitor: Initializing...',
      generating: 'Generating observational plan...',
      tipChats: 'User root chat sessions (100% immune from retention)',
      tipActive: 'Active running subagents',
      tipDormant: 'Completed subagents (retention candidates)',
      tipUnknown: 'Unknown session records with missing metadata',
      tipBrowsers: 'Isolated Neko browser instances',
      tipRss: 'Node.js Resident Set Size (RSS)',
      verdicts: {
        REJECTED_NON_SUBAGENT: 'IMMUNE',
        REJECTED_NON_ONESHOT: 'PROTECTED',
        REJECTED_TTL_NOT_EXPIRED: 'PROTECTED',
        REJECTED_NOT_TERMINAL: 'RUNNING',
        ELIGIBLE: 'ELIGIBLE',
      },
      reasons: {
        REJECTED_NON_SUBAGENT: 'Session origin is "unknown", non-subagents are strictly protected.',
        REJECTED_NON_ONESHOT: 'Subagent mode is "unproven", only confirmed one-shot runs are eligible.',
        REJECTED_TTL_NOT_EXPIRED: 'Retention TTL has not expired yet.',
        REJECTED_NOT_TERMINAL: 'Session is still running or not terminal.',
        ELIGIBLE: 'All criteria confirmed: Eligible for quarantine.',
      }
    }
  };

  // --- Astra Anti-Slop Vector SVG Icons ---
  function IconFleetCleaner(props) {
    const size = props.size || 15;
    const color = props.color || 'currentColor';
    return h('svg', {
      
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('path', { key: 'p1', d: 'M5 3h14l2 2v14l-2 2H5l-2-2V5Z' }),
      h('path', { key: 'p2', d: 'm7 17 10-10m-5 0h5v5M7 11l3-3m3 9 3-3' })
    ]);
  }

  function IconSubagent(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('rect', { key: 'r1', x: '3', y: '3', width: '7', height: '7', rx: '1' }),
      h('rect', { key: 'r2', x: '14', y: '14', width: '7', height: '7', rx: '1' }),
      h('path', { key: 'p1', d: 'M6.5 10v7.5H14m-3-3 3 3-3 3' })
    ]);
  }

  function IconQuarantineVault(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('path', { key: 'p1', d: 'M5 4h14l2 2v14H3V6Z' }),
      h('path', { key: 'p2', d: 'M3 9h18M9 13v3m6-3v3' })
    ]);
  }

  function IconTelemetryGauge(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('path', { key: 'p1', d: 'M3 19V5h18v14ZM7 5v3m5-3v2m5-2v3M6 15h3l2-4 3 6 2-3h2' })
    ]);
  }

  function IconRootImmune(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('path', { key: 'p1', d: 'm12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6Z' }),
      h('rect', { key: 'r1', x: '9', y: '11', width: '6', height: '6', rx: '1' }),
      h('path', { key: 'p2', d: 'M10 11V9a2 2 0 0 1 4 0v2' })
    ]);
  }

  function IconBrowsers(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('rect', { key: 'r1', x: '3', y: '4', width: '18', height: '14', rx: '2' }),
      h('path', { key: 'p1', d: 'M7 8h.01M10 8h.01M13 8h.01M7 12h10' })
    ]);
  }

  function IconUnknown(props) {
    const size = props.size || 14;
    const color = props.color || 'currentColor';
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: color, strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }
    }, [
      h('circle', { key: 'c1', cx: '12', cy: '12', r: '9' }),
      h('path', { key: 'p1', d: 'M12 8v4m0 4h.01' })
    ]);
  }

  // --- Main HUD Component ---
  function FleetCleanerHud(props) {
    const statsSource = props.statsSource;
    const planSource = props.planSource;
    const initialSnapshot = props.initialSnapshot || null;
    const isVisible = props.visible !== false;

    // Detect stored, prop, or browser locale (defaults to ru if browser is Russian, else en)
    const [lang, setLang] = useState(() => {
      if (props.lang === 'ru' || props.lang === 'en') return props.lang;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const stored = window.localStorage.getItem('dsh_fleet_cleaner_locale');
          if (stored === 'ru' || stored === 'en') return stored;
        }
        if (typeof navigator !== 'undefined' && navigator.language?.startsWith('ru')) return 'ru';
      } catch {}
      return 'en';
    });

    const handleSwitchLang = (newLang) => {
      setLang(newLang);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('dsh_fleet_cleaner_locale', newLang);
        }
      } catch {}
    };

    const t = I18N[lang] || I18N.en;

    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [statsError, setStatsError] = useState(null);
    const [plan, setPlan] = useState(null);
    const [planError, setPlanError] = useState(null);
    const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
    const [isLoadingPlan, setIsLoadingPlan] = useState(false);

    const loadStats = useCallback(async () => {
      try {
        let data;
        if (typeof statsSource?.getSnapshot === 'function') {
          data = await statsSource.getSnapshot();
        } else if (typeof statsSource === 'function') {
          data = await statsSource();
        } else {
          const res = await fetch('/fleet-cleaner/api/stats', { credentials: 'same-origin' });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
          }
          const json = await res.json();
          if (!json?.ok) throw new Error(json?.error || 'Failed to load stats');
          data = json.value;
        }
        setSnapshot(data);
        setStatsError(null);
      } catch (err) {
        setStatsError(err.message || 'Error loading fleet stats');
      }
    }, [statsSource]);

    useEffect(() => {
      if (!isVisible) return;
      loadStats();
      const interval = setInterval(loadStats, 15000);
      return () => clearInterval(interval);
    }, [isVisible, loadStats]);

    const handleOpenPlan = async () => {
      setIsPlanModalOpen(true);
      setIsLoadingPlan(true);
      setPlanError(null);

      try {
        let generatedPlan;
        if (typeof planSource?.generatePlan === 'function') {
          generatedPlan = await planSource.generatePlan();
        } else if (typeof planSource === 'function') {
          generatedPlan = await planSource();
        } else {
          const res = await fetch('/fleet-cleaner/api/plan', { credentials: 'same-origin' });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
          }
          const json = await res.json();
          if (!json?.ok) throw new Error(json?.error || 'Failed to generate plan');
          generatedPlan = json.value;
        }
        setPlan(generatedPlan);
      } catch (err) {
        setPlanError(err.message || 'Failed to generate plan');
      } finally {
        setIsLoadingPlan(false);
      }
    };

    if (statsError && !snapshot) {
      return h('div', {
        key: 'hud-error',
        style: { padding: '10px', margin: '6px 0', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.25)', fontSize: '11px', color: '#fb7185' }
      }, [
        h('div', { key: 'err-title', style: { fontWeight: 'bold', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
          h(IconTelemetryGauge, { key: 'err-ico', size: 14, color: '#f43f5e' }),
          t.errUnavailable
        ]),
        h('div', { key: 'err-msg', style: { fontSize: '10px' } }, statsError),
      ]);
    }

    if (!snapshot) {
      return h('div', { style: { padding: '12px', fontSize: '11px', color: '#888' } }, t.init);
    }

    const { memory, sessions, browsers, fromCache, stale } = snapshot;

    // Helper for structured chip with icon on the LEFT
    const renderStatChip = (key, iconComponent, iconColor, iconBg, label, value, tooltip) => {
      const displayValue = (value !== null && value !== undefined) ? value : 'N/A';
      return h('div', {
        key: key,
        title: tooltip,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 8px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: '6px',
          fontSize: '12px',
          minWidth: 0,
        }
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
          h('span', { key: 'lbl', style: { fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `${label}: `),
          h('span', { key: 'val', style: { fontSize: '13px', fontWeight: '600', color: '#eee', fontFamily: 'monospace' } }, String(displayValue))
        ])
      ]);
    };

    return h('div', {
      key: 'hud-root',
      style: { padding: '12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', background: '#18181b', fontSize: '12px', color: '#ccc', fontFamily: 'sans-serif' }
    }, [
      // Header: Brand + Title on Left, Lang switcher + Cache tag on Right
      h('div', {
        key: 'header',
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }
      }, [
        h('div', { key: 'title-box', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          h('div', {
            key: 'title-ico-wrap',
            style: { width: '22px', height: '22px', borderRadius: '5px', background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
          }, [h(IconFleetCleaner, { key: 'brand-ico', size: 14, color: '#10b981' })]),
          h('span', { key: 'title', style: { fontWeight: '600', fontSize: '12px', color: '#fff' } }, t.title)
        ]),
        h('div', { key: 'hdr-right', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
          stale ? h('span', { key: 'stale', style: { color: '#f59e0b', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(245, 158, 11, 0.1)' } }, `[${t.stale}]`) :
          fromCache ? h('span', { key: 'cached', style: { color: '#888', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.05)' } }, `[${t.cached}]`) : null,
          h('div', {
            key: 'lang-toggle',
            style: { display: 'inline-flex', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '2px', border: '1px solid rgba(255,255,255,0.1)' }
          }, [
            h('button', {
              key: 'btn-ru',
              onClick: () => handleSwitchLang('ru'),
              style: {
                background: lang === 'ru' ? 'rgba(255,255,255,0.15)' : 'transparent',
                border: 'none', color: lang === 'ru' ? '#fff' : '#888', fontSize: '10px', fontWeight: 'bold',
                padding: '2px 5px', borderRadius: '3px', cursor: 'pointer'
              }
            }, 'RU'),
            h('button', {
              key: 'btn-en',
              onClick: () => handleSwitchLang('en'),
              style: {
                background: lang === 'en' ? 'rgba(255,255,255,0.15)' : 'transparent',
                border: 'none', color: lang === 'en' ? '#fff' : '#888', fontSize: '10px', fontWeight: 'bold',
                padding: '2px 5px', borderRadius: '3px', cursor: 'pointer'
              }
            }, 'EN'),
          ])
        ])
      ]),

      statsError ? h('div', {
        key: 'update-error-banner',
        style: { padding: '4px 8px', marginBottom: '8px', borderRadius: '4px', background: 'rgba(244, 63, 94, 0.12)', color: '#fb7185', fontSize: '10px' }
      }, `${t.errUpdate}: ${statsError}`) : null,

      // Structured grid: 6 chips with icons aligned on the left
      h('div', { key: 'grid', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' } }, [
        renderStatChip('sessions', IconRootImmune, '#10b981', 'rgba(16, 185, 129, 0.12)', t.chats, sessions?.userChatSessions, t.tipChats),
        renderStatChip('running', IconSubagent, '#f59e0b', 'rgba(245, 158, 11, 0.12)', t.activeSub, sessions?.runningSubagents, t.tipActive),
        renderStatChip('dormant', IconQuarantineVault, '#a855f7', 'rgba(168, 85, 247, 0.12)', t.dormant, sessions?.dormantSubagents, t.tipDormant),
        renderStatChip('unknown', IconUnknown, '#f43f5e', 'rgba(244, 63, 94, 0.12)', t.unknown, sessions?.unknownRecords, t.tipUnknown),
        renderStatChip('browsers', IconBrowsers, '#14b8a6', 'rgba(20, 184, 166, 0.12)', t.browsers,
          browsers?.summary || (browsers?.nekoProcesses !== undefined ? `${browsers.nekoProcesses} Neko` : '0'),
          (browsers?.rawProcesses && Object.keys(browsers.rawProcesses).length > 0)
            ? `${t.tipBrowsers} (${browsers.summary || '0'}). ${lang === 'ru' ? 'Процессов ОС' : 'OS processes'}: ${Object.values(browsers.rawProcesses).reduce((a, b) => a + b, 0)}`
            : t.tipBrowsers
        ),
        renderStatChip('rss', IconTelemetryGauge, '#38bdf8', 'rgba(56, 189, 248, 0.12)', t.nodeRss, `${memory?.rssBytes ? Math.round(memory.rssBytes / 1024 / 1024) : 'N/A'} MB`, t.tipRss),
      ]),

      // Action button
      h('button', {
        key: 'plan-btn',
        onClick: handleOpenPlan,
        style: {
          width: '100%', padding: '7px 12px', background: '#27272a', color: '#fff',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
          fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
        }
      }, [
        h(IconFleetCleaner, { key: 'btn-ico', size: 13, color: '#10b981' }),
        t.btnAudit
      ]),

      // Modal Dialog
      isPlanModalOpen ? h('div', {
        key: 'modal-overlay',
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, backdropFilter: 'blur(2px)'
        }
      }, [
        h('div', {
          key: 'modal-content',
          style: { background: '#1c1c1f', padding: '16px', borderRadius: '10px', width: '640px', maxWidth: '92vw', maxHeight: '82vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.14)' }
        }, [
          h('div', { key: 'modal-head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } }, [
            h('h3', { key: 'modal-title', style: { margin: 0, fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' } }, [
              h(IconQuarantineVault, { key: 'm-ico', size: 15, color: '#10b981' }),
              t.modalTitle
            ]),
            h('button', {
              key: 'close-btn',
              onClick: () => setIsPlanModalOpen(false),
              style: { cursor: 'pointer', background: 'transparent', border: 'none', color: '#888', fontSize: '15px' }
            }, '✕'),
          ]),

          isLoadingPlan ? h('div', { key: 'loading', style: { padding: '16px 0', textAlign: 'center', color: '#888', fontSize: '12px' } }, t.generating) :
          planError ? h('div', {
            key: 'err-box',
            style: { padding: '10px', borderRadius: '6px', background: 'rgba(244, 63, 94, 0.12)', color: '#fb7185', fontSize: '11px' }
          }, `${t.errUnavailable}: ${planError}`) :
          plan?.error ? h('div', { key: 'err', style: { color: '#fb7185' } }, `Error: ${plan.error}`) :
          (!plan ? h('div', { key: 'empty-plan', style: { color: '#888' } }, t.noCandidates) :
          h('div', { key: 'plan-details' }, [
            h('p', { key: 'meta', style: { fontSize: '10px', color: '#888', marginBottom: '10px' } },
              `${t.policy}: v${plan.policyVersion || 'N/A'} | ${t.status}: ${plan.status || 'N/A'}`
            ),
            h('div', { key: 'summary-counts', style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } }, [
              h('span', { key: 'c1', style: { padding: '3px 8px', borderRadius: '5px', background: 'rgba(255,255,255,0.05)', fontSize: '11px', color: '#ddd' } }, `${t.totalScanned}: ${plan.totalScanned ?? 0}`),
              h('span', { key: 'c2', style: { padding: '3px 8px', borderRadius: '5px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', fontSize: '11px' } }, `${t.eligible}: ${plan.eligibleCount ?? 0}`),
              h('span', { key: 'c3', style: { padding: '3px 8px', borderRadius: '5px', background: 'rgba(244, 63, 94, 0.12)', color: '#fb7185', fontSize: '11px' } }, `${t.rejected}: ${plan.rejectedCount ?? 0}`),
            ]),
            h('div', {
              key: 'candidate-list',
              style: { maxHeight: '240px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '6px', background: '#121214', fontSize: '11px' }
            }, [
              h('div', { key: 'cand-hdr', style: { fontWeight: '600', marginBottom: '6px', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa', fontSize: '10px', textTransform: 'uppercase' } }, [
                h(IconSubagent, { key: 'hdr-ico', size: 12, color: '#10b981' }),
                `${t.auditedList} (${plan.candidates?.length ?? 0}):`
              ]),
              ...(plan.candidates && plan.candidates.length > 0 ? plan.candidates.map((c) => {
                const verdictKey = c.verdict || '';
                const localizedVerdict = t.verdicts[verdictKey] || verdictKey;
                const localizedReason = t.reasons[verdictKey] || c.reason;
                const isImmune = verdictKey === 'REJECTED_NON_SUBAGENT';

                return h('div', {
                  key: c.sessionId,
                  style: { padding: '5px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }
                }, [
                  h('div', { key: 'cand-info', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
                    h('span', { key: 'cand-id', style: { fontFamily: 'monospace', color: '#eee', fontSize: '11px' } }, c.sessionId),
                    localizedReason ? h('span', { key: 'cand-reason', style: { color: '#888', fontSize: '10px' } }, localizedReason) : null,
                  ]),
                  h('span', {
                    key: 'cand-badge',
                    style: {
                      padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap',
                      background: isImmune ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                      color: isImmune ? '#10b981' : '#fb7185',
                      border: `1px solid ${isImmune ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`
                    }
                  }, localizedVerdict)
                ]);
              }) : [h('div', { key: 'empty-cands', style: { color: '#666', padding: '8px' } }, t.noCandidates)])
            ])
          ]))
        ])
      ]) : null
    ]);
  }

  // Class Error Boundary to prevent crashing BetterSidebar
  const ReactComponent = (React && typeof React.Component === 'function') ? React.Component : class DummyComponent { constructor(props) { this.props = props; this.state = {}; } };

  class HudErrorBoundary extends ReactComponent {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
      return { hasError: true, error };
    }
    componentDidCatch(error, info) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('dsh-fleet-cleaner [ErrorBoundary]:', error, info);
      }
    }
    render() {
      if (this.state.hasError) {
        return h('div', {
          style: { padding: '10px', background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', borderRadius: '6px', fontSize: '11px' }
        }, [
          h('div', { key: 'eb-t', style: { fontWeight: 'bold', marginBottom: '4px' } }, 'Fleet Cleaner: View Error'),
          h('div', { key: 'eb-m', style: { fontSize: '10px' } }, String(this.state.error?.message || this.state.error))
        ]);
      }
      return this.props.children;
    }
  }

  function FleetCleanerTab(props) {
    return h(HudErrorBoundary, null, h(FleetCleanerHud, props));
  }

  FleetCleanerHud.FleetCleanerTab = FleetCleanerTab;
  FleetCleanerHud.HudErrorBoundary = HudErrorBoundary;

  return FleetCleanerHud;
}
