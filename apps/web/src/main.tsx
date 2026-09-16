import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ProductionApp'
import { AuthGate } from './AuthGate'
import './operations.css'
import './banner.css'
import './auth.css'
import './production.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
