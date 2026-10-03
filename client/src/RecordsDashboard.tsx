import { Fragment, useEffect, useState, type FormEvent } from 'react';
import type {
  RecordDataset,
  RecordFilters,
  RecordsResponse,
  StoredRecord,
} from '../../shared/apiTypes.js';
import { api } from './api.js';
import './records.css';

const collections: Record<RecordDataset, { label: string; description: string; id: string }> = {
  auditLogs: {
    label: 'Audit logs',
    description: 'A chronological history of actions, outcomes, and record access.',
    id: 'id',
  },
  bloodUnits: {
    label: 'Blood donations',
    description: 'All donated units, including available and dispensed stock.',
    id: 'unit_id',
  },
  dispenseEvents: {
    label: 'Dispensing events',
    description: 'Routine allocations and emergency releases.',
    id: 'event_id',
  },
  dispenseEventUnits: {
    label: 'Issued units',
    description: 'The blood units linked to each dispensing event.',
    id: 'unit_id',
  },
  operationRequests: {
    label: 'Request receipts',
    description: 'Saved operation receipts used to prevent duplicate stock changes.',
    id: 'request_key',
  },
};
const emptyDraft = { search: '', from: '', to: '', action: '', outcome: '' };
const readable = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
const valueText = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
function recordTitle(record: StoredRecord, dataset: RecordDataset) {
  if (dataset === 'auditLogs') return readable(record.action);
  if (dataset === 'bloodUnits') return `${valueText(record.blood_type)} donation`;
  if (dataset === 'dispenseEvents') return `${readable(record.mode)} dispensing`;
  if (dataset === 'dispenseEventUnits') return 'Issued blood unit';
  return 'Operation receipt';
}
function recordSubtitle(record: StoredRecord, dataset: RecordDataset) {
  if (dataset === 'auditLogs')
    return valueText(
      (record.context as Record<string, unknown> | undefined)?.path ?? record.source,
    );
  if (dataset === 'bloodUnits') return valueText(record.donor_full_name);
  if (dataset === 'dispenseEvents')
    return `${valueText(record.recipient_blood_type ?? 'O-')} · ${valueText(record.requested_quantity ?? 'All available')} units`;
  if (dataset === 'dispenseEventUnits') return `Event ${valueText(record.event_id)}`;
  return 'Original response retained';
}

export function RecordsDashboard() {
  const [query, setQuery] = useState<RecordFilters & { page: number }>({
    dataset: 'auditLogs',
    page: 1,
  });
  const [draft, setDraft] = useState(emptyDraft);
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [notice, setNotice] = useState('');
  const collection = collections[query.dataset];
  const isAudit = query.dataset === 'auditLogs';
  const idOf = (record: StoredRecord) => String(record[collection.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
    params.set('pageSize', '20');
    void api<RecordsResponse>(`/records?${params}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load records.');
          setData(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  function changeQuery(next: typeof query, clearSelection = true) {
    setData(null);
    setLoading(true);
    setExpanded(null);
    setQuery(next);
    if (clearSelection) setSelected(new Set());
    setNotice('');
    setExportError('');
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const filters: RecordFilters = { dataset: query.dataset };
    if (draft.search.trim()) filters.search = draft.search.trim();
    if (draft.from) filters.from = draft.from;
    if (draft.to) filters.to = draft.to;
    if (isAudit && draft.action) filters.action = draft.action;
    if (isAudit && draft.outcome) filters.outcome = draft.outcome as RecordFilters['outcome'];
    changeQuery({ ...filters, page: 1 });
  }
  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 200) next.add(id);
      return next;
    });
  }
  const pageIds = data?.records.map(idOf) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const canSelectPage = selected.size + pageIds.filter((id) => !selected.has(id)).length <= 200;
  function togglePage() {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else if (next.size < 200) next.add(id);
      }
      return next;
    });
  }
  async function download(scope: 'selected' | 'filtered' | 'full') {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    setNotice('');
    try {
      const { page: _page, ...filters } = query;
      const response = await fetch(
        scope === 'full' ? '/api/export' : '/api/records/export',
        scope === 'full'
          ? undefined
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filters: { ...filters, snapshotAt: data?.snapshotAt },
                ...(scope === 'selected' ? { ids: [...selected] } : {}),
              }),
            },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? 'Export failed. Please try again.');
      }
      const text = await response.text();
      const count = (JSON.parse(text) as { recordCount?: number }).recordCount ?? 0;
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        scope === 'full' ? 'bloodbank_export.json' : `bloodbank_${query.dataset}_${scope}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        scope === 'full'
          ? 'Complete records downloaded as formatted JSON.'
          : `Downloaded ${count} ${scope === 'selected' ? 'selected' : 'matching'} ${count === 1 ? 'record' : 'records'} as formatted JSON.`,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }
  const hasFilters = Boolean(
    query.search || query.from || query.to || query.action || query.outcome,
  );
  return (
    <section className="records-dashboard" aria-label="Audit and records dashboard">
      <div className="records-summary">
        <div>
          <span className="eyebrow">MATCHING RECORDS</span>
          <strong>{loading ? '—' : (data?.total ?? 0).toLocaleString()}</strong>
          <small>
            {hasFilters ? 'With your applied filters' : `In ${collection.label.toLowerCase()}`}
          </small>
        </div>
        <div>
          <span className="eyebrow">YOUR SELECTION</span>
          <strong>
            {selected.size}
            <span> / 200</span>
          </strong>
          <small>Choose rows across multiple pages</small>
        </div>
        <div className="records-protection">
          <span className="eyebrow">HISTORY PROTECTED</span>
          <strong>Read. Review. Export.</strong>
          <small>Audit entries cannot be edited or deleted.</small>
        </div>
      </div>
      <section className="panel records-panel">
        <div className="records-heading">
          <div>
            <h2>Record explorer</h2>
            <p>{collection.description}</p>
          </div>
          <button
            className="secondary-button"
            disabled={loading || exporting}
            onClick={() => {
              const { snapshotAt: _snapshot, ...rest } = query;
              changeQuery({ ...rest, page: 1 });
            }}
          >
            ↻ Refresh records
          </button>
        </div>
        <form className="record-filters" onSubmit={apply}>
          <label className="record-collection">
            Record collection
            <select
              value={query.dataset}
              disabled={exporting}
              onChange={(event) => {
                setDraft(emptyDraft);
                changeQuery({ dataset: event.target.value as RecordDataset, page: 1 });
              }}
            >
              {Object.entries(collections).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="record-search">
            Search records
            <input
              type="search"
              placeholder="Search an ID, donor, action, or detail…"
              maxLength={200}
              value={draft.search}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
            />
          </label>
          <label>
            From date
            <input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label>
            Through date
            <input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          {isAudit && (
            <>
              <label>
                Action
                <select
                  value={draft.action}
                  onChange={(event) => setDraft({ ...draft, action: event.target.value })}
                >
                  <option value="">All actions</option>
                  {[
                    ...new Set([...(data?.actions ?? []), ...(draft.action ? [draft.action] : [])]),
                  ].map((action) => (
                    <option key={action} value={action}>
                      {readable(action)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Outcome
                <select
                  value={draft.outcome}
                  onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}
                >
                  <option value="">All outcomes</option>
                  <option value="SUCCESS">Success</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="ERROR">Error</option>
                </select>
              </label>
            </>
          )}
          <div className="filter-actions">
            <button className="primary-button" type="submit" disabled={loading || exporting}>
              Apply filters
            </button>
            <button
              type="button"
              className="text-button"
              disabled={exporting}
              onClick={() => {
                setDraft(emptyDraft);
                changeQuery({ dataset: query.dataset, page: 1 });
              }}
            >
              Reset
            </button>
          </div>
        </form>
        <p className="records-help">
          Dates refer to when records were created, in Jerusalem time. Apply filters to update the
          results. Refresh to include new activity.
        </p>
        <div className="export-toolbar">
          <div>
            <strong>{selected.size ? `${selected.size} selected` : 'Choose your export'}</strong>
            <span>Readable JSON with indentation and line breaks</span>
            {selected.size > 0 && (
              <button
                className="text-button"
                disabled={exporting}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            )}
          </div>
          <div className="export-actions">
            <button
              className="primary-button"
              disabled={!selected.size || loading || exporting}
              onClick={() => void download('selected')}
            >
              ↓ Export selected ({selected.size})
            </button>
            <button
              className="secondary-button"
              disabled={!data?.total || loading || exporting}
              onClick={() => void download('filtered')}
            >
              Export all matches
            </button>
            <button
              className="text-button"
              disabled={exporting}
              onClick={() => void download('full')}
            >
              Download full database
            </button>
          </div>
        </div>
        {exporting && (
          <p className="records-message" role="status">
            Preparing your download…
          </p>
        )}
        {notice && (
          <p className="records-message success" role="status">
            ✓ {notice}
          </p>
        )}
        {(error || exportError) && (
          <div className="error-box" role="alert">
            {error || exportError}
          </div>
        )}
        {loading ? (
          <div className="records-empty" role="status">
            Loading records…
          </div>
        ) : !data?.records.length ? (
          <div className="records-empty">
            <h3>{error ? 'Records unavailable' : 'No matching records'}</h3>
            <p>
              {error
                ? 'Use Refresh records to try again.'
                : 'Try a different collection, search, or date range.'}
            </p>
          </div>
        ) : (
          <div className="record-table-scroll">
            <table className="record-table">
              <caption className="visually-hidden">
                {collection.label} matching the applied filters
              </caption>
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all records on this page"
                      checked={allOnPage}
                      ref={(element) => {
                        if (element) element.indeterminate = someOnPage && !allOnPage;
                      }}
                      disabled={exporting || (!allOnPage && !canSelectPage)}
                      onChange={togglePage}
                    />
                  </th>
                  <th>Record</th>
                  <th>Created · Jerusalem</th>
                  <th>
                    {isAudit ? 'Outcome' : query.dataset === 'bloodUnits' ? 'Status' : 'Reference'}
                  </th>
                  <th>
                    <span className="visually-hidden">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((record) => {
                  const id = idOf(record);
                  const date = record.created_at ?? record.issued_at;
                  const outcome = record.outcome ?? record.status;
                  return (
                    <Fragment key={id}>
                      <tr className={selected.has(id) ? 'record-selected' : ''}>
                        <td className="checkbox-cell">
                          <input
                            type="checkbox"
                            aria-label={`Select record ${id}`}
                            checked={selected.has(id)}
                            disabled={exporting || (!selected.has(id) && selected.size >= 200)}
                            onChange={() => toggle(id)}
                          />
                        </td>
                        <td>
                          <strong>{recordTitle(record, query.dataset)}</strong>
                          <span className="record-subtitle">
                            {recordSubtitle(record, query.dataset)}
                          </span>
                          <code title={id}>{id.slice(0, 8)}…</code>
                        </td>
                        <td className="record-date">
                          {date ? (
                            <time dateTime={String(date)}>
                              {new Intl.DateTimeFormat('en-GB', {
                                timeZone: 'Asia/Jerusalem',
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              }).format(new Date(String(date)))}
                            </time>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {outcome ? (
                            <span className={`record-badge ${String(outcome).toLowerCase()}`}>
                              {readable(outcome)}
                            </span>
                          ) : (
                            <code>{id.slice(0, 8)}</code>
                          )}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            aria-expanded={expanded === id}
                            aria-label={`${expanded === id ? 'Hide' : 'View'} details for ${id}`}
                            onClick={() => setExpanded(expanded === id ? null : id)}
                          >
                            {expanded === id ? 'Close' : 'Details'} {expanded === id ? '−' : '+'}
                          </button>
                        </td>
                      </tr>
                      {expanded === id && (
                        <tr className="record-detail-row">
                          <td colSpan={5}>
                            <div className="record-detail-heading">
                              <strong>Complete record</strong>
                              <span>{id}</span>
                            </div>
                            <pre>{JSON.stringify(record, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="records-pagination">
          <span>
            {data?.total
              ? `${(query.page - 1) * 20 + 1}–${Math.min(query.page * 20, data.total)} of ${data.total.toLocaleString()} records`
              : '0 records'}
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={loading || exporting || query.page <= 1}
              onClick={() =>
                changeQuery({ ...query, snapshotAt: data?.snapshotAt, page: query.page - 1 }, false)
              }
            >
              Previous
            </button>
            <span>Page {query.page}</span>
            <button
              className="secondary-button"
              disabled={loading || exporting || !data || query.page * 20 >= data.total}
              onClick={() =>
                changeQuery({ ...query, snapshotAt: data?.snapshotAt, page: query.page + 1 }, false)
              }
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
