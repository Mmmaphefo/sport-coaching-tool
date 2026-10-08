import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import './TacticsBoard.css'

const ELEMENT_TYPES = {
  X: { label: 'X', color: '#1a1a1a', shape: 'text' },
  O: { label: 'O', color: '#1a1a1a', shape: 'text' },
  cone: { label: 'Cone', color: '#ff6b35', shape: 'triangle' },
  ball: { label: 'Ball', color: '#ffffff', shape: 'circle' },
}

function TacticsBoard() {
  const { getToken } = useAuth()
  const [tactics, setTactics] = useState([])
  const [currentTactic, setCurrentTactic] = useState(null)
  const [elements, setElements] = useState([])
  const [arrows, setArrows] = useState([])
  const [selectedElement, setSelectedElement] = useState(null)
  const [selectedArrow, setSelectedArrow] = useState(null)
  const [activeTool, setActiveTool] = useState('X')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [tacticName, setTacticName] = useState('')
  const [tacticDescription, setTacticDescription] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [arrowStart, setArrowStart] = useState(null)
  const [arrowEnd, setArrowEnd] = useState(null)
  const [isDrawingArrow, setIsDrawingArrow] = useState(false)
  const [role, setRole] = useState(null)
  const svgRef = useRef(null)

  useEffect(() => {
    loadTactics()
    apiRequest('/api/account/me', { getToken })
      .then((me) => setRole(me.role))
      .catch(() => {})
  }, [getToken])

  const isAthlete = role === 'athlete'

  async function loadTactics() {
    try {
      const list = await apiRequest('/api/tactics', { getToken })
      setTactics(list)
    } catch (err) {
      console.error('Failed to load tactics:', err)
    }
  }

  function getSvgPoint(e) {
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) }
  }

  function handleSvgClick(e) {
    if (e.target.tagName !== 'svg' && !e.target.classList.contains('pitch-bg')) return
    
    if (activeTool === 'arrow') {
      const point = getSvgPoint(e)
      if (!isDrawingArrow) {
        setArrowStart(point)
        setArrowEnd(point)
        setIsDrawingArrow(true)
      } else {
        setArrows([...arrows, { id: Date.now(), x1: arrowStart.x, y1: arrowStart.y, x2: point.x, y2: point.y }])
        setArrowStart(null)
        setArrowEnd(null)
        setIsDrawingArrow(false)
      }
      return
    }

    const point = getSvgPoint(e)
    const newElement = {
      id: Date.now(),
      type: activeTool,
      x: point.x,
      y: point.y,
    }
    setElements([...elements, newElement])
  }

  function handleArrowMove(e) {
    if (!isDrawingArrow) return
    const point = getSvgPoint(e)
    setArrowEnd(point)
  }

  function handleElementDrag(id, e) {
    e.preventDefault()
    e.stopPropagation()
    const svg = svgRef.current
    const rect = svg.getBoundingClientRect()

    const move = (ev) => {
      const x = ((ev.clientX - rect.left) / rect.width) * 100
      const y = ((ev.clientY - rect.top) / rect.height) * 100
      setElements(els => els.map(el =>
        el.id === id ? { ...el, x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) } : el
      ))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function deleteSelected() {
    if (selectedElement) {
      setElements(elements.filter(el => el.id !== selectedElement))
      setSelectedElement(null)
    }
    if (selectedArrow) {
      setArrows(arrows.filter(a => a.id !== selectedArrow))
      setSelectedArrow(null)
    }
  }

  function clearBoard() {
    setElements([])
    setArrows([])
    setSelectedElement(null)
    setSelectedArrow(null)
    setArrowStart(null)
    setArrowEnd(null)
    setIsDrawingArrow(false)
  }

  async function saveTactic() {
    if (!tacticName.trim() || saving) return
    setSaveError('')
    setSaving(true)
    try {
      const payload = {
        name: tacticName.trim(),
        description: tacticDescription.trim() || null,
        frames: [{ id: Date.now(), elements, arrows }],
      }
      if (currentTactic) {
        await apiRequest(`/api/tactics/${currentTactic.id}`, { getToken, method: 'PATCH', body: payload })
      } else {
        await apiRequest('/api/tactics', { getToken, method: 'POST', body: payload })
      }
      setShowSaveDialog(false)
      setTacticName('')
      setTacticDescription('')
      await loadTactics()
    } catch (err) {
      console.error('Failed to save tactic:', err)
      setSaveError(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function loadTactic(tactic) {
    setCurrentTactic(tactic)
    const frames = tactic.frames || []
    if (frames.length > 0) {
      setElements(JSON.parse(JSON.stringify(frames[0].elements || [])))
      setArrows(JSON.parse(JSON.stringify(frames[0].arrows || [])))
    } else {
      setElements([])
      setArrows([])
    }
    setSelectedElement(null)
  }

  async function deleteTactic(id) {
    if (!confirm('Delete this tactic?')) return
    try {
      await apiRequest(`/api/tactics/${id}`, { getToken, method: 'DELETE' })
      if (currentTactic?.id === id) {
        setCurrentTactic(null)
        setElements([])
        setArrows([])
      }
      await loadTactics()
    } catch (err) {
      console.error('Failed to delete tactic:', err)
    }
  }

  return (
    <Layout>
      <div className="tactics-page">
        <header className="tactics-head">
          <div>
            <h1 className="tactics-title">Tactical Board</h1>
          </div>
          {!isAthlete && (
            <div className="tactics-actions">
              <button className="btn btn-ghost" onClick={clearBoard}>Clear</button>
              <button className="btn btn-gold" onClick={() => setShowSaveDialog(true)}>
                {currentTactic ? 'Update' : 'Save'} Routine
              </button>
            </div>
          )}
        </header>

        <div className="tactics-layout">
          <aside className="tactics-sidebar">
          {!isAthlete && (
            <div className="tactics-tools">
              <h3>Tools</h3>
              {Object.entries(ELEMENT_TYPES).map(([key, cfg]) => (
                <button
                  key={key}
                  className={`tactics-tool${activeTool === key ? ' active' : ''}`}
                  onClick={() => setActiveTool(key)}
                >
                  <span className="tactics-tool-icon" style={{ color: cfg.color }}>
                    {cfg.shape === 'triangle' ? '▲' : cfg.shape === 'circle' ? '●' : cfg.label}
                  </span>
                  {cfg.label}
                </button>
              ))}
              <button
                className={`tactics-tool${activeTool === 'arrow' ? ' active' : ''}`}
                onClick={() => { setActiveTool('arrow'); setIsDrawingArrow(false) }}
              >
                <span className="tactics-tool-icon">→</span>
                Arrow
              </button>
              {isDrawingArrow && (
                <p className="tactics-hint">Click start point, then click end point</p>
              )}
            </div>
          )}

            <div className="tactics-saved">
              <h3>Saved Routines</h3>
              {tactics.length === 0 ? (
                <p className="tactics-empty">No saved routines yet</p>
              ) : (
                tactics.map(t => (
                  <div key={t.id} className={`tactics-saved-item${currentTactic?.id === t.id ? ' active' : ''}`}>
                    <button onClick={() => loadTactic(t)}>{t.name}</button>
                    {!isAthlete && <button className="tactics-delete" onClick={() => deleteTactic(t.id)}>×</button>}
                  </div>
                ))
              )}
            </div>

            <div className="tactics-help">
              <h3>How to use</h3>
              <ul>
                <li>Select a tool, click pitch to place</li>
                <li>Drag elements to reposition</li>
                <li>Arrow: click start, click end</li>
                <li>Save to reuse later</li>
              </ul>
            </div>
          </aside>

          <div className="tactics-board">
            <svg
              ref={svgRef}
              className="tactics-svg"
              viewBox="0 0 100 100"
              onClick={handleSvgClick}
              onPointerMove={handleArrowMove}
            >
              <defs>
                <marker id="arrowhead" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto">
                  <polygon points="0 0, 3 1.5, 0 3" fill="#ffd700" />
                </marker>
              </defs>

              {/* Pitch background */}
              <rect className="pitch-bg" x="0" y="0" width="100" height="100" fill="#2d8a4e" />
              <rect x="2" y="2" width="96" height="96" fill="none" stroke="#fff" strokeWidth="0.5" />
              <line x1="2" y1="50" x2="98" y2="50" stroke="#fff" strokeWidth="0.3" />
              <circle cx="50" cy="50" r="10" fill="none" stroke="#fff" strokeWidth="0.3" />

              {/* Arrows */}
              {arrows.map(arrow => (
                <line
                  key={arrow.id}
                  x1={arrow.x1} y1={arrow.y1}
                  x2={arrow.x2} y2={arrow.y2}
                  stroke={selectedArrow === arrow.id ? '#ff6b35' : '#ffd700'}
                  strokeWidth={selectedArrow === arrow.id ? '0.8' : '0.5'}
                  markerEnd="url(#arrowhead)"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedArrow(arrow.id)
                    setSelectedElement(null)
                  }}
                />
              ))}

              {/* Arrow being drawn */}
              {isDrawingArrow && arrowStart && arrowEnd && (
                <line
                  x1={arrowStart.x} y1={arrowStart.y}
                  x2={arrowEnd.x} y2={arrowEnd.y}
                  stroke="#ffd700"
                  strokeWidth="0.5"
                  strokeDasharray="1,1"
                  markerEnd="url(#arrowhead)"
                />
              )}

              {/* Elements */}
              {elements.map(el => {
                const cfg = ELEMENT_TYPES[el.type] || ELEMENT_TYPES.X
                const isSelected = selectedElement === el.id
                return (
                  <g
                    key={el.id}
                    transform={`translate(${el.x}, ${el.y})`}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setSelectedElement(el.id)
                      handleElementDrag(el.id, e)
                    }}
                    style={{ cursor: 'move' }}
                  >
                    {cfg.shape === 'text' && (
                      <text
                        x="0" y="0"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="4"
                        fontWeight="bold"
                        fill={cfg.color}
                        stroke={isSelected ? '#ffd700' : 'none'}
                        strokeWidth="0.3"
                      >
                        {cfg.label}
                      </text>
                    )}
                    {cfg.shape === 'triangle' && (
                      <polygon
                        points="0,-2 2,2 -2,2"
                        fill={cfg.color}
                        stroke={isSelected ? '#ffd700' : 'none'}
                        strokeWidth="0.3"
                      />
                    )}
                    {cfg.shape === 'circle' && (
                      <circle
                        r="1.5"
                        fill={cfg.color}
                        stroke={isSelected ? '#ffd700' : '#000'}
                        strokeWidth="0.3"
                      />
                    )}
                  </g>
                )
              })}
            </svg>

            {(selectedElement || selectedArrow) && (
              <div className="tactics-element-actions">
                <button className="btn btn-sm btn-danger" onClick={deleteSelected}>Delete</button>
              </div>
            )}
          </div>
        </div>

        {showSaveDialog && (
          <div className="tactics-modal-overlay" onClick={() => { setShowSaveDialog(false); setSaveError('') }}>
            <div className="tactics-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{currentTactic ? 'Update Routine' : 'Save Routine'}</h2>
              {saveError && <p className="tactics-save-error">{saveError}</p>}
              <label>
                Name
                <input
                  type="text"
                  value={tacticName}
                  onChange={(e) => { setTacticName(e.target.value); setSaveError('') }}
                  placeholder="e.g. Corner kick routine"
                />
              </label>
              <label>
                Description (optional)
                <textarea
                  value={tacticDescription}
                  onChange={(e) => setTacticDescription(e.target.value)}
                  placeholder="e.g. Near post flick-on, far post finish"
                  rows="3"
                />
              </label>
              <div className="tactics-modal-actions">
                <button className="btn btn-ghost" onClick={() => { setShowSaveDialog(false); setSaveError('') }}>Cancel</button>
                <button className="btn btn-gold" onClick={saveTactic} disabled={!tacticName.trim() || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default TacticsBoard
