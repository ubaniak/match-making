import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeRoot } from './ui'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeRoot>
      <App />
    </ThemeRoot>
  </StrictMode>,
)
