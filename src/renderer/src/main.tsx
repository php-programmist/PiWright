import { createRoot } from 'react-dom/client'
import { App } from './App'
import './app.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root element')
createRoot(container).render(<App />)
