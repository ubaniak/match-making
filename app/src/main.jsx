import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeRoot } from './ui'
import { MapsProvider } from './LocationField'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeRoot>
      <MapsProvider>
        <App />
      </MapsProvider>
    </ThemeRoot>
  </StrictMode>,
)
