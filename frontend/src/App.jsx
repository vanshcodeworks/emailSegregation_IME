import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const sampleEmail = `MV HACKATHON STAR open Singapore 10 June 2026
DWT 56000 / Supramax / geared
Cargo: 50,000 mts coal in bulk
POL: Singapore
POD: Chennai
Laycan: 12-18 June 2026
Commission: 3.75 pct`

function numberFormat(value) {
  return new Intl.NumberFormat('en-IN').format(value || 0)
}

function confidenceClass(value) {
  return value === 'high' ? 'good' : value === 'medium' ? 'warn' : 'low'
}

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

function App() {
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [matches, setMatches] = useState([])
  const [results, setResults] = useState([])
  const [plugins, setPlugins] = useState(null)
  const [selectedType, setSelectedType] = useState('All')
  const [query, setQuery] = useState('')
  const [emailText, setEmailText] = useState(sampleEmail)
  const [parseResult, setParseResult] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const [summaryData, recordData, matchData, resultData, pluginData] = await Promise.all([
        fetchJson('/api/summary'),
        fetchJson('/api/records'),
        fetchJson('/api/matches'),
        fetchJson('/api/results'),
        fetchJson('/api/plugins'),
      ])
      setSummary(summaryData)
      setRecords(recordData)
      setMatches(matchData)
      setResults(resultData)
      setPlugins(pluginData)
    } catch (err) {
      setError(err.message)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshData(true)
  }, [refreshData])

  const filteredRecords = useMemo(() => {
    const term = query.trim().toLowerCase()
    return records.filter((record) => {
      const typeOk = selectedType === 'All' || record.record_type === selectedType
      if (!term) return typeOk
      return typeOk && JSON.stringify(record).toLowerCase().includes(term)
    })
  }, [records, selectedType, query])

  const topMatch = matches[0]
  const categoryRows = summary
    ? Object.entries(summary.categories || {}).map(([name, count]) => ({ name, count }))
    : []

  async function parseEmail() {
    setError('')
    setParseResult(null)
    setParsing(true)
    try {
      const data = await fetchJson('/api/ingest/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: 'demo-live-email.txt', body: emailText }),
      })
      setParseResult(data)
      await refreshData(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const liveRecords = parseResult?.result?.extracted_data || []
  const liveJson = parseResult
    ? JSON.stringify(parseResult.result, null, 2)
    : '{\n  "category": "Paste an email and run the parser",\n  "extracted_data": []\n}'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Hackathon submission</p>
          <h1>Shipping Email Segregation</h1>
        </div>
        <nav className="top-actions" aria-label="Exports">
          <a href="/api/export/json">JSON</a>
          <a href="/api/export/csv">CSV</a>
          <a href="/api/export/xlsx">Excel</a>
          <a href="/api/export/sqlite">SQLite</a>
        </nav>
      </header>

      {error ? <div className="notice">{error}</div> : null}

      <section className="parser-hero">
        <div className="hero-copy">
          <h2>Paste any shipping email and get structured extraction instantly.</h2>
          <p>
            The parser classifies Tonnage, Cargo VC, or Cargo TC emails, extracts commercial fields, returns pretty
            JSON, and shows best vessel-cargo opportunities without using third-party LLM APIs.
          </p>
        </div>
        <div className="hero-metrics compact-metrics" aria-label="Dataset summary">
          <Metric label="Sample emails" value={summary?.emails} />
          <Metric label="Extracted records" value={summary?.records} />
        </div>
      </section>

      <section className="judge-workbench">
        <article className="paste-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Main test area</p>
              <h3>Paste email content</h3>
            </div>
            <button type="button" onClick={parseEmail} disabled={parsing}>
              {parsing ? 'Parsing...' : 'Parse Email'}
            </button>
          </div>
          <textarea
            aria-label="Paste shipping email content"
            value={emailText}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="Paste the judge's shipping email here..."
          />
          <div className="paste-actions">
            <button type="button" onClick={() => setEmailText('')}>Clear</button>
            <button type="button" onClick={() => setEmailText(sampleEmail)}>Load sample</button>
          </div>
        </article>

        <article className="result-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Parser result</p>
              <h3>{parseResult?.result?.category || 'Waiting for email'}</h3>
            </div>
            <span className={`confidence ${confidenceClass(parseResult?.result?.confidence)}`}>
              {parseResult?.result?.confidence || 'idle'}
            </span>
          </div>

          {parseResult ? (
            <>
              <div className="result-stats">
                <Metric label="Records found" value={liveRecords.length} />
                <Metric label="Match options" value={parseResult.best_matches?.length || 0} />
              </div>
              <div className="pretty-records">
                {liveRecords.length ? liveRecords.map((record, index) => (
                  <RecordCard record={record} index={index} key={`${record.record_type}-${index}`} />
                )) : (
                  <div className="empty-state">
                    <strong>No structured record extracted</strong>
                    <span>Category was detected, but the parser marked this email for review.</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state tall">
              <strong>Paste, parse, present.</strong>
              <span>The judge can test with their own mail and see extracted fields here.</span>
            </div>
          )}
        </article>

        <article className="json-result-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pretty JSON</p>
              <h3>Structured output</h3>
            </div>
            <span className="pill">API response</span>
          </div>
          <pre>{liveJson}</pre>
        </article>
      </section>

      {parseResult?.best_matches?.length ? (
        <section className="match-strip">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Best matches from current + sample data</p>
              <h3>Business opportunities</h3>
            </div>
          </div>
          <div className="match-cards">
            {parseResult.best_matches.slice(0, 4).map((match, index) => (
              <div className="opportunity-card" key={`${match.vessel_name}-${index}`}>
                <strong>{match.vessel_name}</strong>
                <span>{match.vessel_port || '-'} to {match.load_port || '-'}</span>
                <em>{Math.round(match.match_score)} match score</em>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboard-grid support-grid">
        <article className="panel pipeline-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Extraction pipeline</p>
              <h3>Inbox intelligence</h3>
            </div>
            <span className="pill">{loading ? 'Loading' : 'Ready'}</span>
          </div>
          <div className="pipeline">
            {['Email listener', 'Classifier', 'Field extraction', 'JSON records', 'Best match'].map((item, index) => (
              <div className="pipeline-step" key={item}>
                <span>{index + 1}</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
          <div className="category-stack">
            {categoryRows.map((row) => (
              <div className="category-row" key={row.name}>
                <span>{row.name}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel match-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Best opportunity</p>
              <h3>{topMatch?.vessel_name || 'No match yet'}</h3>
            </div>
            <span className="score">{topMatch ? Math.round(topMatch.match_score) : 0}</span>
          </div>
          {topMatch ? (
            <>
              <dl className="match-details">
                <div>
                  <dt>Open port</dt>
                  <dd>{topMatch.vessel_port || '-'}</dd>
                </div>
                <div>
                  <dt>Cargo</dt>
                  <dd>{topMatch.cargo_name || topMatch.cargo_type}</dd>
                </div>
                <div>
                  <dt>Load / delivery</dt>
                  <dd>{topMatch.load_port || '-'}</dd>
                </div>
                <div>
                  <dt>Laycan</dt>
                  <dd>{topMatch.laycan || '-'}</dd>
                </div>
              </dl>
              <div className="reason-list">
                {topMatch.match_reasons?.map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Matches appear when compatible tonnage and cargo records are available.</p>
          )}
        </article>

        <article className="panel plugin-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Plugin layer</p>
              <h3>Direct email listening</h3>
            </div>
            <span className="pill">Webhook ready</span>
          </div>
          <div className="plugin-list">
            {(plugins?.plugins || []).map((plugin) => (
              <div className="plugin-row" key={plugin.id}>
                <div>
                  <strong>{plugin.name}</strong>
                  <span>{plugin.target}</span>
                </div>
                <em>{plugin.status}</em>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="workbench">
        <div className="table-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Records</p>
              <h3>Extracted JSON dataset</h3>
              <h6>These are given samples in drive</h6>
            </div>
            <div className="filters">
              {['All', 'Tonnage', 'Cargo VC', 'Cargo TC'].map((type) => (
                <button
                  className={selectedType === type ? 'active' : ''}
                  key={type}
                  onClick={() => setSelectedType(type)}
                  type="button"
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <input
            aria-label="Search records"
            className="search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vessel, port, cargo, account..."
            value={query}
          />
          <div className="records-table">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Primary</th>
                  <th>Port</th>
                  <th>Laycan / Date</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.slice(0, 28).map((record, index) => (
                  <tr key={`${record.record_id || record.email_hash}-${index}`}>
                    <td>{record.record_type || record.category}</td>
                    <td>{record.vessel_name || record.cargo_name || record.file_name}</td>
                    <td>{record.open_port || record.loading_port || record.delivery_port || '-'}</td>
                    <td>{record.open_date || record.laycan || '-'}</td>
                    <td>
                      <span className={`confidence ${confidenceClass(record.confidence)}`}>
                        {record.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="side-stack">
          <article className="panel json-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Raw output</p>
                <h3>JSON preview</h3>
              </div>
              <span className="pill">{results.length} files</span>
            </div>
            <pre>{JSON.stringify(results.slice(0, 2), null, 2)}</pre>
          </article>
        </aside>
      </section>
    </main>
  )
}

function RecordCard({ record, index }) {
  const title = record.vessel_name || record.cargo_name || `Record ${index + 1}`
  const fields = Object.entries(record).filter(([, value]) => value !== null && value !== '' && value !== undefined)

  return (
    <div className="record-card">
      <div className="record-card-title">
        <span>{record.record_type || `Record ${index + 1}`}</span>
        <strong>{title}</strong>
      </div>
      <dl>
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll('_', ' ')}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{numberFormat(value)}</strong>
      <span>{label}</span>
    </div>
  )
}

export default App
