import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ConfirmProvider } from './components/ConfirmDialog'
import './brand-tokens.css'
import './styles.css'
import './a11y.css'
import './ui-polish.css'
import 'highlight.js/styles/github-dark.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>,
)
