import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ROLES,
  type AuthResponse,
  type User,
  type ResearchSummary,
} from '../../shared/apiTypes.js';
import { App } from './App.js';
import { api, setSessionToken } from './api.js';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed. Try again.';
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="account-panel panel">
      <h1>{title}</h1>
      {children}
    </main>
  );
}
function ErrorMessage({ value }: { value: string }) {
  return value ? (
    <p className="error-box" role="alert">
      {value}
    </p>
  ) : null;
}

export function AuthApp() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('operations');
  const clear = () => {
    setSessionToken('');
    setAuth(null);
    setView('operations');
  };
  const signedIn = (result: AuthResponse) => {
    setSessionToken(result.csrfToken);
    setAuth(result);
    setNotice('');
    setView(result.user.role === 'RESEARCHER' ? 'research' : 'operations');
  };
  useEffect(() => {
    let active = true;
    void api<AuthResponse>('/auth/me')
      .then((result) => {
        if (active) signedIn(result);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => {
      clear();
      setNotice('Your session ended. Please sign in again.');
    };
    window.addEventListener('session-expired', expired);
    return () => {
      active = false;
      window.removeEventListener('session-expired', expired);
    };
  }, []);
  useEffect(() => {
    if (!auth) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          clear();
          setNotice('Your session expired. Please sign in again.');
        },
        Math.max(0, Math.min(15 * 60 * 1000, Date.parse(auth.expiresAt) - Date.now())),
      );
    };
    reset();
    window.addEventListener('session-activity', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('session-activity', reset);
    };
  }, [auth]);
  if (loading)
    return (
      <Panel title="Blood Bank">
        <p>Checking your session…</p>
      </Panel>
    );
  if (!auth) return <Login notice={notice} onLogin={signedIn} />;
  const user = auth.user;
  const logout = async () => {
    try {
      await api('/auth/logout', {});
      clear();
    } catch (e) {
      setNotice(message(e));
    }
  };
  return (
    <>
      <header className="account-bar">
        <strong>
          {user.displayName} <small> · {user.role}</small>
        </strong>
        <nav aria-label="Account navigation">
          {!user.mustChangePassword && (
            <>
              {user.role !== 'RESEARCHER' && (
                <button
                  onClick={() => setView('operations')}
                  aria-current={view === 'operations' ? 'page' : undefined}
                >
                  Blood bank
                </button>
              )}
              <button
                onClick={() => setView('research')}
                aria-current={view === 'research' ? 'page' : undefined}
              >
                Research
              </button>
              {user.role === 'ADMIN' && (
                <>
                  <button onClick={() => setView('admin')}>Users & audit</button>
                  <button onClick={() => setView('records')}>Records</button>
                </>
              )}
              <button onClick={() => setView('password')}>Password</button>
            </>
          )}
          <button onClick={() => void logout()}>Sign out</button>
        </nav>
      </header>
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {user.mustChangePassword || view === 'password' ? (
        <PasswordForm
          onChanged={() => {
            clear();
            setNotice('Password changed. Sign in with your new password.');
          }}
        />
      ) : view === 'research' ? (
        <Research />
      ) : view === 'admin' && user.role === 'ADMIN' ? (
        <Admin currentUser={user} />
      ) : view === 'records' && user.role === 'ADMIN' ? (
        <Records />
      ) : user.role !== 'RESEARCHER' ? (
        <App key={user.id} canExport={user.role === 'ADMIN'} />
      ) : (
        <Research />
      )}
    </>
  );
}
function Login({ notice, onLogin }: { notice: string; onLogin: (auth: AuthResponse) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    try {
      onLogin(
        await api<AuthResponse>('/auth/login', {
          username: data.get('username'),
          password: data.get('password'),
        }),
      );
      form.reset();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Sign in to Blood Bank">
      <p>Use the account provided by your administrator.</p>
      {notice && <p role="status">{notice}</p>}
      <ErrorMessage value={error} />
      <form onSubmit={(e) => void submit(e)} className="account-form">
        <label className="field">
          Username
          <input name="username" autoComplete="username" required maxLength={64} />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Panel>
  );
}
function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', {
        currentPassword: data.get('current'),
        password: data.get('password'),
      });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Change password">
      <p>Choose a new password of 12–128 characters. This signs out all your sessions.</p>
      <ErrorMessage value={error} />
      <form className="account-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label className="field">
          Confirm new password
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <button className="primary-button" disabled={busy}>
          Change password
        </button>
      </form>
    </Panel>
  );
}
function Research() {
  const [data, setData] = useState<ResearchSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<ResearchSummary>('/research/summary')
      .then(setData)
      .catch((e) => setError(message(e)));
  }, []);
  return (
    <Panel title="Research summary">
      <p>
        Annual donation statistics from completed years. Published figures stay fixed; current
        inventory and personal records are not included.
      </p>
      <ErrorMessage value={error} />
      {data && (
        <>
          <p>
            Through {data.throughYear}. Groups with fewer than {data.minimumGroupSize} distinct
            donors, including zero, are shown as “Suppressed”. Totals are withheld.
          </p>
          {data.rows.length ? (
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Blood type</th>
                  <th>Donations</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={`${row.year}-${row.bloodType}`}>
                    <td>{row.year}</td>
                    <td>{row.bloodType}</td>
                    <td>{row.donations ?? 'Suppressed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No completed-year data is available in this release.</p>
          )}
        </>
      )}
    </Panel>
  );
}
type AuditRow = {
  id: string;
  action: string;
  created_at: string;
  actor_id: string | null;
  actor_role: string | null;
  attribution: string;
  details: unknown;
};
function Admin({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const loadUsers = async () => setUsers(await api<User[]>('/admin/users'));
  useEffect(() => {
    void loadUsers().catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    void api<AuditRow[]>(`/admin/audit?page=${page}`)
      .then(setLogs)
      .catch((e) => setError(message(e)));
  }, [page]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/users', {
        username: data.get('username'),
        displayName: data.get('displayName'),
        password: data.get('password'),
        role: data.get('role'),
      });
      form.reset();
      await loadUsers();
      setNotice('User created. They must change their temporary password at first sign-in.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>, user: User) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/users/${user.id}`, {
        role: data.get('role'),
        active: data.get('active') === 'on',
        ...(data.get('password') ? { password: data.get('password') } : {}),
      });
      form.reset();
      if (user.id === currentUser.id) {
        window.dispatchEvent(new Event('session-expired'));
        return;
      }
      await loadUsers();
      setNotice('User updated and their sessions revoked.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Users & audit">
      <ErrorMessage value={error} />
      {notice && <p role="status">{notice}</p>}
      <h2>Create account</h2>
      <form className="account-form" onSubmit={(e) => void create(e)}>
        <label className="field">
          Username
          <input name="username" required pattern="[a-zA-Z0-9_.\-]{3,64}" autoComplete="off" />
        </label>
        <label className="field">
          Display name
          <input name="displayName" required minLength={2} maxLength={120} />
        </label>
        <label className="field">
          Role
          <select name="role" defaultValue="STAFF">
            {ROLES.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Temporary password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <button className="primary-button" disabled={busy}>
          Create account
        </button>
      </form>
      <h2>Manage accounts</h2>
      <p>
        Saving an account revokes its sessions. Password resets require a new password at next
        sign-in.
      </p>
      {users.map((user) => (
        <form
          className="user-row"
          key={`${user.id}-${user.role}-${user.active}`}
          onSubmit={(e) => void update(e, user)}
        >
          <strong>
            {user.displayName} <small>({user.username})</small>
          </strong>
          <label className="field">
            Role
            <select name="role" defaultValue={user.role}>
              {ROLES.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label>
            <input name="active" type="checkbox" defaultChecked={user.active} /> Active
          </label>
          <label className="field">
            Reset password (optional)
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            Save account
          </button>
        </form>
      ))}
      <h2>Audit metadata</h2>
      <p>Read-only history. Legacy entries predate user accounts.</p>
      <button
        className="text-button"
        onClick={() =>
          void api<AuditRow[]>(`/admin/audit?page=${page}`)
            .then(setLogs)
            .catch((e) => setError(message(e)))
        }
      >
        Refresh audit
      </button>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor / role</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.action}</td>
                <td>
                  {row.actor_id ?? row.attribution}
                  <br />
                  {row.actor_role}
                </td>
                <td>
                  <details>
                    <summary>View record</summary>
                    <pre>{JSON.stringify(row.details, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="account-actions">
        <button
          className="secondary-button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="secondary-button"
          disabled={logs.length < 50}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </Panel>
  );
}
function Records() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  async function load() {
    try {
      setData(await api<Record<string, unknown>>('/export'));
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Panel title="Complete records">
      <p>
        Contains personal donor information. Copies include historical records, audit entries and
        the identities of account holders.
      </p>
      <ErrorMessage value={error} />
      <div className="account-actions no-print">
        <button className="primary-button" onClick={() => void load()}>
          Load readable copy
        </button>
        <a href="/api/export" download>
          Download JSON
        </a>
        {data && (
          <button className="secondary-button" onClick={() => window.print()}>
            Print copy
          </button>
        )}
      </div>
      {data &&
        Object.entries(data).map(([name, value]) => (
          <section key={name}>
            <h2>{name}</h2>
            <pre className="record-copy">{JSON.stringify(value, null, 2)}</pre>
          </section>
        ))}
    </Panel>
  );
}
