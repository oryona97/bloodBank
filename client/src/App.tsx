import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BLOOD_TYPES,
  type Allocation,
  type BloodType,
  type DispenseReceipt,
  type DonationInput,
  type InventoryResponse,
} from '../../shared/apiTypes.js';
import { api, ApiError } from './api.js';

type Screen = 'donation' | 'routine' | 'emergency';
const titles: Record<Screen, { label: string; title: string; description: string }> = {
  donation: {
    label: 'Donation intake',
    title: 'Every donation counts.',
    description: 'Register a donation and welcome a new unit into the blood bank.',
  },
  routine: {
    label: 'Routine dispensing',
    title: 'The right blood. Ready.',
    description: 'Find a compatible allocation while preserving rare blood types.',
  },
  emergency: {
    label: 'Emergency dispensing',
    title: 'Ready when it matters.',
    description: 'Release available O-negative units for a mass-casualty response.',
  },
};
function Drop({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2C9 6 5 10.2 5 14.3a7 7 0 0 0 14 0C19 10.2 15 6 12 2Z" fill="currentColor" />
      <path
        d="M8.5 14.5a3.5 3.5 0 0 0 3.5 3.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
function TypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: BloodType;
  onChange: (type: BloodType) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BloodType)}
      disabled={disabled}
    >
      {BLOOD_TYPES.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </select>
  );
}
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Retain the request key after a network error, so retrying cannot issue twice.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const pending = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  async function run<T>(
    path: string,
    body: unknown,
    success: (result: T) => void | Promise<void>,
    failure?: (error: unknown) => void,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setFields({});
    const signature = JSON.stringify({ path, body });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await api<T>(path, body, attempt.current.key);
      attempt.current = null;
      await success(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Connection interrupted. Retry the same action to safely retrieve its result.',
      );
      if (err instanceof ApiError) setFields(err.body.fields ?? {});
      failure?.(err);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, fields, run };
}

export function App({ canExport = false }: { canExport?: boolean }) {
  const [screen, setScreen] = useState<Screen>('donation');
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api<InventoryResponse>('/inventory'));
      setLoadError('');
    } catch {
      setLoadError(
        'Unable to load current stock. Check the API and PostgreSQL connection, then refresh.',
      );
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const completed = async (message: string) => {
    setNotice(message);
    await refresh();
  };
  const total = data ? Object.values(data.inventory).reduce((a, b) => a + b, 0) : null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setScreen('donation');
          }}
        >
          <span className="brand-icon">
            <Drop />
          </span>
          <span>
            bloodbank<span className="brand-caption">DONATION & DISTRIBUTION</span>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Workspace">
          {(Object.keys(titles) as Screen[]).map((key, i) => (
            <button
              key={key}
              className={`nav-item ${screen === key ? 'active' : ''}`}
              aria-current={screen === key ? 'page' : undefined}
              onClick={() => {
                setScreen(key);
                setNotice('');
              }}
            >
              <span className="nav-number">0{i + 1}</span>
              {titles[key].label}
              <span className="nav-arrow">↗</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-cross">+</span>
          <h3>
            A shared reserve.
            <br />A lasting impact.
          </h3>
          <p>Thoughtful allocation keeps vital blood available when it is needed most.</p>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">BB</span>
          <div>
            BECS project<small>Educational simulation</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Operations <span className="slash">/</span> <strong>{titles[screen].label}</strong>
          </span>
          <span className={`connection ${loadError ? 'offline' : ''}`}>
            <i />
            {loadError ? 'Connection unavailable' : data ? 'Database connected' : 'Connecting…'}
          </span>
        </header>
        <div className="page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">BLOOD BANK OPERATIONS</div>
              <h1>{titles[screen].title}</h1>
              <p>{titles[screen].description}</p>
            </div>
            <span className="date-badge">
              {new Intl.DateTimeFormat('en', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(new Date())}
            </span>
          </section>
          {notice && (
            <div className="notice" role="status">
              <span>✓ {notice}</span>
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {loadError && (
            <div className="error-box" role="alert">
              {loadError}
            </div>
          )}
          <section className="inventory-section" aria-label="Current inventory">
            <div className="section-heading">
              <h2>
                Available inventory{' '}
                <span className="count-pill">{total === null ? '—' : total} units</span>
              </h2>
              <div style={{ display: 'flex', gap: '1rem' }}>
                {canExport && (
                  <a
                    className="text-button"
                    href="/api/export"
                    download
                    style={{ textDecoration: 'none' }}
                  >
                    ↓ Export Records
                  </a>
                )}
                <button
                  className="text-button"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                >
                  {refreshing ? 'Refreshing…' : '↻ Refresh stock'}
                </button>
              </div>
            </div>
            <div className="inventory-grid">
              {BLOOD_TYPES.map((type) => (
                <div className={`stock-card ${type === 'O-' ? 'reserve' : ''}`} key={type}>
                  <div className="stock-top">
                    <span>{type}</span>
                    <Drop size={16} />
                  </div>
                  <strong>{data ? data.inventory[type] : '—'}</strong>
                  <small>{type === 'O-' ? 'Emergency reserve' : 'units available'}</small>
                </div>
              ))}
            </div>
          </section>
          <div className="work-grid">
            <section className="panel main-panel">
              <div hidden={screen !== 'donation'}>
                <DonationScreen disabled={!data || !!loadError} completed={completed} />
              </div>
              <div hidden={screen !== 'routine'}>
                <RoutineScreen disabled={!data || !!loadError} completed={completed} />
              </div>
              <div hidden={screen !== 'emergency'}>
                <EmergencyScreen
                  available={data?.inventory['O-'] ?? null}
                  disabled={!data || !!loadError}
                  completed={completed}
                />
              </div>
            </section>
            <aside className="right-column">
              <section className="policy-card">
                <div className="eyebrow">ALLOCATION WITH PURPOSE</div>
                <h2>
                  Save the rare.
                  <br />
                  Support the need.
                </h2>
                <p>
                  Exact matches come first. Compatible alternatives follow population frequency,
                  with O− preserved whenever possible.
                </p>
                <div className="policy-rule">
                  <span>01</span> Match the requested type
                </div>
                <div className="policy-rule">
                  <span>02</span> Choose compatible alternatives
                </div>
                <div className="policy-rule">
                  <span>03</span> Keep O− available for emergencies
                </div>
                <div className="policy-footer">Based on the assignment’s compatibility model</div>
              </section>
              <section className="panel activity-panel">
                <div className="section-heading">
                  <h2>Recent activity</h2>
                  <span className="tiny-label">LATEST 8</span>
                </div>
                {data?.activity.length ? (
                  <ul className="activity-list">
                    {data.activity.map((item) => (
                      <li key={item.id}>
                        <span
                          className={`activity-icon ${item.kind !== 'DONATION' ? 'issued' : ''}`}
                        >
                          {item.kind === 'DONATION' ? '+' : '↗'}
                        </span>
                        <div>
                          <strong>
                            {item.kind === 'DONATION'
                              ? 'Donation received'
                              : item.kind === 'EMERGENCY'
                                ? 'Emergency release'
                                : 'Routine dispensing'}
                          </strong>
                          <small>
                            {item.bloodType ?? 'O-'} · {item.quantity}{' '}
                            {item.quantity === 1 ? 'unit' : 'units'}
                          </small>
                        </div>
                        <time dateTime={item.createdAt}>
                          {new Intl.DateTimeFormat('en', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(item.createdAt))}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">
                    {data
                      ? 'Your first donation starts the story. Activity will appear here.'
                      : 'Activity will appear when the database connects.'}
                  </p>
                )}
              </section>
            </aside>
          </div>
          <footer className="page-footer">
            <span>BECS · Blood Establishment Computer Software</span>
            <span>Assignment model · Unlimited storage life</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

type ScreenProps = { disabled: boolean; completed: (message: string) => Promise<void> };
function DonationScreen({ disabled, completed }: ScreenProps) {
  const [form, setForm] = useState<DonationInput>({
    bloodType: 'A+',
    donationDate: today(),
    donorId: '',
    donorFullName: '',
  });
  const action = useAction();
  const edit = (field: keyof DonationInput, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run<{ unitId: string }>('/donations', form, async () => {
      setForm((previous) => ({ ...previous, donorId: '', donorFullName: '' }));
      await completed(`Donation registered. One ${form.bloodType} unit added to inventory.`);
    });
  }
  return (
    <>
      <div className="panel-header">
        <span className="section-icon">
          <Drop size={22} />
        </span>
        <div>
          <h2>Register a donation</h2>
          <p>One donation. One unit. A new possibility.</p>
        </div>
        <span className="step-label">INTAKE / 01</span>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={action.busy || disabled}>
          <div className="form-section-title">
            <span>01</span> Donation details
          </div>
          <div className="form-grid">
            <Field label="Blood type" error={action.fields.bloodType}>
              <TypeSelect value={form.bloodType} onChange={(value) => edit('bloodType', value)} />
            </Field>
            <Field label="Donation date" error={action.fields.donationDate}>
              <input
                type="date"
                required
                max={today()}
                value={form.donationDate}
                onChange={(e) => edit('donationDate', e.target.value)}
              />
            </Field>
          </div>
          <div className="form-section-title">
            <span>02</span> Donor information
          </div>
          <Field label="Full name" error={action.fields.donorFullName}>
            <input
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              placeholder="Enter donor’s full name"
              value={form.donorFullName}
              onChange={(e) => edit('donorFullName', e.target.value)}
            />
          </Field>
          <Field label="Donor ID number" error={action.fields.donorId}>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{9}"
              maxLength={9}
              placeholder="9 digits, including leading zeros"
              value={form.donorId}
              onChange={(e) => edit('donorId', e.target.value)}
            />
          </Field>
          <div className="info-note">
            <span>i</span>
            <p>
              Each registration adds <strong>one whole-blood unit</strong> to the selected blood
              type.
            </p>
          </div>
          {action.error && (
            <div className="error-box" role="alert">
              {action.error}
            </div>
          )}
          <div className="form-footer">
            <span>All fields are required</span>
            <button className="primary-button" type="submit">
              {action.busy ? 'Registering…' : 'Register donation'} <Arrow />
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}

function RoutineScreen({ disabled, completed }: ScreenProps) {
  const [recipientType, setType] = useState<BloodType>('A+');
  const [quantity, setQuantity] = useState('1');
  const [plan, setPlan] = useState<Allocation | null>(null);
  const preview = useAction();
  const confirm = useAction();
  const busy = preview.busy || confirm.busy;
  const invalidate = () => setPlan(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPlan(null);
    await preview.run<Allocation>(
      '/dispensing/preview',
      { recipientType, quantity: Number(quantity) },
      (result) => setPlan(result),
    );
  }
  return (
    <>
      <div className="panel-header">
        <span className="section-icon">↗</span>
        <div>
          <h2>Plan a routine allocation</h2>
          <p>Review the recommendation before issuing units.</p>
        </div>
        <span className="step-label">ISSUE / 02</span>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy || disabled}>
          <div className="form-section-title">
            <span>01</span> Request details
          </div>
          <div className="form-grid">
            <Field label="Recipient blood type">
              <TypeSelect
                value={recipientType}
                onChange={(value) => {
                  setType(value);
                  invalidate();
                }}
              />
            </Field>
            <Field label="Units required" error={preview.fields.quantity}>
              <input
                type="number"
                required
                min="1"
                max="1000000"
                step="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  invalidate();
                }}
              />
            </Field>
          </div>
          {preview.error && (
            <div className="error-box" role="alert">
              {preview.error}
            </div>
          )}
          <button className="primary-button" type="submit">
            {preview.busy ? 'Planning…' : 'Preview allocation'} <Arrow />
          </button>
        </fieldset>
      </form>
      {plan && (
        <section className="allocation-preview" aria-label="Allocation recommendation">
          <div className="section-heading">
            <h3>{plan.canFulfill ? 'Recommended allocation' : 'Insufficient compatible stock'}</h3>
            <span className={`count-pill ${!plan.canFulfill ? 'shortage-pill' : ''}`}>
              {plan.canFulfill ? 'Ready to issue' : `${plan.shortfall} short`}
            </span>
          </div>
          <p>
            {plan.canFulfill
              ? 'Exact type first, then common compatible types. O− is the last alternative.'
              : `${plan.available} compatible units are available for this request of ${plan.quantity}. No units will be issued.`}
          </p>
          <div className="allocation-lines">
            {plan.lines.map((line) => (
              <div key={line.bloodType}>
                <strong>{line.bloodType}</strong>
                <span>
                  {line.bloodType === plan.recipientType ? 'Exact match' : 'Compatible alternative'}
                </span>
                <b>
                  {line.quantity} {line.quantity === 1 ? 'unit' : 'units'}
                </b>
              </div>
            ))}
          </div>
          {confirm.error && (
            <div className="error-box" role="alert">
              {confirm.error}
            </div>
          )}
          <div className="form-footer">
            <button className="secondary-button" disabled={busy} onClick={() => setPlan(null)}>
              Cancel
            </button>
            {plan.canFulfill && (
              <button
                className="primary-button"
                disabled={busy || disabled}
                onClick={() =>
                  void confirm.run<DispenseReceipt>(
                    '/dispensing/confirm',
                    {
                      recipientType: plan.recipientType,
                      quantity: plan.quantity,
                      lines: plan.lines,
                    },
                    async (result) => {
                      setPlan(null);
                      await completed(
                        `${result.quantity} units issued successfully for ${plan.recipientType}.`,
                      );
                    },
                  )
                }
              >
                {confirm.busy ? 'Issuing…' : `Confirm ${plan.quantity} units`} <Arrow />
              </button>
            )}
          </div>
        </section>
      )}
      {!plan && (
        <div className="empty-preview">
          <div className="preview-symbol">⇄</div>
          <h3>A clear plan before every release</h3>
          <p>
            Enter a request to see exact matches, compatible alternatives, and any shortfall.
            Previewing does not change inventory.
          </p>
        </div>
      )}
    </>
  );
}

function EmergencyScreen({
  disabled,
  completed,
  available,
}: ScreenProps & { available: number | null }) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  return (
    <>
      <div className="panel-header">
        <span className="section-icon emergency-icon">+</span>
        <div>
          <h2>Emergency release</h2>
          <p>Mass-casualty response · O-negative only</p>
        </div>
        <span className="step-label">RESPONSE / 03</span>
      </div>
      <div className="emergency-body">
        <div className="emergency-stock">
          <span className="emergency-type">O−</span>
          <div>
            <strong>{available ?? '—'}</strong>
            <span>units currently available</span>
          </div>
          <Drop size={70} />
        </div>
        <h3>A universal option in the assignment model</h3>
        <p>
          O-negative can serve every recipient blood type in this simulation. Emergency release
          issues all O-negative stock available when the operation runs.
        </p>
        <div className="info-note">
          <span>i</span>
          <p>
            Other blood types stay in inventory. The actual issued quantity is shown after the
            release.
          </p>
        </div>
        {available === 0 && (
          <div className="error-box" role="alert">
            No O-negative units are available. Register an O-negative donation before an emergency
            release.
          </div>
        )}
        {action.error && (
          <div className="error-box" role="alert">
            {action.error}
          </div>
        )}
        {confirming ? (
          <div className="emergency-confirm">
            <h3>Confirm emergency release</h3>
            <p>
              This will dispense all currently available O-negative units. The quantity may change
              if another operation finishes first.
            </p>
            <div className="form-footer">
              <button
                className="secondary-button"
                disabled={action.busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                disabled={action.busy || disabled}
                onClick={() =>
                  void action.run<DispenseReceipt>('/dispensing/emergency', {}, async (result) => {
                    setConfirming(false);
                    await completed(
                      `Emergency release complete. ${result.quantity} O-negative units issued.`,
                    );
                  })
                }
              >
                {action.busy ? 'Releasing…' : 'Confirm emergency release'} <Arrow />
              </button>
            </div>
          </div>
        ) : (
          <button
            className="danger-button"
            disabled={disabled || !available}
            onClick={() => setConfirming(true)}
          >
            Release all O-negative units <Arrow />
          </button>
        )}
      </div>
    </>
  );
}
