import './Loader.css'

// The one loader for the whole app: a football that bounces and spins over its
// own shadow. `inline` sits it inside a button (next to a label such as
// "Saving..."), `size` scales it down for tighter spots.
function Loader({ label = 'Loading...', size = 'md', inline = false }) {
  const className = `loader loader-${size}${inline ? ' loader-inline' : ''}`
  return (
    <div className={className} role="status" aria-live="polite">
      <div className="loader-ball-track">
        <svg
          className="loader-ball"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="50" cy="50" r="46" fill="#ffffff" stroke="#1a1a1a" strokeWidth="3" />
          <polygon points="50,28 62,37 57,52 43,52 38,37" fill="#1a1a1a" />
          <polygon points="50,28 62,37 68,22 58,12" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
          <polygon points="50,28 38,37 32,22 42,12" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
          <polygon points="62,37 57,52 72,58 80,45" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
          <polygon points="38,37 43,52 28,58 20,45" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
          <polygon points="43,52 57,52 62,66 50,75 38,66" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
        </svg>
      </div>
      {label && <span className="loader-label">{label}</span>}
    </div>
  )
}

export default Loader
