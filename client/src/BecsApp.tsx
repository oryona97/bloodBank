import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BLOOD_TYPES, type BloodType } from '../../shared/apiTypes.js';
import {
  PRODUCTS,
  COMPONENT_STATUSES,
  DEFAULT_RELEASE_REASON,
  ROLES,
  type Product,
  type SessionUser,
  type DonationRecord,
  type ComponentRecord,
  type BecsInventory,
  type BecsAllocation,
  type ResultRecord,
  type Catalogue,
} from '../../shared/becsTypes.js';
import { api, ApiError } from './api.js';
import { Login } from './Login.js';
import { RecordsDashboard } from './RecordsDashboard.js';
import { UserManagement } from './UserManagement.js';
import './becs.css';

type Screen =
  | 'inventory'
  | 'donations'
  | 'components'
  | 'laboratory'
  | 'routine'
  | 'emergency'
  | 'records'
  | 'catalogue'
  | 'users';
const labels: Record<Screen, string> = {
  inventory: 'Inventory',
  donations: 'Donation intake',
  components: 'Blood components',
  laboratory: 'Laboratory',
  routine: 'Routine dispensing',
  emergency: 'Emergency dispensing',
  records: 'Audit & records',
  catalogue: 'Product catalogue',
  users: 'User management',
};
const permitted: Record<string, Screen[]> = {
  ADMIN: ['inventory', 'components', 'records', 'catalogue', 'users'],
  OPERATOR: ['inventory', 'donations', 'components'],
  LAB: ['inventory', 'laboratory', 'components'],
  DISPENSER: ['inventory', 'routine', 'emergency', 'components'],
  RESEARCHER: ['inventory'],
};
const title = (value: string) =>
  value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (v) => v.toUpperCase());
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Not recorded';
const localTime = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function TypeOptions() {
  return (
    <>
      {BLOOD_TYPES.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </>
  );
}
function ProductOptions() {
  return (
    <>
      {PRODUCTS.map((p) => (
        <option key={p}>{p}</option>
      ))}
    </>
  );
}
function Badge({ value }: { value: string }) {
  return <span className={`becs-badge ${value.toLowerCase()}`}>{title(value)}</span>;
}
function Panel({ title: heading, children }: { title: string; children: ReactNode }) {
  return (
    <section className="becs-panel">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}
function Message({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && (
        <p className="becs-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="becs-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef(false),
    attempt = useRef<{ signature: string; key: string } | null>(null);
  async function run<T>(
    path: string,
    body: unknown,
    onSuccess: (value: T) => void | Promise<void>,
    message: string,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const signature = JSON.stringify({ path, body });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const value = await api<T>(path, body, attempt.current.key);
      attempt.current = null;
      await onSuccess(value);
      setNotice(message);
    } catch (e) {
      setError(
        e instanceof ApiError && e.body.fields
          ? Object.values(e.body.fields).join(' ')
          : e instanceof Error
            ? e.message
            : 'Connection interrupted. Retry the same action.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}
function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void api<T>(path)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e instanceof Error ? e.message : 'Could not load records.');
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, busy, reload };
}

export function BecsApp() {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('becs-user') ?? 'null') as SessionUser | null;
      return value && permitted[value.role] && localStorage.getItem('token') ? value : null;
    } catch {
      return null;
    }
  });
  const [screen, setScreen] = useState<Screen>('inventory');
  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('becs-user');
    setUser(null);
    setScreen('inventory');
  }, []);
  useEffect(() => {
    window.addEventListener('becs-session-expired', logout);
    return () => window.removeEventListener('becs-session-expired', logout);
  }, [logout]);
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          localStorage.setItem('becs-user', JSON.stringify(u));
          setUser(u);
          setScreen('inventory');
        }}
      />
    );
  const available = permitted[user.role] ?? ['inventory'];
  return (
    <div className="becs-app">
      <a className="becs-skip" href="#becs-main">
        Skip to content
      </a>
      <aside className="becs-sidebar">
        <div className="becs-brand">
          BloodBank<span>BECS PROJECT</span>
        </div>
        <nav aria-label="Workspace">
          {available.map((s) => (
            <button
              key={s}
              className={screen === s ? 'active' : ''}
              aria-current={screen === s ? 'page' : undefined}
              onClick={() => setScreen(s)}
            >
              {labels[s]}
            </button>
          ))}
        </nav>
        <div className="becs-account">
          <strong>{user.username}</strong>
          <span>{title(user.role)}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main id="becs-main" className="becs-main">
        <header className="becs-header">
          <p>Blood establishment management</p>
          <h1>{labels[screen]}</h1>
          <span>Quarantine, laboratory clearance and expiry are checked before every issue.</span>
        </header>
        {screen === 'inventory' && <Inventory />}
        {screen === 'donations' && <Donations />}
        {screen === 'components' && <Components role={user.role} />}
        {screen === 'laboratory' && <Laboratory />}
        {screen === 'routine' && <Dispensing />}
        {screen === 'emergency' && <Dispensing emergency />}
        {screen === 'records' && <RecordsDashboard role={user.role} />}
        {screen === 'catalogue' && <CatalogueScreen />}
        {screen === 'users' && <UserManagement />}
      </main>
    </div>
  );
}

function Inventory() {
  const { data, error, busy, reload } = useLoad<BecsInventory>('/inventory');
  const [product, setProduct] = useState<Product>('PRBC');
  return (
    <>
      <div className="becs-toolbar">
        <label>
          Product
          <select value={product} onChange={(e) => setProduct(e.target.value as Product)}>
            <ProductOptions />
          </select>
        </label>
        <button disabled={busy} onClick={reload}>
          Refresh inventory
        </button>
      </div>
      <Message error={error} />
      {busy && <p role="status">Loading inventory…</p>}
      {data && (
        <>
          <div className="becs-stats">
            {['AVAILABLE', 'QUARANTINED', 'EXPIRED', 'DISPENSED'].map((state) => (
              <div key={state}>
                <span>{title(state)}</span>
                <strong>{data.statusCounts[product][state] ?? 0}</strong>
              </div>
            ))}
          </div>
          <Panel title={`${product} available stock`}>
            <p>Released components with valid expiry and storage.</p>
            <div className="becs-blood-grid">
              {BLOOD_TYPES.map((t) => (
                <div key={t}>
                  <strong>{t}</strong>
                  <span>{data.products[product][t]}</span>
                  <small>available</small>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={`${product} stock by blood type and status`}>
            <div className="becs-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Blood type</th>
                    {COMPONENT_STATUSES.map((status) => (
                      <th key={status}>{title(status)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BLOOD_TYPES.map((type) => (
                    <tr key={type}>
                      <th>{type}</th>
                      {COMPONENT_STATUSES.map((status) => (
                        <td key={status}>{data.statusByBloodType[product][type][status]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Component status overview">
            <div className="becs-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    {[
                      'AVAILABLE',
                      'QUARANTINED',
                      'EXPIRED',
                      'DISPENSED',
                      'PROCESSED',
                      'DISCARDED',
                    ].map((s) => (
                      <th key={s}>{title(s)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...PRODUCTS, 'LEGACY' as const].map((p) => (
                    <tr key={p}>
                      <th>{p === 'LEGACY' ? 'Legacy unknown product' : p}</th>
                      {[
                        'AVAILABLE',
                        'QUARANTINED',
                        'EXPIRED',
                        'DISPENSED',
                        'PROCESSED',
                        'DISCARDED',
                      ].map((s) => (
                        <td key={s}>{data.statusCounts[p][s] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

function Donations() {
  const list = useLoad<{ donations: DonationRecord[] }>('/donations'),
    action = useAction();
  const [bloodType, setType] = useState<BloodType>('A+'),
    [donorId, setId] = useState(''),
    [name, setName] = useState(''),
    [collected, setCollected] = useState(localTime),
    [selected, setSelected] = useState(''),
    [template, setTemplate] = useState('PRBC_FFP');
  const [detailId, setDetailId] = useState('');
  const detail = list.data?.donations.find((d) => d.donationId === detailId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const collectedAt = new Date(collected).toISOString();
    await action.run<{ donationId: string }>(
      '/donations',
      {
        bloodType,
        donorId,
        donorFullName: name,
        collectedAt,
        donationDate: collected.slice(0, 10),
      },
      (value) => {
        setSelected(value.donationId);
        setDetailId(value.donationId);
        list.reload();
      },
      'Donation registered in quarantine. Complete processing and laboratory clearance before issue.',
    );
  }
  return (
    <>
      <Panel title="Register a donation">
        <form className="becs-form" onSubmit={(e) => void submit(e)}>
          <label>
            Donor identifier
            <input
              required
              pattern="[0-9]{9}"
              inputMode="numeric"
              maxLength={9}
              value={donorId}
              onChange={(e) => setId(e.target.value)}
              placeholder="9-digit synthetic identifier"
            />
          </label>
          <label>
            Donor full name
            <input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Initial blood type
            <select value={bloodType} onChange={(e) => setType(e.target.value as BloodType)}>
              <TypeOptions />
            </select>
          </label>
          <label>
            Collection date and time
            <input
              type="datetime-local"
              required
              value={collected}
              max={localTime()}
              onChange={(e) => setCollected(e.target.value)}
            />
          </label>
          <button disabled={action.busy}>Register in quarantine</button>
        </form>
      </Panel>
      <Message error={action.error || list.error} notice={action.notice} />
      <Panel title="Produce components">
        <form
          className="becs-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              `/donations/${selected}/components`,
              { template },
              () => list.reload(),
              'Components created in their assigned storage locations. Laboratory clearance still applies.',
            );
          }}
        >
          <label>
            Donation
            <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a donation</option>
              {list.data?.donations
                .filter((d) => !d.processedAt && d.collectedAt && d.labStatus !== 'REJECTED')
                .map((d) => (
                  <option key={d.donationId} value={d.donationId}>
                    {d.donorFullName} · {d.bloodType} · {d.donationId.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Processing template
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="PRBC_FFP">Red cells + plasma</option>
              <option value="PRBC_FFP_PLATELETS">Red cells + plasma + platelets</option>
            </select>
          </label>
          <button disabled={action.busy || !selected}>Produce components</button>
        </form>
        <p>Cryoprecipitate is produced separately from an unissued plasma component.</p>
      </Panel>
      {detail && (
        <DonationDetails
          key={`${detail.donationId}-${detail.labStatus}-${detail.processedAt}`}
          donation={detail}
        />
      )}
      <DonationTable donations={list.data?.donations ?? []} identifying onOpen={setDetailId} />
    </>
  );
}
function DonationTable({
  donations,
  identifying = false,
  onOpen,
}: {
  donations: DonationRecord[];
  identifying?: boolean;
  onOpen?: (id: string) => void;
}) {
  return (
    <Panel title="Donation work list">
      <div className="becs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Donation</th>
              {identifying && <th>Donor</th>}
              <th>Blood type</th>
              <th>Collected · Jerusalem</th>
              <th>Laboratory</th>
              <th>Processing</th>
            </tr>
          </thead>
          <tbody>
            {donations.map((d) => (
              <tr key={d.donationId}>
                <td>
                  {onOpen ? (
                    <button
                      title={d.donationId}
                      aria-label={`Open donation ${d.donationId}`}
                      onClick={() => onOpen(d.donationId)}
                    >
                      {d.donationId.slice(0, 8)}
                    </button>
                  ) : (
                    <code title={d.donationId}>{d.donationId.slice(0, 8)}</code>
                  )}
                </td>
                {identifying && (
                  <td>
                    {d.donorFullName}
                    <small>{d.donorId}</small>
                  </td>
                )}
                <td>{d.verifiedType ?? d.bloodType}</td>
                <td>{date(d.collectedAt)}</td>
                <td>
                  <Badge value={d.labStatus} />
                </td>
                <td>{d.processedAt ? 'Processed' : 'Awaiting processing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!donations.length && <p>No donations to display.</p>}
      </div>
    </Panel>
  );
}

function DonationDetails({ donation }: { donation: DonationRecord }) {
  const components = useLoad<{ components: ComponentRecord[] }>(
    `/components?donationId=${donation.donationId}`,
  );
  return (
    <Panel title="Donation details and components">
      <p>
        <strong>Donation {donation.donationId}</strong>
      </p>
      {donation.donorFullName && (
        <p>
          {donation.donorFullName} · {donation.donorId}
        </p>
      )}
      <p>
        Collected: {date(donation.collectedAt)} · Blood type:{' '}
        {donation.verifiedType ?? donation.bloodType} · Panel {donation.panelVersion} ·{' '}
        <Badge value={donation.labStatus} />
      </p>
      <button disabled={components.busy} onClick={components.reload}>
        Refresh donation components
      </button>
      <Message error={components.error} />
      {components.busy && <p role="status">Loading donation components…</p>}
      <div className="becs-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th>Product</th>
              <th>Status</th>
              <th>Produced · Jerusalem</th>
              <th>Expiry · Jerusalem</th>
              <th>Storage and source</th>
            </tr>
          </thead>
          <tbody>
            {components.data?.components.map((c) => (
              <tr key={c.componentId}>
                <td>
                  <code title={c.componentId}>{c.componentId.slice(0, 8)}</code>
                </td>
                <td>
                  {c.productType}
                  <small>Profile {c.policyVersion}</small>
                </td>
                <td>
                  <Badge value={c.status} />
                  {c.discardReason && <small>{c.discardReason}</small>}
                </td>
                <td>{date(c.producedAt)}</td>
                <td>{date(c.expiresAt)}</td>
                <td>
                  {c.storageLocation ?? 'Unverified'}
                  {c.sourceComponentId && (
                    <small title={c.sourceComponentId}>
                      Source {c.sourceComponentId.slice(0, 8)}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!components.busy && !components.data?.components.length && (
        <p>No components produced yet.</p>
      )}
    </Panel>
  );
}

function Components({ role }: { role: string }) {
  const [product, setProduct] = useState(''),
    [bloodType, setType] = useState(''),
    [status, setStatus] = useState(''),
    [search, setSearch] = useState(''),
    [soon, setSoon] = useState(false),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<ComponentRecord | null>(null),
    [reason, setReason] = useState('');
  const [legacy, setLegacy] = useState<ComponentRecord | null>(null),
    [legacyProduct, setLegacyProduct] = useState<'PRBC' | 'FFP' | 'Platelets'>('PRBC'),
    [legacyCollected, setLegacyCollected] = useState('');
  const [horizon] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString());
  const query = new URLSearchParams({ page: String(page) });
  if (product) query.set('productType', product);
  if (bloodType) query.set('bloodType', bloodType);
  if (status) query.set('status', status);
  if (search) query.set('search', search);
  if (soon) query.set('expiresBefore', horizon);
  const list = useLoad<{ components: ComponentRecord[]; total: number; pageSize: number }>(
      `/components?${query}`,
    ),
    action = useAction();
  const canManage = role === 'OPERATOR' || role === 'LAB';
  return (
    <>
      <div className="becs-toolbar">
        <label>
          Product
          <select
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All products</option>
            <ProductOptions />
            <option>LEGACY</option>
          </select>
        </label>
        <label>
          Blood type
          <select
            value={bloodType}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            <TypeOptions />
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['AVAILABLE', 'QUARANTINED', 'EXPIRED', 'DISCARDED', 'DISPENSED', 'PROCESSED'].map(
              (s) => (
                <option key={s} value={s}>
                  {title(s)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Component or donation identifier
          <input
            type="search"
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="becs-check">
          <input
            type="checkbox"
            checked={soon}
            onChange={(e) => {
              setSoon(e.target.checked);
              setPage(1);
            }}
          />
          Expiry within seven days
        </label>
        <button disabled={list.busy} onClick={list.reload}>
          Refresh
        </button>
      </div>
      <Message error={list.error || action.error} notice={action.notice} />
      <Panel title="Managed blood components">
        <p>
          {list.data?.total ?? 0} matching components. Expired and quarantined components are
          excluded from available stock.
        </p>
        <div className="becs-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Product</th>
                <th>Blood type</th>
                <th>Status</th>
                <th>Expiry · Jerusalem</th>
                <th>Storage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.components.map((c) => (
                <tr key={c.componentId}>
                  <td>
                    <code title={c.componentId}>{c.componentId.slice(0, 8)}</code>
                    <small title={c.donationId}>Donation {c.donationId.slice(0, 8)}</small>
                  </td>
                  <td>
                    {c.productType}
                    <small>Profile {c.policyVersion}</small>
                  </td>
                  <td>{c.bloodType}</td>
                  <td>
                    <Badge value={c.status} />
                    <small>{title(c.labStatus)}</small>
                  </td>
                  <td>{date(c.expiresAt)}</td>
                  <td>
                    {c.storageLocation ?? 'Unverified'}
                    {c.sourceComponentId && (
                      <small title={c.sourceComponentId}>
                        Source {c.sourceComponentId.slice(0, 8)}
                      </small>
                    )}
                  </td>
                  <td>
                    {canManage && ['AVAILABLE', 'QUARANTINED', 'EXPIRED'].includes(c.status) && (
                      <button
                        disabled={action.busy}
                        onClick={() => {
                          setSelected(c);
                          setReason('');
                        }}
                      >
                        Discard
                      </button>
                    )}
                    {role === 'OPERATOR' &&
                      c.productType === 'LEGACY' &&
                      c.status === 'QUARANTINED' && (
                        <button
                          disabled={action.busy}
                          onClick={() => {
                            setLegacy(c);
                            setSelected(null);
                            setReason('');
                            setLegacyCollected('');
                          }}
                        >
                          Complete verified details
                        </button>
                      )}
                    {role === 'OPERATOR' &&
                      c.productType === 'FFP' &&
                      ['AVAILABLE', 'QUARANTINED'].includes(c.status) && (
                        <button
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(
                              `/components/${c.componentId}/process`,
                              { productType: 'Cryoprecipitate' },
                              () => list.reload(),
                              'Cryoprecipitate created. The plasma source is now consumed.',
                            )
                          }
                        >
                          Produce cryo
                        </button>
                      )}
                    {c.discardReason && <small>{c.discardReason}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.busy && !list.data?.components.length && <p>No matching components.</p>}
        </div>
        <div className="becs-toolbar">
          <button disabled={page === 1 || list.busy} onClick={() => setPage((v) => v - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={list.busy || page * 100 >= (list.data?.total ?? 0)}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
      {selected && (
        <Panel title={`Discard ${selected.productType} component`}>
          <form
            className="becs-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(
                `/components/${selected.componentId}/discard`,
                { reason },
                () => {
                  setSelected(null);
                  list.reload();
                },
                'Component discarded. The reason is recorded in its history.',
              );
            }}
          >
            <label>
              Discard reason
              <input
                autoFocus
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={action.busy}>Confirm discard</button>
            <button type="button" disabled={action.busy} onClick={() => setSelected(null)}>
              Cancel
            </button>
          </form>
        </Panel>
      )}
      {legacy && (
        <Panel title="Complete a legacy record">
          <p>
            Enter only details verified from the preserved record. Laboratory results and approval
            are still required. Already issued records cannot be changed.
          </p>
          <form
            className="becs-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(
                `/components/${legacy.componentId}/legacy-details`,
                {
                  productType: legacyProduct,
                  collectedAt: new Date(legacyCollected).toISOString(),
                  reason,
                },
                () => {
                  setLegacy(null);
                  list.reload();
                },
                'Verified legacy details saved. The component remains in quarantine.',
              );
            }}
          >
            <label>
              Verified existing product
              <select
                value={legacyProduct}
                onChange={(e) => setLegacyProduct(e.target.value as 'PRBC' | 'FFP' | 'Platelets')}
              >
                <option>PRBC</option>
                <option>FFP</option>
                <option>Platelets</option>
              </select>
            </label>
            <label>
              Verified collection date and time
              <input
                autoFocus
                required
                type="datetime-local"
                value={legacyCollected}
                max={localTime()}
                onChange={(e) => setLegacyCollected(e.target.value)}
              />
            </label>
            <label>
              Verification source and reason
              <input
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={action.busy}>Save verified details</button>
            <button disabled={action.busy} type="button" onClick={() => setLegacy(null)}>
              Cancel
            </button>
          </form>
        </Panel>
      )}
    </>
  );
}

function Laboratory() {
  const work = useLoad<{ donations: DonationRecord[] }>('/donations'),
    action = useAction();
  const catalogue = useLoad<Catalogue>('/catalog');
  const [approvalReason, setApprovalReason] = useState(DEFAULT_RELEASE_REASON);
  const [selected, setSelected] = useState(''),
    [testCode, setCode] = useState('ABO_RH'),
    [value, setValue] = useState('A+'),
    [performed, setPerformed] = useState(localTime),
    [reason, setReason] = useState('');
  const [history, setHistory] = useState<ResultRecord[]>([]),
    [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(0);
  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    if (!selected) {
      setHistory([]);
      return;
    }
    try {
      const result = await api<{ results: ResultRecord[] }>(`/donations/${selected}/lab-results`);
      if (request === historyRequest.current) {
        setHistory(result.results);
        setHistoryError('');
      }
    } catch (e) {
      if (request === historyRequest.current)
        setHistoryError(e instanceof Error ? e.message : 'Could not load results.');
    }
  }, [selected]);
  useEffect(() => {
    void loadHistory();
    return () => {
      historyRequest.current++;
    };
  }, [loadHistory]);
  const donation = work.data?.donations.find((d) => d.donationId === selected);
  const latest = Object.fromEntries(history.map((r) => [r.testCode, r]));
  const panelTests =
    catalogue.data?.tests.filter((test) => test.panel_version === donation?.panelVersion) ?? [];
  const selectDonation = (id: string) => {
    historyRequest.current++;
    setHistory([]);
    setHistoryError('');
    setReason('');
    setApprovalReason(DEFAULT_RELEASE_REASON);
    setCode('ABO_RH');
    setValue(work.data?.donations.find((d) => d.donationId === id)?.bloodType ?? 'A+');
    setSelected(id);
  };
  return (
    <>
      <Panel title="Laboratory work queue">
        <label className="becs-field">
          Donation
          <select value={selected} onChange={(e) => selectDonation(e.target.value)}>
            <option value="">Choose a donation</option>
            {work.data?.donations.map((d) => (
              <option key={d.donationId} value={d.donationId}>
                {d.bloodType} · {title(d.labStatus)} · {d.donationId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={work.busy}
          onClick={() => {
            work.reload();
            void loadHistory();
          }}
        >
          Refresh laboratory
        </button>
      </Panel>
      <Message
        error={action.error || work.error || historyError || catalogue.error}
        notice={action.notice}
      />
      {donation && (
        <>
          <DonationDetails
            key={`${donation.donationId}-${donation.labStatus}-${donation.processedAt}`}
            donation={donation}
          />
          <Panel title="Record or correct a result">
            <p>
              Initial blood type: <strong>{donation.bloodType}</strong> · Panel{' '}
              {donation.panelVersion} · <Badge value={donation.labStatus} />
            </p>
            <form
              className="becs-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(
                  `/donations/${selected}/lab-results`,
                  {
                    testCode,
                    value,
                    performedAt: new Date(performed).toISOString(),
                    ...(reason.trim() ? { reason } : {}),
                  },
                  async () => {
                    await loadHistory();
                    work.reload();
                    setReason('');
                  },
                  'Result recorded. Approval is a separate action.',
                );
              }}
            >
              <label>
                Test
                <select
                  value={testCode}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setValue(e.target.value === 'ABO_RH' ? donation.bloodType : 'NEGATIVE');
                  }}
                >
                  {panelTests.map((t) => (
                    <option key={t.code}>{t.code}</option>
                  ))}
                </select>
              </label>
              <label>
                Result
                <select value={value} onChange={(e) => setValue(e.target.value)}>
                  {testCode === 'ABO_RH' ? (
                    <TypeOptions />
                  ) : (
                    <>
                      <option value="NEGATIVE">Nonreactive</option>
                      <option value="REACTIVE">Reactive</option>
                      <option value="INDETERMINATE">Indeterminate</option>
                      <option value="PENDING">Pending</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                Performed date and time
                <input
                  required
                  type="datetime-local"
                  value={performed}
                  max={localTime()}
                  onChange={(e) => setPerformed(e.target.value)}
                />
              </label>
              <label>
                Reason for correction or rejection
                <input
                  minLength={3}
                  maxLength={500}
                  required={Boolean(latest[testCode])}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button disabled={action.busy}>Save result</button>
            </form>
          </Panel>
          <Panel title="Release decision">
            <p>
              Every required result must be acceptable and typing must match. Approval never
              overrides expiry, disposal or storage requirements.
            </p>
            <div className="becs-result-grid">
              {panelTests.map((t) => (
                <div key={t.code}>
                  <strong>{t.code}</strong>
                  <span>{latest[t.code]?.value ?? 'Missing'}</span>
                </div>
              ))}
            </div>
            <label className="becs-field">
              Approval reason
              <input
                minLength={3}
                maxLength={500}
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
              />
            </label>
            <div className="becs-toolbar">
              <button
                disabled={
                  action.busy ||
                  approvalReason.trim().length < 3 ||
                  donation.labStatus === 'REJECTED' ||
                  !panelTests.length
                }
                onClick={() =>
                  void action.run(
                    `/donations/${selected}/release`,
                    { decision: 'APPROVE', reason: approvalReason },
                    () => work.reload(),
                    'Laboratory release approved. Only eligible components become available.',
                  )
                }
              >
                Approve release
              </button>
              <button
                className="becs-danger"
                disabled={
                  action.busy || reason.trim().length < 3 || donation.labStatus === 'REJECTED'
                }
                onClick={() =>
                  void action.run(
                    `/donations/${selected}/release`,
                    { decision: 'REJECT', reason },
                    () => work.reload(),
                    'Donation rejected. Its remaining components are blocked.',
                  )
                }
              >
                Reject donation
              </button>
            </div>
          </Panel>
          <Panel title="Result history">
            <div className="becs-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Result</th>
                    <th>Revision</th>
                    <th>Performed · Jerusalem</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.resultId}>
                      <th>{r.testCode}</th>
                      <td>{r.value}</td>
                      <td>{r.revision}</td>
                      <td>{date(r.performedAt)}</td>
                      <td>{r.reason ?? 'Initial result'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      <DonationTable donations={work.data?.donations ?? []} onOpen={selectDonation} />
    </>
  );
}

function Dispensing({ emergency = false }: { emergency?: boolean }) {
  const stock = useLoad<BecsInventory>('/inventory'),
    action = useAction();
  const [product, setProduct] = useState<Product>('PRBC'),
    [bloodType, setType] = useState<BloodType>('A+'),
    [quantity, setQuantity] = useState(1),
    [reference, setReference] = useState(''),
    [plan, setPlan] = useState<BecsAllocation | null>(null),
    [ready, setReady] = useState(false);
  const invalidate = () => {
    setPlan(null);
    setReady(false);
  };
  async function preview(e: FormEvent) {
    e.preventDefault();
    if (emergency) {
      setReady(true);
      return;
    }
    await action.run<BecsAllocation>(
      '/dispensing/preview',
      { productType: product, recipientType: bloodType, quantity },
      setPlan,
      'Allocation preview prepared. Stock has not been reserved.',
    );
  }
  async function cancel() {
    await action.run(
      '/activities/cancel',
      emergency
        ? { operation: 'EMERGENCY' }
        : { operation: 'ROUTINE', recipientType: bloodType, quantity },
      invalidate,
      'Dispensing cancelled. Inventory was not changed.',
    );
  }
  const confirm = () =>
    void action.run<{ quantity: number }>(
      '/dispensing/' + (emergency ? 'emergency' : 'confirm'),
      emergency
        ? { quantity, recipientReference: reference }
        : {
            productType: product,
            recipientType: bloodType,
            quantity,
            recipientReference: reference,
            lines: plan!.lines,
            componentIds: plan!.componentIds,
          },
      () => {
        invalidate();
        stock.reload();
      },
      `${quantity} ${emergency ? 'O-negative PRBC' : product} component${quantity === 1 ? '' : 's'} issued.`,
    );
  return (
    <>
      <Panel title={emergency ? 'Emergency O-negative red cells' : 'Request components'}>
        <p>
          {emergency
            ? 'Only cleared, unexpired PRBC O-negative components can be issued.'
            : 'Choose a product and recipient blood type. Components are prioritized by compatible type and nearest expiry.'}
        </p>
        {emergency && (
          <p>
            <strong>{stock.data?.products.PRBC['O-'] ?? '—'}</strong> cleared O-negative red cells
            available
          </p>
        )}
        <form className="becs-form" onSubmit={(e) => void preview(e)}>
          {!emergency && (
            <>
              <label>
                Product
                <select
                  value={product}
                  onChange={(e) => {
                    setProduct(e.target.value as Product);
                    invalidate();
                  }}
                >
                  <ProductOptions />
                </select>
              </label>
              <label>
                Recipient blood type
                <select
                  value={bloodType}
                  onChange={(e) => {
                    setType(e.target.value as BloodType);
                    invalidate();
                  }}
                >
                  <TypeOptions />
                </select>
              </label>
            </>
          )}
          <label>
            Quantity
            <input
              required
              type="number"
              min={1}
              max={1000}
              step={1}
              value={quantity}
              onChange={(e) => {
                setQuantity(Number(e.target.value));
                invalidate();
              }}
            />
          </label>
          <label>
            Recipient or department reference
            <input
              required
              minLength={3}
              maxLength={120}
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                invalidate();
              }}
              placeholder="Synthetic reference"
            />
          </label>
          <button disabled={action.busy || !Number.isInteger(quantity) || quantity < 1}>
            Review request
          </button>
        </form>
      </Panel>
      <Message error={action.error || stock.error} notice={action.notice} />
      {plan && (
        <Panel title={plan.canFulfill ? 'Review allocation' : 'Insufficient compatible stock'}>
          <p>
            Requested {plan.quantity} · Eligible stock {plan.available}
            {!plan.canFulfill && ` · Shortfall ${plan.shortfall}`}
          </p>
          <div className="becs-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Blood type</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((line) => (
                  <tr key={line.bloodType}>
                    <td>{line.bloodType}</td>
                    <td>{line.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!plan.canFulfill && <p>No components will be issued. Partial dispensing is disabled.</p>}
          <div className="becs-toolbar">
            {plan.canFulfill && (
              <button disabled={action.busy} onClick={confirm}>
                Confirm dispensing
              </button>
            )}
            <button disabled={action.busy} onClick={() => void cancel()}>
              Cancel request
            </button>
          </div>
        </Panel>
      )}
      {emergency && ready && (
        <Panel title="Confirm emergency issue">
          <p>
            Issue {quantity} cleared O-negative red cell component{quantity === 1 ? '' : 's'} to{' '}
            {reference}. The current stock and expiry will be checked again.
          </p>
          <div className="becs-toolbar">
            <button disabled={action.busy} className="becs-danger" onClick={confirm}>
              Confirm emergency dispensing
            </button>
            <button disabled={action.busy} onClick={() => void cancel()}>
              Cancel request
            </button>
          </div>
        </Panel>
      )}
    </>
  );
}

function CatalogueScreen() {
  const list = useLoad<Catalogue>('/catalog'),
    action = useAction();
  const [product, setProduct] = useState<Product>('PRBC'),
    [days, setDays] = useState(42);
  const [extraTest, setExtraTest] = useState(''),
    [panelReason, setPanelReason] = useState('');
  const activeTests =
    list.data?.tests.filter((t) => t.panel_version === list.data?.activePanelVersion) ?? [];
  return (
    <>
      <Panel title="Versioned product policies">
        <p>
          These are simulation policies. New versions apply only to subsequently produced
          components; existing expiry dates stay unchanged.
        </p>
        <div className="becs-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Version</th>
                <th>Days from collection</th>
                <th>Expiry basis</th>
                <th>Storage</th>
                <th>Temperature °C</th>
                <th>Agitation</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.products.map((p) => (
                <tr key={`${p.code}-${p.policy_version}`}>
                  <th>{p.code}</th>
                  <td>{p.policy_version}</td>
                  <td>{p.expiry_days}</td>
                  <td>
                    {p.expiry_basis === 'SOURCE_EXPIRY'
                      ? 'Collection, capped by source expiry'
                      : 'Collection time'}
                  </td>
                  <td>{title(p.storage_class)}</td>
                  <td>
                    {p.min_c === null ? `At or below ${p.max_c}` : `${p.min_c} to ${p.max_c}`}
                  </td>
                  <td>{p.agitation ? 'Required' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="becs-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              '/catalog/products',
              { productType: product, expiryDays: days },
              () => list.reload(),
              'A new profile version was created. Existing components are unchanged.',
            );
          }}
        >
          <label>
            Product
            <select value={product} onChange={(e) => setProduct(e.target.value as Product)}>
              <ProductOptions />
            </select>
          </label>
          <label>
            Shelf life in days
            <input
              required
              type="number"
              min={1}
              max={3650}
              step={1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <button disabled={action.busy}>Create profile version</button>
        </form>
      </Panel>
      <Message error={action.error || list.error} notice={action.notice} />
      <Panel title="Storage locations">
        <div className="becs-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Storage class</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.locations.map((l) => (
                <tr key={l.location_id}>
                  <td>{l.label}</td>
                  <td>{title(l.storage_class)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Required laboratory tests">
        <p>
          New donations use panel {list.data?.activePanelVersion ?? '…'}. Existing donations retain
          their original panel and results.
        </p>
        <div className="becs-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th>Panel</th>
                <th>Result type</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.tests.map((t) => (
                <tr key={`${t.code}-${t.panel_version}`}>
                  <td>{t.code}</td>
                  <td>{t.panel_version}</td>
                  <td>{title(t.result_kind)}</td>
                  <td>{t.required ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="becs-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              '/catalog/panels',
              {
                reason: panelReason,
                tests: [
                  ...activeTests.map((t) => ({
                    code: t.code,
                    resultKind: t.result_kind,
                    required: true,
                  })),
                  { code: extraTest, resultKind: 'SCREENING', required: true },
                ],
              },
              () => {
                list.reload();
                setExtraTest('');
                setPanelReason('');
              },
              'New laboratory panel published for future donations.',
            );
          }}
        >
          <label>
            Additional required screening code
            <input
              required
              pattern="[A-Z][A-Z0-9_]{0,39}"
              maxLength={40}
              value={extraTest}
              onChange={(e) => setExtraTest(e.target.value.toUpperCase())}
              placeholder="DEMO_SCREEN"
            />
          </label>
          <label>
            Panel change reason
            <input
              required
              minLength={3}
              maxLength={500}
              value={panelReason}
              onChange={(e) => setPanelReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              action.busy || !activeTests.length || activeTests.some((t) => t.code === extraTest)
            }
          >
            Publish new panel version
          </button>
        </form>
        <p>Publishing retains the current required tests and adds the screening above.</p>
        {list.data?.panels.map((panel) => (
          <p key={panel.panel_version}>
            Panel {panel.panel_version} · {date(panel.published_at)} · {panel.reason}
          </p>
        ))}
      </Panel>
    </>
  );
}
