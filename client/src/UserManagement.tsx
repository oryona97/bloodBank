import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';

type User = {
  id: string;
  username: string;
  role: string;
  created_at: string;
};

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('WORKER');
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
      setNewRole('WORKER');
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
    <section className="records-dashboard" aria-label="User Management">
      <div className="records-summary">
        <div>
          <span className="eyebrow">TOTAL USERS</span>
          <strong>{loading ? '—' : users.length}</strong>
          <small>Active system accounts</small>
        </div>
      </div>

      <section className="panel records-panel">
        <div className="records-heading">
          <div>
            <h2>Add New User</h2>
            <p>Create a new account and assign a role.</p>
          </div>
        </div>

        <form
          className="record-filters"
          onSubmit={handleCreateUser}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                disabled={creating}
              >
                <option value="ADMIN">Admin (Full Access)</option>
                <option value="WORKER">Worker (Inventory Mgmt)</option>
                <option value="RESEARCHER">Researcher (Read-only Data)</option>
              </select>
            </label>
            <div className="filter-actions" style={{ alignSelf: 'flex-end', paddingBottom: '2px' }}>
              <button className="primary-button" type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create User'}
              </button>
            </div>
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
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>
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
