import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import { ROLES } from '../../shared/becsTypes.js';
import './user-management.css';

type User = {
  id: string;
  username: string;
  role: string;
  created_at: string;
  active: boolean;
};

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('OPERATOR');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api<User[]>('/users');
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    setCreateSuccess('');

    try {
      await api('/users', {
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setCreateSuccess(`User ${newUsername} created successfully.`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('OPERATOR');
      fetchUsers();
    } catch (err) {
      setCreateError(
        err instanceof ApiError
          ? err.body.fields
            ? Object.values(err.body.fields).join(', ')
            : err.message
          : 'Failed to create user',
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="records-dashboard user-management" aria-label="User Management">
      <div className="records-summary">
        <div>
          <span className="eyebrow">TOTAL USERS</span>
          <strong>{loading ? '—' : users.length}</strong>
          <small>Registered system accounts</small>
        </div>
      </div>

      <section className="panel records-panel">
        <div className="records-heading">
          <div>
            <h2>Add New User</h2>
            <p>Create a new account and assign a role.</p>
          </div>
        </div>

        <form className="record-filters user-create-form" onSubmit={handleCreateUser}>
          <div className="user-create-fields">
            <label>
              Username
              <input
                type="text"
                required
                minLength={3}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter username"
                disabled={creating}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter password"
                disabled={creating}
              />
            </label>
            <label>
              Role
              <select
                className="user-role-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                disabled={creating}
              >
                {ROLES.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </div>

          {createError && (
            <div className="error-box" role="alert">
              {createError}
            </div>
          )}
          {createSuccess && (
            <p className="records-message success" role="status">
              ✓ {createSuccess}
            </p>
          )}
        </form>
      </section>

      <section className="panel records-panel" style={{ marginTop: '2rem' }}>
        <div className="records-heading">
          <div>
            <h2>User Directory</h2>
            <p>List of all users with access to the system.</p>
          </div>
          <button className="secondary-button" disabled={loading} onClick={fetchUsers}>
            ↻ Refresh users
          </button>
        </div>

        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="records-empty" role="status">
            Loading users…
          </div>
        ) : (
          <div className="record-table-scroll">
            <table className="record-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Created At</th>
                  <th>ID</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                    </td>
                    <td>
                      <span className={`record-badge ${u.role.toLowerCase()}`}>{u.role}</span>
                    </td>
                    <td className="record-date">
                      {new Intl.DateTimeFormat('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(u.created_at))}
                    </td>
                    <td>
                      <code>{u.id.slice(0, 8)}</code>
                    </td>
                    <td>
                      <div className="user-access-actions">
                        <label className="user-role-field">
                          Role
                          <select
                            className="user-role-select"
                            aria-label={`Role for ${u.username}`}
                            value={u.role}
                            disabled={creating}
                            onChange={(e) => {
                              setCreating(true);
                              void api(
                                `/users/${u.id}`,
                                { role: e.target.value },
                                crypto.randomUUID(),
                              )
                                .then(() => fetchUsers())
                                .catch((err) =>
                                  setError(
                                    err instanceof Error ? err.message : 'Access change failed.',
                                  ),
                                )
                                .finally(() => setCreating(false));
                            }}
                          >
                            {u.role === 'WORKER' && <option>WORKER</option>}
                            {ROLES.map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="secondary-button"
                          disabled={creating}
                          onClick={() => {
                            setCreating(true);
                            void api(`/users/${u.id}`, { active: !u.active }, crypto.randomUUID())
                              .then(() => fetchUsers())
                              .catch((err) =>
                                setError(
                                  err instanceof Error ? err.message : 'Access change failed.',
                                ),
                              )
                              .finally(() => setCreating(false));
                          }}
                        >
                          {u.active ? 'Disable' : 'Enable'} account
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
