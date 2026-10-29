import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fridayOf, roleLabel, setViewAs, todayISO, unsaved } from './lib.js';
import { AppCtx, Avatar, WaSheet } from './ui.jsx';
import { PreviewBanner, PreviewPicker } from './pages/Preview.jsx';
import SyncDialog from './pages/SyncDialog.jsx';
import { Invite, Login, Setup } from './pages/Auth.jsx';
import Schedule from './pages/Schedule.jsx';
import MyShifts from './pages/MyShifts.jsx';
import Requests from './pages/Requests.jsx';
import Team from './pages/Team.jsx';
import Resources from './pages/Resources.jsx';
import Settings from './pages/Settings.jsx';
import Groups from './pages/Groups.jsx';
import Plans from './pages/Plans.jsx';
import Guest from './pages/Guest.jsx';
import Account from './pages/Account.jsx';
import WeekendCheck from './pages/WeekendCheck.jsx';
import Activity, { ActivityTicker } from './pages/Activity.jsx';
import RunSheet from './pages/RunSheet.jsx';

export default function App() {
  const inviteToken = useMemo(() => window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)/)?.[1] || null, []);
  const guestToken = useMemo(() => window.location.pathname.match(/^\/guest\/([A-Za-z0-9_-]+)/)?.[1] || null, []);
  const runsheetId = useMemo(() => window.location.pathname.match(/^\/runsheet\/([a-f0-9]{24})/)?.[1] || null, []);
  const [phase, setPhase] = useState(inviteToken ? 'invite' : 'loading');
  const [boot, setBoot] = useState(null);
  const [orgName, setOrgName] = useState('');
  // "View as": who the admin is previewing, and the admin's own roster to pick from.
  const [viewAs, setViewAsState] = useState(null);
  const [roster, setRoster] = useState([]);

  const load = useCallback(async () => {
    try {
      const b = await api('/bootstrap');
      // Came from a Booth Crew Academy link while signed out: carry on there now.
      const academyTo = new URLSearchParams(window.location.search).get('academy');
      if (academyTo !== null) {
        window.history.replaceState(null, '', '/');
        if (b.academy) {
          window.location.replace(`/api/academy/go?to=${encodeURIComponent(academyTo)}`);
          return;
        }
      }
      if (!b.me.previewing && b.me.role === 'admin') setRoster(b.people);
      setBoot(b);
      setPhase('app');
    } catch (e) {
      if (e.status === 404 && isPreviewing()) {
        exitPreview();
        return;
      }
      if (e.status !== 401) {
        setPhase('error');
        return;
      }
      try {
        const st = await api('/auth/status');
        setOrgName(st.orgName);
        setPhase(st.needsSetup ? 'setup' : 'login');
      } catch {
        setPhase('error');
      }
    }
  }, []);

  useEffect(() => {
    if (!inviteToken && !guestToken) load();
  }, [inviteToken, guestToken, load]);

  function isPreviewing() {
    return Boolean(viewAsRef.current);
  }
  const viewAsRef = useRef(null);
  const startPreview = (person) => {
    unsaved.clear();
    viewAsRef.current = person;
    setViewAs(person.id);
    setViewAsState(person);
    setBoot(null);
    load();
  };
  const exitPreview = () => {
    viewAsRef.current = null;
    setViewAs(null);
    setViewAsState(null);
    setBoot(null);
    load();
  };

  const finishInvite = () => {
    window.history.replaceState(null, '', '/');
    load();
  };

  if (guestToken) return <Guest token={guestToken} />;
  if (phase === 'invite') return <Invite token={inviteToken} onDone={finishInvite} />;
  if (phase === 'setup') return <Setup onDone={load} />;
  if (phase === 'login') return <Login orgName={orgName} onDone={load} />;
  if (phase === 'error')
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Can’t reach the server</h1>
          <p className="muted">Check that Crew Call is running, then try again.</p>
          <button className="btn btn-primary" onClick={load}>Try again</button>
        </div>
      </div>
    );
  if (phase === 'loading' || !boot) return <div className="loading">Loading…</div>;
  if (runsheetId) return <RunSheet id={runsheetId} />;
  return (
    <Shell
      key={viewAs?.id || 'me'}
      boot={boot}
      reload={load}
      onSignedOut={() => setPhase('login')}
      preview={viewAs ? { person: viewAs, roster, start: startPreview, exit: exitPreview } : roster.length ? { person: null, roster, start: startPreview, exit: exitPreview } : null}
    />
  );
}

const TABS = [
  { id: 'schedule', label: 'Schedule', show: () => true },
  { id: 'check', label: 'Weekend check', show: (c) => c.edit || c.approve || c.plans || c.message },
  { id: 'mine', label: 'My shifts', show: () => true },
  { id: 'plans', label: 'Service plans', show: () => true },
  { id: 'requests', label: 'Requests', show: (c) => c.approve },
  { id: 'groups', label: 'Groups', show: (c) => c.groups || c.message },
  { id: 'team', label: 'Team & roles', show: (c) => c.people },
  { id: 'resources', label: 'Resources & help', show: () => true },
  { id: 'settings', label: 'Settings', show: (c, me) => me.role === 'admin' },
  { id: 'activity', label: 'Activity', show: (c, me) => me.role === 'admin' },
];

// Lets the admin see who's keeping up. The server ignores the admin's own views.
function noteView(page, detail) {
  api('/activity/view', { method: 'POST', body: { page, detail } }).catch(() => {});
}

function Shell({ boot, reload, onSignedOut, preview }) {
  const { me, settings, positions, people, groups, announcements, academy } = boot;
  const can = me.can;
  const tabs = TABS.filter((t) => t.show(can, me));
  const fromHash = () => {
    const h = window.location.hash.replace('#', '');
    return tabs.some((t) => t.id === h) ? h : 'schedule';
  };
  const [tab, setTabState] = useState(fromHash);
  const [toastMsg, setToastMsg] = useState('');
  const [wa, setWa] = useState(null);
  const [account, setAccount] = useState(false);
  const [picking, setPicking] = useState(false);
  const [syncAsk, setSyncAsk] = useState(null);
  const previewingAs = preview?.person || null;
  const [pending, setPending] = useState(0);
  const [pendingPlans, setPendingPlans] = useState(0);
  const [resFilter, setResFilter] = useState('all');
  const [weekend, setWeekend] = useState(() => fridayOf(todayISO()));
  const timer = useRef(null);
  const isAdmin = me.role === 'admin';

  const setTab = (id) => {
    if (unsaved.size && !window.confirm('You have unsaved changes on this page. Leave without saving?')) return;
    unsaved.clear();
    setTabState(id);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!isAdmin) noteView(tab);
  }, [tab, isAdmin]);

  // Follow #hash links (e.g. from reminder emails) while the app is open.
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if (tabs.some((t) => t.id === h)) setTabState(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(''), 3500);
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      if (can.approve) {
        const list = await api('/requests');
        setPending(list.filter((r) => r.status === 'pending').length);
      }
      if (can.plans) setPendingPlans((await api('/plans/pending')).count);
    } catch {
      /* badges are best-effort */
    }
  }, [can.approve, can.plans]);

  useEffect(() => {
    refreshPending();
    const id = setInterval(refreshPending, 60000);
    return () => clearInterval(id);
  }, [refreshPending]);

  const ctx = useMemo(() => {
    const posMap = Object.fromEntries(positions.map((p) => [p.key, p.label]));
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const groupById = Object.fromEntries(groups.map((g) => [g.id, g]));
    return {
      me,
      can,
      settings,
      positions,
      people,
      groups,
      announcements,
      academy,
      group: (id) => groupById[id],
      posLabel: (k) => posMap[k] || k,
      person: (id) => byId[id],
      reload,
      toast,
      openWa: (opts) => setWa(opts),
      openSync: (data) => new Promise((resolve) => setSyncAsk({ ...data, resolve })),
      goTab: setTab,
      resFilter,
      setResFilter,
      refreshPending,
      weekend,
      setWeekend,
      noteView,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, toast, resFilter, refreshPending, weekend]);

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onSignedOut();
  };

  return (
    <AppCtx.Provider value={ctx}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" width="32" height="32" alt="" />
          <span>
            <strong>Crew Call</strong>
            <span className="topbar-sub">{settings.orgName}</span>
          </span>
        </div>
        <div className="topbar-user">
          <button type="button" className="user-btn" onClick={() => setAccount(true)} aria-label="Your account">
            <Avatar name={me.name} size={32} tone="accent" />
            <span>
              <span className="user-name">{me.name}</span>
              <span className="topbar-sub">{roleLabel(me)}</span>
            </span>
          </button>
          {preview && !previewingAs && (
            <button type="button" className="btn btn-dark" onClick={() => setPicking(true)} title="See the app exactly as one person sees it">
              View as…
            </button>
          )}
          {!previewingAs && (
            <button type="button" className="btn btn-dark" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {previewingAs && <PreviewBanner me={me} onSwitch={() => setPicking(true)} onExit={preview.exit} />}
      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'tab-on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'requests' && pending > 0 && <span className="badge">{pending}</span>}
            {t.id === 'plans' && pendingPlans > 0 && <span className="badge" title="Guest uploads waiting for approval">{pendingPlans}</span>}
          </button>
        ))}
      </nav>
      {isAdmin && <ActivityTicker onOpen={() => setTab('activity')} />}
      <main id="main" className="main">
        {tab === 'schedule' && <Schedule />}
        {tab === 'mine' && <MyShifts />}
        {tab === 'requests' && <Requests />}
        {tab === 'plans' && <Plans />}
        {tab === 'groups' && <Groups />}
        {tab === 'team' && <Team />}
        {tab === 'resources' && <Resources />}
        {tab === 'settings' && <Settings />}
        {tab === 'check' && <WeekendCheck />}
        {tab === 'activity' && <Activity />}
      </main>
      {wa && <WaSheet {...wa} groupLink={wa.groupLink ?? settings.groupLink} onClose={() => setWa(null)} />}
      {account && <Account onClose={() => setAccount(false)} />}
      {syncAsk && (
        <SyncDialog
          differs={syncAsk.differs}
          extra={syncAsk.extra}
          onClose={(choice) => {
            syncAsk.resolve(choice);
            setSyncAsk(null);
          }}
        />
      )}
      {picking && preview && (
        <PreviewPicker
          roster={preview.roster}
          current={previewingAs}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            preview.start(p);
          }}
        />
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
