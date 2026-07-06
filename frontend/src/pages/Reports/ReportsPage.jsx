import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { getAdmissionsReport, getReferralsReport, getTurnaroundReport } from '../../api/reports.api';
import { formatDate } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Card from '../../components/ui/Card';
import './ReportsPage.css';

// ─── Register Chart.js components (tree-shaken — only what we use) ────────────
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// ─── Design-system colour palette (matches dark theme) ────────────────────────
const PRIMARY   = '#10b981';   // emerald
const SURFACE   = '#1e293b';
const BORDER    = '#334155';
const TEXT_MUTED = '#94a3b8';

const STATUS_PALETTE = {
  Pending:   '#f59e0b',  // amber
  Accepted:  '#3b82f6',  // blue
  Completed: '#10b981',  // emerald
  Cancelled: '#64748b',  // slate
};

const BAR_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#f97316', '#84cc16',
];

// ─── Shared Chart.js option defaults ──────────────────────────────────────────
const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: TEXT_MUTED,
        font: { family: "'Inter', sans-serif", size: 12 },
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: SURFACE,
      borderColor: BORDER,
      borderWidth: 1,
      titleColor: '#f1f5f9',
      bodyColor: TEXT_MUTED,
      padding: 12,
      cornerRadius: 8,
    },
  },
};

const barAxisOptions = {
  ...baseOptions,
  scales: {
    x: {
      ticks: { color: TEXT_MUTED, font: { size: 11 } },
      grid:  { color: 'rgba(51,65,85,0.5)' },
    },
    y: {
      beginAtZero: true,
      ticks: { color: TEXT_MUTED, precision: 0, font: { size: 11 } },
      grid:  { color: 'rgba(51,65,85,0.5)' },
    },
  },
};

// ─── Data helpers ──────────────────────────────────────────────────────────────

/** Group admissions by date, return Chart.js dataset */
const buildAdmissionsChartData = (rows) => {
  const counts = {};
  rows.forEach((r) => {
    const day = r.admission_date
      ? new Date(r.admission_date).toLocaleDateString('en-PH', { month:'short', day:'numeric' })
      : 'Unknown';
    counts[day] = (counts[day] || 0) + 1;
  });
  const labels = Object.keys(counts);
  return {
    labels,
    datasets: [{
      label: 'Admissions',
      data: labels.map((l) => counts[l]),
      backgroundColor: labels.map((_, i) => BAR_COLORS[i % BAR_COLORS.length] + 'cc'),
      borderColor:     labels.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
      borderWidth: 1,
      borderRadius: 6,
      barThickness: 'flex',
      maxBarThickness: 52,
    }],
  };
};

/** Count referrals by status, return Chart.js doughnut dataset */
const buildReferralsChartData = (rows) => {
  const counts = { Pending: 0, Accepted: 0, Completed: 0, Cancelled: 0 };
  rows.forEach((r) => { if (r.status in counts) counts[r.status]++; });
  const labels = Object.keys(counts).filter((k) => counts[k] > 0);
  return {
    labels,
    datasets: [{
      data:            labels.map((l) => counts[l]),
      backgroundColor: labels.map((l) => STATUS_PALETTE[l] + 'cc'),
      borderColor:     labels.map((l) => STATUS_PALETTE[l]),
      borderWidth: 2,
      hoverOffset: 10,
    }],
  };
};

/** One bar per patient showing turnaround minutes */
const buildTurnaroundChartData = (rows) => {
  const labels = rows.map((r) => r.patient_name || 'Unknown');
  return {
    labels,
    datasets: [{
      label: 'Triage-to-Admission Time (min)',
      data:            rows.map((r) => r.turnaround_minutes ?? 0),
      backgroundColor: rows.map((r) => {
        const m = r.turnaround_minutes ?? 0;
        if (m <= 30)  return '#10b981cc';  // fast → emerald
        if (m <= 120) return '#f59e0bcc';  // medium → amber
        return '#ef4444cc';                 // slow → red
      }),
      borderColor: rows.map((r) => {
        const m = r.turnaround_minutes ?? 0;
        if (m <= 30)  return '#10b981';
        if (m <= 120) return '#f59e0b';
        return '#ef4444';
      }),
      borderWidth: 1,
      borderRadius: 6,
      maxBarThickness: 48,
    }],
  };
};

// ─── Column definitions ────────────────────────────────────────────────────────
const admColumns = [
  { key:'patient_name',   label:'Patient'   },
  { key:'doctor_name',    label:'Doctor'    },
  { key:'room_type',      label:'Room Type' },
  { key:'bed_number',     label:'Bed'       },
  { key:'admission_type', label:'Type'      },
  { key:'admission_date', label:'Admitted',  render:(r)=>formatDate(r.admission_date)  },
  { key:'discharge_date', label:'Discharged',render:(r)=>formatDate(r.discharge_date) },
  { key:'status',         label:'Status',   render:(r)=><Badge status={r.status} />   },
];

const refColumns = [
  { key:'patient_name',         label:'Patient'    },
  { key:'medical_condition',    label:'Condition'  },
  { key:'assigned_doctor_name', label:'Assigned To'},
  { key:'specialization',       label:'Specialty'  },
  { key:'referral_date',        label:'Date',      render:(r)=>formatDate(r.referral_date) },
  { key:'status',               label:'Status',    render:(r)=><Badge status={r.status} /> },
];

const turnaColumns = [
  { key:'patient_name',       label:'Patient'           },
  { key:'triage_level',       label:'Level',            render:(r)=><Badge status={r.triage_level} /> },
  { key:'triage_datetime',    label:'Triaged',          render:(r)=>formatDate(r.triage_datetime, true) },
  { key:'admission_date',     label:'Admitted',         render:(r)=>formatDate(r.admission_date,  true) },
  { key:'turnaround_minutes', label:'Time (min)', align:'right' },
];

// ─── CSV export helpers ────────────────────────────────────────────────────────
const csvEscape = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (columns, rows) => {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  return [header, ...lines].join('\n');
};

const TAB_FILE_PREFIX = {
  Admissions: 'admissions',
  Referrals:  'referrals',
  Turnaround: 'triage-to-admission',
};

// ─── Main Component ────────────────────────────────────────────────────────────
const TABS = ['Admissions', 'Referrals', 'Turnaround'];

const ReportsPage = () => {
  const [tab,          setTab]          = useState('Admissions');
  const [data,         setData]         = useState([]);
  const [meta,         setMeta]         = useState({});
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [from,         setFrom]         = useState('');
  const [to,           setTo]           = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Computed chart data — re-derives whenever `data` or `tab` changes
  const admChart   = tab === 'Admissions' && data.length ? buildAdmissionsChartData(data) : null;
  const refChart   = tab === 'Referrals'  && data.length ? buildReferralsChartData(data)  : null;
  const turnaChart = tab === 'Turnaround' && data.length ? buildTurnaroundChartData(data) : null;

  const run = async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (tab === 'Referrals' && statusFilter) params.status = statusFilter;

      let res;
      if (tab === 'Admissions')     res = await getAdmissionsReport(params);
      else if (tab === 'Referrals') res = await getReferralsReport(params);
      else                          res = await getTurnaroundReport(params);

      if (res.success) {
        setData(res.data);
        setMeta({ total: res.total, average: res.average_turnaround_minutes });
      }
    } catch { setError('Failed to generate report.'); }
    finally  { setLoading(false); }
  };

  const columns = tab === 'Admissions' ? admColumns
                : tab === 'Referrals'  ? refColumns
                : turnaColumns;

  const downloadCsv = () => {
    if (!data.length) return;
    const csvContent = toCsv(columns, data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().split('T')[0];

    const link = document.createElement('a');
    link.href = url;
    link.download = `${TAB_FILE_PREFIX[tab]}-report-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Chart option helpers with title ───────────────────────────────
  const admChartOptions = {
    ...barAxisOptions,
    plugins: {
      ...barAxisOptions.plugins,
      legend: { display: false },
      title:  { display: false },
    },
  };

  const refChartOptions = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      legend: {
        position: 'right',
        labels: {
          color: TEXT_MUTED,
          font: { family: "'Inter', sans-serif", size: 13 },
          padding: 20,
          usePointStyle: true,
          pointStyleWidth: 14,
        },
      },
    },
  };

  const turnaChartOptions = {
    ...barAxisOptions,
    plugins: {
      ...barAxisOptions.plugins,
      legend: { display: false },
      tooltip: {
        ...barAxisOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => ` ${ctx.parsed.y} min`,
        },
      },
    },
    scales: {
      ...barAxisOptions.scales,
      y: {
        ...barAxisOptions.scales.y,
        title: {
          display: true,
          text: 'Minutes',
          color: TEXT_MUTED,
          font: { size: 11 },
        },
      },
    },
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>
      <div className="page-header">
        <div><h2 className="page-title">Reports &amp; Analytics</h2></div>
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`detail-tab${tab === t ? ' detail-tab--active' : ''}`}
            onClick={() => { setTab(t); setData([]); setMeta({}); }}
          >
            {t === 'Turnaround' ? 'Triage-to-Admission Time' : t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card title="Filters">
        <div style={{ display:'flex', flexWrap:'wrap', gap:'var(--space-4)', alignItems:'flex-end' }}>
          <div className="form-group" style={{ minWidth:'160px' }}>
            <label htmlFor="rep-from">From Date</label>
            <input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ minWidth:'160px' }}>
            <label htmlFor="rep-to">To Date</label>
            <input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {tab === 'Referrals' && (
            <div className="form-group" style={{ minWidth:'160px' }}>
              <label htmlFor="rep-status">Status</label>
              <select id="rep-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                {['Pending','Accepted','Completed','Cancelled'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <Button id="run-report-btn" variant="primary" onClick={run} loading={loading}>
            Generate Report
          </Button>
          {data.length > 0 && (
            <Button id="download-csv-btn" variant="secondary" onClick={downloadCsv}>
              Download CSV
            </Button>
          )}
        </div>
      </Card>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      {/* ── ADMISSIONS CHART ── */}
      {tab === 'Admissions' && admChart && (
        <div className="report-chart-panel">
          <p className="report-chart-panel__title">Admissions per Day</p>
          <div className="report-chart-panel__canvas-wrap">
            <Bar data={admChart} options={admChartOptions} />
          </div>
        </div>
      )}

      {/* ── REFERRALS CHART ── */}
      {tab === 'Referrals' && refChart && (
        <div className="report-chart-panel">
          <p className="report-chart-panel__title">Referral Status Breakdown</p>
          <div className="report-chart-panel__canvas-wrap report-chart-panel__canvas-wrap--doughnut">
            <Doughnut data={refChart} options={refChartOptions} />
          </div>
        </div>
      )}

      {/* ── TURNAROUND CHART ── */}
      {tab === 'Turnaround' && turnaChart && (
        <>
          {/* Average summary card */}
          {meta.average != null && (
            <div className="report-summary-card">
              <span className="report-summary-card__icon">⏱️</span>
              <div>
                <span className="report-summary-card__value">{meta.average} min</span>
                <span className="report-summary-card__label">Average Triage-to-Admission Time</span>
              </div>
            </div>
          )}
          <div className="report-chart-panel">
            <p className="report-chart-panel__title">
              Triage-to-Admission Time per Patient
              <span style={{ fontWeight:400, marginLeft:'var(--space-3)', fontSize:'var(--font-size-xs)' }}>
                <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#10b981', verticalAlign:'middle' }} /> ≤30 min &nbsp;
                <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#f59e0b', verticalAlign:'middle' }} /> ≤120 min &nbsp;
                <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#ef4444', verticalAlign:'middle' }} /> &gt;120 min
              </span>
            </p>
            <p style={{ fontSize:'var(--font-size-sm)', color:'var(--color-text-muted)', marginBottom:'var(--space-3)' }}>
              Measures how long each patient took from triage to admission — lower is better.
            </p>
            <div className="report-chart-panel__canvas-wrap">
              <Bar data={turnaChart} options={turnaChartOptions} />
            </div>
          </div>
        </>
      )}

      {/* ── DATA TABLE ── */}
      {data.length > 0 && (
        <div>
          <p className="text-muted text-sm" style={{ marginBottom:'var(--space-3)' }}>
            {meta.total} record{meta.total !== 1 ? 's' : ''} found
          </p>
          <Table
            columns={columns}
            data={data}
            loading={loading}
            emptyMessage="No records for selected filters."
          />
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
